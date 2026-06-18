'use strict';

require('dotenv').config();

const express = require('express');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');

const { handleMessage }        = require('./conversation');
const { calcularPrestaciones } = require('./calculator');
const { generatePDFV2 }        = require('./pdfGeneratorV2');
const { TASAS_HISTORICAS }     = require('./bcvRates');

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ── Caché en memoria: cedula → { data, ts } (TTL 30 min) ─────────────────────
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function cacheSet(cedula, data) { cache.set(cedula, { data, ts: Date.now() }); }
function cacheGet(cedula) {
  const entry = cache.get(cedula);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(cedula); return null; }
  return entry.data;
}

// ── Middleware de autenticación ───────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next();
  if (req.headers['x-api-key'] !== secret) {
    return res.status(401).json({ error: 'API key inválida.' });
  }
  next();
}

// ── Normaliza fecha a DD/MM/AAAA (acepta DD/MM/AAAA y YYYY-MM-DD) ────────────
function normFecha(s) {
  if (!s) return '';
  s = String(s).trim();
  // YYYY-MM-DD → DD/MM/AAAA
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

// ── Infiere la tasa BCV del mes de egreso desde la tabla histórica ────────────
function tasaDelMesEgreso(fechaEgresoNorm) {
  // fechaEgresoNorm: DD/MM/AAAA
  const partes = fechaEgresoNorm.split('/');
  if (partes.length < 3) return null;
  const key = `${partes[2]}-${partes[1].padStart(2, '0')}`;
  return TASAS_HISTORICAS[key] ?? null;
}

// ── Extrae inputs para calcularPrestaciones desde el cuerpo de la petición ────
// Superchat envía el salario en Bs. La tasa BCV se infiere del mes de egreso
// automáticamente desde la tabla histórica — no requiere campo adicional.
function extraerInputs(v) {
  const fechaIngreso = normFecha(v.f_ingreso ?? v.fecha_ingreso);
  const fechaEgreso  = normFecha(v.f_egreso  ?? v.fecha_egreso);

  // Tasa BCV: explícita > inferida del mes de egreso
  let tasaBCV = Number(v.tasa_bcv ?? v.tasaBCV ?? 0);
  if (!tasaBCV && fechaEgreso) {
    tasaBCV = tasaDelMesEgreso(fechaEgreso) ?? 0;
  }

  // Salario: USD directo > Bs ÷ tasa BCV del mes de egreso
  let salarioMensualUSD;
  if (v.salario_mensual_usd ?? v.salario_usd) {
    salarioMensualUSD = Number(v.salario_mensual_usd ?? v.salario_usd);
  } else {
    const salBs = Number(v.salario ?? v.salario_mensual ?? 0);
    salarioMensualUSD = tasaBCV > 0 ? salBs / tasaBCV : salBs;
  }

  const bonificacionEspecial = Number(v.bonificacion_especial ?? v.bonificacionEspecial ?? 0);
  const diasUtilidades       = Number(v.dias_utilidades ?? v.diasUtilidades ?? 30);

  return { fechaIngreso, fechaEgreso, salarioMensualUSD, tasaBCV, bonificacionEspecial, diasUtilidades };
}

// ── Textos fijos de fundamento legal ─────────────────────────────────────────
const FUNDAMENTO_LEGAL = `
Art. 142 LOTTT – Prestaciones Sociales: garantía trimestral de 15 días de salario integral por trimestre (literales A y B); al término de la relación se compara con 30 días de salario integral por año (literal C) y se paga el mayor (literal D).
Art. 143 LOTTT – Intereses sobre Prestaciones: tasa fijada por el BCV, calculados mensualmente sobre el saldo acumulado de la garantía.
Art. 131 LOTTT – Utilidades: mínimo 30 días de salario por año; las fracciones se calculan proporcionalmente por los meses trabajados en el año calendario en curso.
Arts. 190, 192 y 196 LOTTT – Vacaciones y Bono Vacacional: 15 días de vacaciones y 15 días de bono el primer año, con 1 día adicional por año subsiguiente; las fracciones se calculan sobre el período aniversario correspondiente.
Art. 172 Ley del Régimen Prestacional de Vivienda y Hábitat – FAOV: aporte del trabajador del 1% sobre vacaciones, bono vacacional y utilidades.
Art. 14 Ley del INCE – INCE: 0,5% sobre utilidades.
`.trim();

const OBSERVACIONES = `
Cálculo generado con tasas BCV históricas oficiales (fuente: datos mensuales BCV/investing.com).
Los intereses sobre prestaciones sociales se calculan a la tasa BCV vigente informada por el usuario para el mes de egreso.
Las prestaciones acumuladas se estimaron usando el salario en USD declarado, convertido con la tasa BCV de cada mes histórico.
IMPORTANTE: Este cálculo es referencial. No sustituye la liquidación formal del empleador ni constituye asesoría legal. No incluye deducciones por IVSS, RPE, préstamos ni anticipos de prestaciones.
`.trim();

// ── Convierte resultado de calcularPrestaciones → estructura pdfGeneratorV2 ──
function armarDataPDF(calcResult, vars) {
  const r = calcResult;
  const egresoAnio = normFecha(vars.f_egreso ?? vars.fecha_egreso).split('/')[2] ?? '';

  const tiempoServicio = `${r.totalAnos} año(s), ${r.mesesExactos % 12} mes(es) y ${r.diasExtra} día(s)`;

  const metodologia = [
    `Salario mensual: Bs. ${r.salarioMensualBs.toFixed(2)} (USD ${(vars.salario_mensual_usd ?? vars.salario_usd ?? (r.salarioMensualBs / (vars.tasa_bcv ?? vars.tasaBCV ?? 1))).toFixed(2)} × ${vars.tasa_bcv ?? vars.tasaBCV ?? '–'} BCV).`,
    `Salario diario normal (SDN): Bs. ${r.salarioDiarioNormal.toFixed(4)} = salario mensual / 30.`,
    `Salario diario integral (SDI): Bs. ${r.salarioDiarioIntegral.toFixed(4)} = SDN + alícuota bono vacacional (${r.diasBonVac} días) + alícuota utilidades (${r.diasUtilidades} días).`,
    `Tiempo de servicio: ${tiempoServicio} = ${r.totalMeses} meses totales.`,
    `Garantía Art. 142 A,B: Bs. ${r.garantiaCapital.toFixed(2)} — depósito de 15 días de SDI por trimestre usando tasa BCV histórica de cada mes.`,
    `Finalización Art. 142 C: Bs. ${r.prestacionesFinalizacion.toFixed(2)} = ${r.totalAnos} año(s) × 30 días × SDI.`,
    `Método aplicado (Art. 142 D – el mayor): ${r.metodoAplicado} → Bs. ${r.prestacionesSociales.toFixed(2)}.`,
    `Intereses Art. 143: Bs. ${r.interesesAcumulados.toFixed(2)} — calculados mensualmente sobre capital acumulado (tasa mensual BCV aplicada).`,
    `Utilidades fraccionadas ${egresoAnio}: ${r.diasUtilidadesFrac.toFixed(2)} días × Bs. ${r.salarioBaseUtil.toFixed(4)} (promedio SDN+iBV en el año calendario) = Bs. ${r.utilidadesFracc.toFixed(2)}.`,
    `Vacaciones fraccionadas: ${(r.diasVac / 12 * r.mesesFraccion).toFixed(4)} días × SDN = Bs. ${r.vacacionesFracc.toFixed(2)}.`,
    `Bono vacacional fraccionado: ${(r.diasBonVac / 12 * r.mesesFraccion).toFixed(4)} días × SDN = Bs. ${r.bonoVacFracc.toFixed(2)}.`,
    `FAOV (1%): Bs. ${r.FAOV.toFixed(2)} sobre vacaciones + bono vacacional + utilidades.`,
    `INCE (0,5%): Bs. ${r.INCE.toFixed(2)} sobre utilidades fraccionadas.`,
  ].join('\n');

  const conceptos = [
    {
      concepto:    'Prestaciones Sociales (Art. 142 LOTTT)',
      dias:        null,
      monto_diario: null,
      monto:       r.prestacionesSociales,
      base_legal:  `Art. 142 LOTTT – ${r.metodoAplicado === 'GARANTIA' ? 'Garantía trimestral (A,B)' : 'Finalización (C)'}`,
    },
    {
      concepto:    'Intereses sobre Prestaciones (Art. 143 LOTTT)',
      dias:        null,
      monto_diario: null,
      monto:       r.interesesAcumulados,
      base_legal:  'Art. 143 LOTTT',
    },
    {
      concepto:    `Utilidades Fraccionadas ${egresoAnio} (Art. 131 LOTTT)`,
      dias:        parseFloat(r.diasUtilidadesFrac.toFixed(4)),
      monto_diario: parseFloat(r.salarioBaseUtil.toFixed(4)),
      monto:       r.utilidadesFracc,
      base_legal:  'Art. 131 LOTTT',
    },
    {
      concepto:    'Vacaciones Fraccionadas (Art. 190 LOTTT)',
      dias:        parseFloat((r.diasVac / 12 * r.mesesFraccion).toFixed(4)),
      monto_diario: parseFloat(r.salarioDiarioNormal.toFixed(4)),
      monto:       r.vacacionesFracc,
      base_legal:  'Arts. 190 y 196 LOTTT',
    },
    {
      concepto:    'Bono Vacacional Fraccionado (Art. 192 LOTTT)',
      dias:        parseFloat((r.diasBonVac / 12 * r.mesesFraccion).toFixed(4)),
      monto_diario: parseFloat(r.salarioDiarioNormal.toFixed(4)),
      monto:       r.bonoVacFracc,
      base_legal:  'Arts. 192 y 196 LOTTT',
    },
    ...(r.bonificacionEspecial > 0 ? [{
      concepto:    'Bonificación Única y Especial',
      dias:        null,
      monto_diario: null,
      monto:       r.bonificacionEspecial,
      base_legal:  'Acuerdo entre partes',
    }] : []),
  ];

  const deducciones = [
    { concepto: 'FAOV – Fondo de Ahorro Obligatorio para la Vivienda (1%)', monto: r.FAOV },
    { concepto: 'INCE – Instituto Nacional de Capacitación Educativa (0,5%)', monto: r.INCE },
  ];

  return {
    datos_trabajador: {
      nombre:             vars.nombre             ?? '',
      cedula:             vars.cedula             ?? '',
      empresa:            vars.empresa            ?? '',
      cargo:              vars.cargo              ?? '',
      tipo_salario:       vars.tipo_salario       ?? vars.tipo_nomina ?? 'MENSUAL',
      fecha_ingreso:      normFecha(vars.f_ingreso  ?? vars.fecha_ingreso),
      fecha_egreso:       normFecha(vars.f_egreso   ?? vars.fecha_egreso),
      tiempo_servicio:    tiempoServicio,
      salario_mensual:    r.salarioMensualBs,
      salario_diario:     r.salarioDiarioNormal,
      motivo_terminacion: vars.motivo_terminacion_laboral ?? vars.motivo_terminacion ?? '',
    },
    conceptos,
    deducciones,
    resumen: {
      metodo_prestaciones: r.metodoAplicado === 'GARANTIA'
        ? `Método Garantía (Art. 142 A,B) – Bs. ${r.garantiaCapital.toFixed(2)}`
        : `Método Finalización (Art. 142 C) – Bs. ${r.prestacionesFinalizacion.toFixed(2)}`,
      monto_bruto:       r.montoBruto,
      total_deducciones: r.FAOV + r.INCE,
      monto_neto:        r.montoAPagar,
    },
    explicacion: {
      metodologia:     metodologia,
      fundamento_legal: FUNDAMENTO_LEGAL,
      observaciones:   OBSERVACIONES,
      es_provisional:  false,
    },
  };
}

// ── Tokens temporales para descarga de PDF (TTL 10 min) ──────────────────────
const pdfTokens = new Map();
const PDF_TOKEN_TTL = 10 * 60 * 1000;

function registrarToken(token, filePath) {
  pdfTokens.set(token, { filePath, ts: Date.now() });
  setTimeout(() => {
    const entry = pdfTokens.get(token);
    if (entry) { try { fs.unlinkSync(entry.filePath); } catch {} pdfTokens.delete(token); }
  }, PDF_TOKEN_TTL);
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
app.post('/calcular', requireApiKey, (req, res) => {
  const vars = req.body;
  if (!vars?.cedula) return res.status(400).json({ error: 'Campo "cedula" requerido.' });

  const cedula = String(vars.cedula).replace(/\D/g, '');

  try {
    const inputs = extraerInputs(vars);

    if (!inputs.fechaIngreso || !inputs.fechaEgreso) {
      return res.status(400).json({ error: 'Campos "fecha_ingreso" y "fecha_egreso" requeridos.' });
    }
    if (inputs.salarioMensualUSD <= 0) {
      return res.status(400).json({ error: 'Se requiere "salario_mensual_usd" o "salario_mensual" + "tasa_bcv".' });
    }

    const calcResult = calcularPrestaciones(inputs);
    const data = armarDataPDF(calcResult, vars);
    cacheSet(cedula, data);

    const r = data.resumen;
    res.json({
      cedula,
      nombre:            data.datos_trabajador.nombre,
      tiempo_servicio:   data.datos_trabajador.tiempo_servicio,
      metodo_aplicado:   r.metodo_prestaciones,
      monto_bruto:       r.monto_bruto,
      total_deducciones: r.total_deducciones,
      monto_neto:        r.monto_neto,
      es_provisional:    false,
    });
  } catch (err) {
    console.error('[calcular] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /calcular-pdf → JSON con URL de descarga (para Superchat) ────────────
app.post('/calcular-pdf', requireApiKey, async (req, res) => {
  const vars = req.body;
  if (!vars?.cedula) return res.status(400).json({ error: 'Campo "cedula" requerido.' });

  const cedula  = String(vars.cedula).replace(/\D/g, '');
  const token   = `${cedula}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outPath = path.join(os.tmpdir(), `liquidacion_${token}.pdf`);

  try {
    let data = cacheGet(cedula);

    if (!data) {
      const inputs = extraerInputs(vars);

      if (!inputs.fechaIngreso || !inputs.fechaEgreso) {
        return res.status(400).json({ error: 'Campos "fecha_ingreso" y "fecha_egreso" requeridos.' });
      }
      if (inputs.salarioMensualUSD <= 0) {
        return res.status(400).json({ error: 'Se requiere "salario_mensual_usd" o "salario_mensual" + "tasa_bcv".' });
      }

      const calcResult = calcularPrestaciones(inputs);
      data = armarDataPDF(calcResult, vars);
      cacheSet(cedula, data);
    }

    await generatePDFV2(data, outPath);
    registrarToken(token, outPath);

    const baseUrl  = process.env.BASE_URL ?? `${req.protocol}://${req.get('host')}`;
    const montoFmt = Number(data.resumen.monto_neto).toLocaleString('es-VE', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });

    res.json({
      pdf_url:  `${baseUrl}/pdf/${token}`,
      filename: `Liquidacion_${cedula}.pdf`,
      cedula,
      nombre:   data.datos_trabajador.nombre,
      monto_neto: `Bs. ${montoFmt}`,
    });
  } catch (err) {
    console.error('[calcular-pdf] error:', err.message);
    try { fs.unlinkSync(outPath); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pdf/:token → descarga el PDF generado ────────────────────────────────
app.get('/pdf/:token', (req, res) => {
  const entry = pdfTokens.get(req.params.token);
  if (!entry || Date.now() - entry.ts > PDF_TOKEN_TTL) {
    return res.status(404).json({ error: 'PDF no disponible o expirado.' });
  }
  const cedula = req.params.token.split('_')[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Liquidacion_${cedula}.pdf"`);
  fs.createReadStream(entry.filePath).pipe(res);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => console.log(`[LexBot] servidor en puerto ${PORT}`));
