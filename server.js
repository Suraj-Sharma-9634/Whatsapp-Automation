const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json());

let frontendSocket = null;
let assignedAI = { key: '', systemPrompt: '', waToken: '' };

// WebSocket for real-time UI updates
io.on('connection', (socket) => {
  console.log('🌐 Frontend connected');
  frontendSocket = socket;

  socket.on('disconnect', () => {
    console.log('❌ Frontend disconnected');
    frontendSocket = null;
  });
});

// Send WhatsApp message (manual send)
app.post('/send-message', async (req, res) => {
  const { token, to, message } = req.body;

  try {
    const response = await axios.post(
      'https://graph.facebook.com/v17.0/657991800734493/messages',
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error?.response?.data || error.message });
  }
});

// Assign AI config (Gemini key, prompt, WhatsApp token)
app.post('/assign-ai', (req, res) => {
  assignedAI.key = req.body.geminiKey;
  assignedAI.systemPrompt = req.body.systemPrompt || '';
  assignedAI.waToken = req.body.waToken || '';

  console.log('✅ AI Assigned:');
  console.log('  System Prompt:', assignedAI.systemPrompt);
  console.log('  Gemini Key:', assignedAI.key ? '[RECEIVED]' : '[MISSING]');
  console.log('  WhatsApp Token:', assignedAI.waToken ? '[RECEIVED]' : '[MISSING]');

  res.sendStatus(200);
});

// WhatsApp webhook verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'verify-me';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp incoming message handler
app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const messageObj = entry?.changes?.[0]?.value?.messages?.[0];
  const from = messageObj?.from;
  const text = messageObj?.text?.body;

  if (messageObj && from && text) {
    console.log(`📥 ${from}: ${text}`);

    // Emit to frontend
    if (frontendSocket) {
      frontendSocket.emit('incoming-message', { from, text, direction: 'in' });
    }

    // Generate Gemini reply
    if (assignedAI.key && assignedAI.waToken) {
      const aiReply = await getGeminiReply(text, assignedAI.systemPrompt, assignedAI.key);
      if (aiReply) {
        await sendAutoReply(from, aiReply, assignedAI.waToken);

        // Emit AI response to frontend
        if (frontendSocket) {
          frontendSocket.emit('incoming-message', {
            from: '🤖 Gemini',
            text: aiReply,
            direction: 'out'
          });
        }
      }
    } else {
      console.warn('⚠️ Missing Gemini key or WhatsApp token');
    }
  }

  res.sendStatus(200);
});

// Gemini 2.0 Flash AI Reply
async function getGeminiReply(userText, userSysPrompt, apiKey) {
  try {
    const permanentSysPrompt = "You are sales ai bot answer everything in small and you are going to handle the user on whatsapp";
    const fullPrompt = userSysPrompt
      ? `${permanentSysPrompt}\n${userSysPrompt}`
      : permanentSysPrompt;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            role: "user",
            parts: [
              { text: `${fullPrompt}\n\n${userText}` }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return reply.toLowerCase();
  } catch (err) {
    console.error('⚠️ Gemini error:', err.response?.data || err.message);
    return null;
  }
}

// Send AI reply back to WhatsApp user
async function sendAutoReply(to, text, token) {
  try {
    await axios.post(
      'https://graph.facebook.com/v17.0/657991800734493/messages',
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`🤖 Auto-replied to ${to}: ${text}`);
  } catch (err) {
    console.error('❌ Auto-reply failed:', err.response?.data || err.message);
  }
}

// Use Render's assigned port or default to 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
