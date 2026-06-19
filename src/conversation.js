'use strict';

const sm          = require('./sessionManager');
const { calcularPrestaciones } = require('./calculator');
const { tasaDelMesEgreso }     = require('./bcvRates');
const { sendText, sendImage }  = require('./whapiClient');
const { isValidFecha, limpiarCedula, parseNumber, formatBs } = require('./utils');
const path = require('path');

// ── Bancos disponibles ──────────────────────────────────────────────────────
const BANCOS = [
  { id: 1, nombre: 'Banesco',      qr: 'banesco.jpg',      telefono: '0412-000-0001', rif: 'J-00000001-0' },
  { id: 2, nombre: 'Mercantil',    qr: 'mercantil.jpg',    telefono: '0412-000-0002', rif: 'J-00000002-0' },
  { id: 3, nombre: 'Venezuela',    qr: 'venezuela.jpg',    telefono: '0412-000-0003', rif: 'J-00000003-0' },
  { id: 4, nombre: 'Bicentenario', qr: 'bicentenario.jpg', telefono: '0412-000-0004', rif: 'J-00000004-0' },
  { id: 5, nombre: 'Provincial',   qr: 'provincial.jpg',   telefono: '0412-000-0005', rif: 'J-00000005-0' },
];

const QR_DIR = path.join(__dirname, '..', 'assets', 'qr');

