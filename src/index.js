'use strict';

require('dotenv').config();

const express = require('express');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');

const { handleMessage }    = require('./conversation');
const { calcularLiquidacion } = require('./openaiClient');
const { generatePDFV2 }    = require('./pdfGeneratorV2');

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ── Caché en memoria: cedula → { data, ts } (TTL 30 min) ─────────────────────
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function cacheSet(cedula, data) {
  cache.set(cedula, { data, ts: Date.now() });
}

function cacheGet(cedula) {
  const entry = cache.get(cedula);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(cedula); return null; }
  return entry.data;
}

// ── Middleware de autenticación ───────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // si no está configurado, no bloquea (dev mode)
  const provided = req.headers['x-api-key'];
  if (provided !== secret) {
    return res.status(401).json({ error: 'API key inválida.' });
  }
  next();
}

// ── Webhook Superchat / Whapi ─────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const messages = req.body?.messages ?? [];
  for (const msg of messages) {
    if (msg.from_me || msg.type === 'system') continue;
    const phone = msg.from?.replace('@s.whatsapp.net', '').replace('@c.us', '') ?? '';
    if (!phone) continue;
    try {
      await handleMessage(phone, { type: msg.type, text: msg.text?.body ?? '', messageId: msg.id });
    } catch (err) {
      console.error(`[webhook] error phone=${phone}:`, err.message);
    }
  }
});

// ── POST /calcular → JSON con el cálculo ─────────────────────────────────────
app.post('/calcular', requireApiKey, async (req, res) => {
  const variables = req.body;
  if (!variables?.cedula) {
    return res.status(400).json({ error: 'Campo "cedula" requerido.' });
  }

  const cedula = String(variables.cedula).replace(/\D/g, '');

  try {
    const data = await calcularLiquidacion(variables);
    cacheSet(cedula, data);

    const r = data.resumen ?? {};
    res.json({
      cedula,
      nombre:              data.datos_trabajador?.nombre ?? '',
      tiempo_servicio:     data.datos_trabajador?.tiempo_servicio ?? '',
      metodo_aplicado:     r.metodo_prestaciones ?? '',
      monto_bruto:         r.monto_bruto ?? 0,
      total_deducciones:   r.total_deducciones ?? 0,
      monto_neto:          r.monto_neto ?? 0,
      es_provisional:      data.explicacion?.es_provisional ?? false,
    });
  } catch (err) {
    console.error('[calcular] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Normaliza variables de Superchat a nombres explícitos para OpenAI ────────
function normalizarVariables(v) {
  return {
    cedula:                      v.cedula,
    nombre:                      v.nombre,
    empresa:                     v.empresa,
    cargo:                       v.cargo,
    salario_mensual:             v.salario            ?? v.salario_mensual,
    tipo_salario:                v.tipo_salario,
    fecha_ingreso:               v.f_ingreso          ?? v.fecha_ingreso,
    fecha_egreso:                v.f_egreso           ?? v.fecha_egreso,
    motivo_terminacion:          v.motivo_terminacion_laboral ?? v.motivo_terminacion,
    anticipo_prestaciones:       v.anticipo_prestaciones,
    empresa_debe_utilidades:     v.empresa_debe_utilidades,
    ultimos_pagos_3_meses:       v['ultimo _pago_3meses'] ?? v.ultimos_pagos_3_meses,
    utilidades_pendientes:       v.utilidades_pendientes,
    vacaciones_pendientes:       v.vacaciones_pendientes,
    vacaciones_vencidas:         v.vacaciones_vencidas,
  };
}

// ── POST /calcular-pdf → PDF binario ─────────────────────────────────────────
app.post('/calcular-pdf', requireApiKey, async (req, res) => {
  const variables = req.body;
  if (!variables?.cedula) {
    return res.status(400).json({ error: 'Campo "cedula" requerido.' });
  }

  const cedula  = String(variables.cedula).replace(/\D/g, '');
  const outPath = path.join(os.tmpdir(), `liquidacion_${cedula}_${Date.now()}.pdf`);

  try {
    // Usar caché si existe; si no, llamar a OpenAI
    let data = cacheGet(cedula);
    if (!data) {
      data = await calcularLiquidacion(normalizarVariables(variables));
      cacheSet(cedula, data);
    }

    await generatePDFV2(data, outPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Liquidacion_${cedula}.pdf"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end',  () => { try { fs.unlinkSync(outPath); } catch {} });
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => console.log(`[LexBot] servidor en puerto ${PORT}`));
