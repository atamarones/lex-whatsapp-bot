'use strict';

require('dotenv').config();

const express = require('express');
const { handleMessage } = require('./conversation');

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ── Webhook principal de Whapi ───────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Ack inmediato — Whapi requiere respuesta en < 5s
  res.sendStatus(200);

  const body = req.body;
  const messages = body?.messages ?? [];

  for (const msg of messages) {
    // Ignorar mensajes propios (outbound) y de sistema
    if (msg.from_me || msg.type === 'system') continue;

    const phone = msg.from?.replace('@s.whatsapp.net', '').replace('@c.us', '') ?? '';
    if (!phone) continue;

    const message = {
      type:      msg.type,                       // 'text' | 'image' | ...
      text:      msg.text?.body ?? '',
      messageId: msg.id,
    };

    try {
      await handleMessage(phone, message);
    } catch (err) {
      console.error(`[webhook] error phone=${phone}:`, err.message);
    }
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[LexBot] servidor en puerto ${PORT}`);
});