// ── Definición de estados ───────────────────────────────────────────────────
// Cada estado: { prompt(data), validate(input), next, field? }
const STATES = {
  WELCOME: {
    prompt: () =>
      `👋 Bienvenido a *LexBot* – Calculadora de Liquidación Laboral\n\n` +
      `Calculo tus *Prestaciones Sociales* conforme a la LOTTT.\n\n` +
      `Comenzamos con tus datos. ¿Cuál es tu *nombre completo*?`,
    validate: (v) => v.trim().length >= 3 ? { valid: true } : { valid: false, error: 'Por favor escribe tu nombre completo (mínimo 3 caracteres).' },
    field: 'fullName',
    next: 'CEDULA',
  },
  CEDULA: {
    prompt: (d) => `✅ Registrado: *${d.fullName}*\n\n¿Cuál es tu número de cédula? _(solo dígitos, sin V-)_`,
    validate: (v) => {
      const c = limpiarCedula(v);
      return /^\d{6,10}$/.test(c) ? { valid: true, value: c } : { valid: false, error: 'La cédula debe tener entre 6 y 10 dígitos.' };
    },
    field: 'cedula',
    next: 'CARGO',
  },
  CARGO: {
    prompt: () => `✅ Cédula registrada.\n\n¿Cuál es tu *cargo o puesto de trabajo*?`,
    validate: (v) => v.trim().length >= 2 ? { valid: true } : { valid: false, error: 'Escribe tu cargo.' },
    field: 'cargo',
    next: 'TIPO_NOMINA',
  },
  TIPO_NOMINA: {
    prompt: () =>
      `✅ Cargo registrado.\n\n¿Cuál es tu *tipo de nómina*?\n\n` +
      `1️⃣ Mensual\n2️⃣ Quincenal\n3️⃣ Semanal\n\nResponde con el número.`,
    validate: (v) => {
      const opt = { '1': 'MENSUAL', '2': 'QUINCENAL', '3': 'SEMANAL' };
      return opt[v.trim()] ? { valid: true, value: opt[v.trim()] } : { valid: false, error: 'Elige 1, 2 o 3.' };
    },
    field: 'tipoNomina',
    next: 'FECHA_INGRESO',
  },
  FECHA_INGRESO: {
    prompt: () => `✅ Tipo de nómina registrado.\n\n¿Cuál es tu *fecha de ingreso*? _(DD/MM/AAAA)_`,
    validate: (v) =>
      isValidFecha(v.trim())
        ? { valid: true, value: v.trim() }
        : { valid: false, error: 'Formato inválido. Usa DD/MM/AAAA (ej. 15/03/2022).' },
    field: 'fechaIngreso',
    next: 'FECHA_EGRESO',
  },
  FECHA_EGRESO: {
    prompt: (d) => `✅ Ingreso: *${d.fechaIngreso}*\n\n¿Cuál es tu *fecha de egreso*? _(DD/MM/AAAA)_`,
    validate: (v, d) => {
      if (!isValidFecha(v.trim())) return { valid: false, error: 'Formato inválido. Usa DD/MM/AAAA.' };
      const [dd, mm, yy] = v.trim().split('/').map(Number);
      const [di, mi, yi] = d.fechaIngreso.split('/').map(Number);
      const egreso  = new Date(Date.UTC(yy, mm - 1, dd));
      const ingreso = new Date(Date.UTC(yi, mi - 1, di));
      return egreso > ingreso
        ? { valid: true, value: v.trim() }
        : { valid: false, error: 'La fecha de egreso debe ser posterior al ingreso.' };
    },
    field: 'fechaEgreso',
    next: 'SALARIO_BS',
  },
  SALARIO_BS: {
    prompt: () => `✅ Fechas registradas.\n\n¿Cuál es tu *salario mensual en Bs.*? _(ej. 8500.00)_`,
    validate: (v) => {
      const n = parseNumber(v);
      return n !== null && n > 0 ? { valid: true, value: n } : { valid: false, error: 'Ingresa un monto positivo en Bs. (ej. 8500.00).' };
    },
    field: 'salarioMensualBs',
    next: 'BONO_FABRICA',
  },
  BONO_FABRICA: {
    prompt: () =>
      `✅ Salario registrado.\n\n¿Recibes *bono de fábrica u otro bono no salarial*?\n` +
      `Si sí, indica el monto en Bs. Si no, escribe *0* o *no*.`,
    validate: (v) => {
      if (['no', 'n', '0'].includes(v.trim().toLowerCase())) return { valid: true, value: 0 };
      const n = parseNumber(v);
      return n !== null && n >= 0 ? { valid: true, value: n } : { valid: false, error: 'Escribe el monto en Bs o "0" si no aplica.' };
    },
    field: 'bonoFabrica',
    next: 'MOTIVO_RETIRO',
  },
  MOTIVO_RETIRO: {
    prompt: () =>
      `✅ Bono registrado.\n\n¿Cuál es el *motivo de retiro*?\n\n` +
      `1️⃣ Retiro Voluntario\n2️⃣ Despido Injustificado\n3️⃣ Mutuo Acuerdo\n\nResponde con el número.`,
    validate: (v) => {
      const opt = { '1': 'RETIRO_VOLUNTARIO', '2': 'DESPIDO_INJUSTIFICADO', '3': 'MUTUO_ACUERDO' };
      return opt[v.trim()] ? { valid: true, value: opt[v.trim()] } : { valid: false, error: 'Elige 1, 2 o 3.' };
    },
    field: 'motivoRetiro',
    next: 'BONO_ESPECIAL',
  },
  BONO_ESPECIAL: {
    prompt: () =>
      `✅ Motivo registrado.\n\n¿Hay alguna *bonificación especial* acordada (ej. bono de salida en Bs)?\n` +
      `Si sí, indica el monto. Si no, escribe *0* o *no*.`,
    validate: (v) => {
      if (['no', 'n', '0'].includes(v.trim().toLowerCase())) return { valid: true, value: 0 };
      const n = parseNumber(v);
      return n !== null && n >= 0 ? { valid: true, value: n } : { valid: false, error: 'Escribe el monto en Bs o "0" si no aplica.' };
    },
    field: 'bonificacionEspecial',
    next: 'CONFIRM_CALC',
  },
  CONFIRM_CALC: {
    prompt: (d) => {
      const tasaBCV = tasaDelMesEgreso(d.fechaEgreso) ?? 1;
      const salarioMensualUSD = d.salarioMensualBs / tasaBCV;
      const result = calcularPrestaciones({
        fechaIngreso:         d.fechaIngreso,
        fechaEgreso:          d.fechaEgreso,
        salarioMensualUSD,
        tasaBCV,
        bonificacionEspecial: d.bonificacionEspecial ?? 0,
      });
      d._result = result;
      d._tasaBCV = tasaBCV;
      d._salarioMensualUSD = salarioMensualUSD;
      return (
        `📊 *RESUMEN DE TU CASO*\n\n` +
        `👤 *${d.fullName}* | C.I. ${d.cedula}\n` +
        `💼 ${d.cargo} | ${d.tipoNomina}\n` +
        `📅 ${d.fechaIngreso} → ${d.fechaEgreso}\n` +
        `💵 Salario mensual: *Bs. ${formatBs(d.salarioMensualBs)}*\n` +
        `⏱ ${result.totalAnos} año(s), ${result.mesesExactos % 12} mes(es) y ${result.diasExtra} día(s)\n\n` +
        `💰 *ESTIMADO LIQUIDACIÓN*\n` +
        `• Prestaciones Sociales: *Bs. ${formatBs(result.prestacionesSociales)}*\n` +
        `• Intereses Art.143:     *Bs. ${formatBs(result.interesesAcumulados)}*\n` +
        `• Utilidades fracc.:     *Bs. ${formatBs(result.utilidadesFracc)}*\n` +
        `• Vacaciones fracc.:     *Bs. ${formatBs(result.vacacionesFracc)}*\n` +
        `• Bono Vac. fracc.:      *Bs. ${formatBs(result.bonoVacFracc)}*\n` +
        `• Bonificación especial: *Bs. ${formatBs(result.bonificacionEspecial)}*\n` +
        `• FAOV:                 -Bs. ${formatBs(result.FAOV)}\n` +
        `• INCE:                 -Bs. ${formatBs(result.INCE)}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💳 *MONTO A PAGAR: Bs. ${formatBs(result.montoAPagar)}*\n\n` +
        `¿Confirmas los datos? Responde *SÍ* para continuar o *NO* para reiniciar.`
      );
    },
    validate: (v) => {
      const u = v.trim().toLowerCase();
      if (['si', 'sí', 'yes', 's'].includes(u)) return { valid: true, value: 'CONFIRMAR' };
      if (['no', 'n'].includes(u)) return { valid: true, value: 'REINICIAR' };
      return { valid: false, error: 'Responde *SÍ* para confirmar o *NO* para reiniciar.' };
    },
    field: '_confirmacion',
    next: 'SELECT_BANCO',
  },
  SELECT_BANCO: {
    prompt: () =>
      `✅ ¡Datos confirmados! Para generar tu liquidación, realiza el pago vía *Pago Móvil*.\n\n` +
      `Selecciona tu banco:\n\n` +
      BANCOS.map(b => `${b.id}️⃣ ${b.nombre}`).join('\n') +
      `\n\nResponde con el número del banco.`,
    validate: (v) => {
      const n = parseInt(v.trim());
      const banco = BANCOS.find(b => b.id === n);
      return banco ? { valid: true, value: banco } : { valid: false, error: `Elige un número del 1 al ${BANCOS.length}.` };
    },
    field: '_banco',
    next: 'AWAIT_COMPROBANTE',
  },
  AWAIT_COMPROBANTE: {
    prompt: () => `📸 Envía la *foto del comprobante* de pago. Una vez verificado, generamos tu PDF.`,
    validate: () => ({ valid: true }), // validado por tipo de mensaje (imagen)
    next: 'SEND_PDF',
  },
  SEND_PDF: {
    prompt: () => `⏳ Generando tu *Planilla de Liquidación*...`,
    validate: () => ({ valid: true }),
    next: 'DONE',
  },
  DONE: {
    prompt: () => `✅ ¡Listo! Tu liquidación ha sido enviada. Escribe *reiniciar* para hacer un nuevo cálculo.`,
    validate: () => ({ valid: false, error: '' }),
    next: null,
  },
};

