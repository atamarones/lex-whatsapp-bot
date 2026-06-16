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

// ── Calcular liquidación y generar PDF ───────────────────────────────────────
app.post('/calcular-pdf', async (req, res) => {
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');
  const { calcularLiquidacion } = require('./openaiClient');
  const { generatePDFV2 }       = require('./pdfGeneratorV2');

  const variables = req.body;
  if (!variables || !variables.cedula) {
    return res.status(400).json({ error: 'Faltan variables requeridas (cedula mínimo).' });
  }

  const cedula   = String(variables.cedula).replace(/\D/g, '');
  const outPath  = path.join(os.tmpdir(), `liquidacion_${cedula}_${Date.now()}.pdf`);

  try {
    const data = await calcularLiquidacion(variables);
    await generatePDFV2(data, outPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Liquidacion_${cedula}.pdf"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(outPath); } catch {} });
    stream.on('error', (err) => {
      console.error('[calcular-pdf] stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Error enviando PDF.' });
    });
  } catch (err) {
    console.error('[calcular-pdf] error:', err.message);
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[LexBot] servidor en puerto ${PORT}`);
});