// ── Manejador principal ─────────────────────────────────────────────────────
async function handleMessage(phone, message) {
  const { type, text, messageId } = message;
  const input = text?.trim() ?? '';

  // Comandos globales
  if (input.toLowerCase() === 'reiniciar') {
    sm.clearSession(phone);
    const session = sm.createSession(phone, 'WELCOME');
    await sendText(phone, STATES.WELCOME.prompt(session.data));
    return;
  }

  let session = sm.getSession(phone);
  if (!session) {
    session = sm.createSession(phone, 'WELCOME');
    await sendText(phone, STATES.WELCOME.prompt(session.data));
    return;
  }

  const currentStateDef = STATES[session.state];

  // Comando "corregir": retrocede un paso
  if (input.toLowerCase() === 'corregir') {
    const prev = sm.goBack(phone);
    if (!prev) {
      await sendText(phone, '⚠️ No hay pasos anteriores para corregir.');
      return;
    }
    const prevDef = STATES[prev];
    await sendText(phone, prevDef.prompt(session.data));
    return;
  }

  // Estado AWAIT_COMPROBANTE: espera imagen
  if (session.state === 'AWAIT_COMPROBANTE') {
    if (type !== 'image') {
      await sendText(phone, '📸 Por favor envía la *foto del comprobante* de pago (imagen).');
      return;
    }
    console.log(`[audit] comprobante recibido phone=${phone} messageId=${messageId}`);
    sm.updateState(phone, 'SEND_PDF');
    await generateAndSendPDF(phone, session);
    return;
  }

  // Estado DONE: solo acepta "reiniciar" (ya manejado arriba)
  if (session.state === 'DONE') {
    await sendText(phone, `Escribe *reiniciar* para comenzar un nuevo cálculo. 😊`);
    return;
  }

  // Validar input en estado actual
  const result = currentStateDef.validate(input, session.data);
  if (!result.valid) {
    const errorMsg = result.error
      ? `❌ ${result.error}\n\n${currentStateDef.prompt(session.data)}`
      : currentStateDef.prompt(session.data);
    await sendText(phone, errorMsg);
    return;
  }

  // Guardar campo
  const value = result.value !== undefined ? result.value : input.trim();
  const fieldData = currentStateDef.field ? { [currentStateDef.field]: value } : {};

  // Caso especial: CONFIRM_CALC con NO → reiniciar
  if (session.state === 'CONFIRM_CALC' && value === 'REINICIAR') {
    sm.clearSession(phone);
    const newSession = sm.createSession(phone, 'WELCOME');
    await sendText(phone, `🔄 Reiniciando...\n\n${STATES.WELCOME.prompt(newSession.data)}`);
    return;
  }

  const nextState = currentStateDef.next;
  sm.updateState(phone, nextState, fieldData);
  session = sm.getSession(phone);

  // Acción especial al llegar a SELECT_BANCO: ya enviamos el prompt con la lista
  if (nextState === 'SELECT_BANCO') {
    await sendText(phone, STATES.SELECT_BANCO.prompt(session.data));
    return;
  }

  // Acción especial: enviar QR al confirmar banco
  if (nextState === 'AWAIT_COMPROBANTE' && session.data._banco) {
    const banco = session.data._banco;
    const qrPath = path.join(QR_DIR, banco.qr);
    const caption =
      `🏦 *${banco.nombre}*\n` +
      `📱 Teléfono Pago Móvil: ${banco.telefono}\n` +
      `🪪 RIF/CI: ${banco.rif}\n` +
      `📝 Concepto: Liquidación Laboral – ${session.data.cedula}`;
    try {
      await sendImage(phone, qrPath, caption);
    } catch {
      await sendText(phone, caption + '\n\n_(QR no disponible, usa los datos arriba)_');
    }
    await sendText(phone, STATES.AWAIT_COMPROBANTE.prompt(session.data));
    return;
  }

  // Avanzar al siguiente estado y enviar su prompt
  const nextDef = STATES[nextState];
  if (nextDef?.prompt) {
    await sendText(phone, nextDef.prompt(session.data));
  }
}

// ── Generación de PDF (sin OpenAI) ─────────────────────────────────────────
async function generateAndSendPDF(phone, session) {
  const { generatePDF }    = require('./pdfGenerator');
  const { sendDocument }   = require('./whapiClient');
  const { guardarRegistro } = require('./airtableClient');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  const d       = session.data;
  const outPath = path.join(os.tmpdir(), `${d.cedula}_${Date.now()}.pdf`);

  // Usar cache del cálculo si ya existe (de CONFIRM_CALC), o recalcular
  const tasaBCV           = d._tasaBCV           ?? (tasaDelMesEgreso(d.fechaEgreso) ?? 1);
  const salarioMensualUSD = d._salarioMensualUSD ?? (d.salarioMensualBs / tasaBCV);
  const calcResult = d._result ?? calcularPrestaciones({
    fechaIngreso:         d.fechaIngreso,
    fechaEgreso:          d.fechaEgreso,
    salarioMensualUSD,
    tasaBCV,
    bonificacionEspecial: d.bonificacionEspecial ?? 0,
  });

  const workerData = {
    fullName:         d.fullName,
    cedula:           d.cedula,
    cargo:            d.cargo,
    tipoNomina:       d.tipoNomina,
    fechaIngreso:     d.fechaIngreso,
    fechaEgreso:      d.fechaEgreso,
    salarioMensualBs: d.salarioMensualBs,
    motivoRetiro:     d.motivoRetiro,
  };

  try {
    await generatePDF({ workerData, calcResult, outputPath: outPath });

    const montoFmt = calcResult.montoAPagar.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const filename = `Liquidacion_${d.cedula}.pdf`;

    await sendDocument(phone, outPath, filename, `📄 *Planilla de Liquidación*\nMONTO NETO: Bs. ${montoFmt}`);
    await sendText(phone, STATES.DONE.prompt(d));
    sm.updateState(phone, 'DONE');

    guardarRegistro({
      cedula:           d.cedula,
      nombre:           d.fullName,
      empresa:          '',
      cargo:            d.cargo,
      movil:            phone,
      fechaIngreso:     d.fechaIngreso,
      fechaEgreso:      d.fechaEgreso,
      tiempoServicio:   `${calcResult.totalAnos} año(s), ${calcResult.mesesExactos % 12} mes(es) y ${calcResult.diasExtra} día(s)`,
      salarioMensualBs: d.salarioMensualBs,
      tipoSalario:      d.tipoNomina ?? 'MENSUAL',
      motivoTerminacion: d.motivoRetiro ?? '',
      metodoAplicado:   calcResult.metodoAplicado,
      montoBruto:       calcResult.montoBruto,
      totalDeducciones: calcResult.FAOV + calcResult.INCE,
      montoNeto:        calcResult.montoAPagar,
      canal:            'WHATSAPP',
    });
  } catch (err) {
    console.error('[pdf] error generando PDF:', err);
    await sendText(phone,
      `⚠️ No pude generar el PDF en este momento.\n\nContacta a soporte para el documento formal.`
    );
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

sm.setCallbacks({
  onReminder: async (phone) => {
    try { await sendText(phone, '⏰ Sigues ahí? Escribe tu respuesta para continuar. Tienes 30 min antes de que expire la sesión.'); }
    catch {}
  },
  onExpire: async (phone) => {
    try { await sendText(phone, '⌛ Tu sesión expiró por inactividad. Escribe cualquier mensaje para comenzar de nuevo.'); }
    catch {}
  },
});

module.exports = { handleMessage };
