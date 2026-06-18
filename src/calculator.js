'use strict';

const { getTasaMes } = require('./bcvRates');

/**
 * Convierte fecha DD/MM/YYYY → objeto Date (UTC mediodía para evitar drift de zona horaria)
 */
function parseFecha(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/**
 * Diferencia de tiempo en años, meses y días calendario entre dos fechas.
 */
function calcularTiempoServicio(fechaIngreso, fechaEgreso) {
  const inicio = parseFecha(fechaIngreso);
  const fin    = parseFecha(fechaEgreso);

  let anos  = fin.getUTCFullYear() - inicio.getUTCFullYear();
  let meses = fin.getUTCMonth()    - inicio.getUTCMonth();
  let dias  = fin.getUTCDate()     - inicio.getUTCDate();

  if (dias < 0) {
    meses -= 1;
    const mesAnterior = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), 0));
    dias += mesAnterior.getUTCDate();
  }
  if (meses < 0) {
    anos  -= 1;
    meses += 12;
  }

  // Venezuela: cada mes iniciado cuenta como mes completo para prestaciones
  const totalMeses    = anos * 12 + meses + (dias > 0 ? 1 : 0);
  const mesesFraccion = totalMeses % 12;
  const totalAnos     = Math.floor(totalMeses / 12);

  return { totalMeses, totalAnos, mesesFraccion, diasExtra: dias, mesesExactos: anos * 12 + meses };
}

/**
 * Meses trabajados en el año calendario corriente (para utilidades fraccionadas).
 * Si el ingreso fue en un año anterior, cuenta desde enero.
 * Si ingresó en el mismo año del egreso, cuenta desde el mes de ingreso.
 */
function mesesEnAñoCalendario(fechaIngreso, fechaEgreso) {
  const inicio = parseFecha(fechaIngreso);
  const fin    = parseFecha(fechaEgreso);

  if (inicio.getUTCFullYear() < fin.getUTCFullYear()) {
    // Año anterior → cuenta desde enero del año de egreso
    return fin.getUTCMonth() + 1;   // Jan=1, May=5, etc.
  }
  // Mismo año → desde el mes de ingreso hasta el mes de egreso (inclusive)
  return fin.getUTCMonth() - inicio.getUTCMonth() + 1;
}

/**
 * Calcula el Salario Diario Integral (SDI) según LOTTT.
 * Fórmula: SDI = SDN × (1 + días_BV/360 + días_util/360 × (1 + días_BV/360))
 *
 * La alícuota de utilidades se calcula sobre el salario que ya incluye la
 * alícuota de bono vacacional (para evitar referencia circular, el Excel
 * aplica: iUtil = SDN × días_util/360 × (1 + días_BV/360)).
 */
function calcularSDI(salarioDiarioNormal, diasBonVac, diasUtilidades) {
  const iBV   = salarioDiarioNormal * diasBonVac / 360;
  const iUtil = salarioDiarioNormal * (diasUtilidades / 360) * (1 + diasBonVac / 360);
  return { iBV, iUtil, sdi: salarioDiarioNormal + iBV + iUtil };
}

/**
 * Núcleo del cálculo de liquidación según Art.142 LOTTT.
 *
 * LIMITACIÓN: se utiliza el salario actual para todos los meses de servicio.
 * Sin histórico de tasas BCV, la garantía acumulada es una aproximación.
 *
 * @param {Object} inputs
 * @param {string} inputs.fechaIngreso            DD/MM/AAAA
 * @param {string} inputs.fechaEgreso             DD/MM/AAAA
 * @param {number} inputs.salarioMensualUSD       Salario mensual en USD
 * @param {number} inputs.tasaBCV                 Tasa BCV (Bs por 1 USD)
 * @param {number} [inputs.bonificacionEspecial=0]  Bonificación no salarial (Bs)
 * @param {number} [inputs.diasUtilidades=30]     Días de utilidades (Art.131, mín 30)
 * @param {number} [inputs.tasaInteresMensual]    Tasa BCV mensual p/prestaciones (Art.143).
 *                                                Default: 3,945% (≈47,34% anual, ref. BCV 2025-2026)
 */
function calcularPrestaciones(inputs) {
  const {
    fechaIngreso,
    fechaEgreso,
    salarioMensualUSD,
    tasaBCV,
    bonificacionEspecial  = 0,
    diasUtilidades        = 30,
    tasaInteresMensual    = 0.03945,
  } = inputs;

  // ── Salarios base (mes de egreso) ─────────────────────────────────────────
  const salarioMensualBs    = salarioMensualUSD * tasaBCV;
  const salarioDiarioNormal = salarioMensualBs / 30;

  // ── Tiempo de servicio ─────────────────────────────────────────────────────
  const { totalMeses, totalAnos, mesesFraccion, diasExtra, mesesExactos } =
    calcularTiempoServicio(fechaIngreso, fechaEgreso);

  // Clave YYYY-MM del mes de egreso (para lookup de tasas)
  const egresoDate   = parseFecha(fechaEgreso);
  const mesEgresoKey = `${egresoDate.getUTCFullYear()}-${String(egresoDate.getUTCMonth() + 1).padStart(2, '0')}`;

  // Fecha de inicio del primer mes de servicio
  const ingresoDate = parseFecha(fechaIngreso);

  // ── Días de bono vacacional y vacaciones ───────────────────────────────────
  const diasBonVacActual = 15 + totalAnos;
  const diasVacActual    = 15 + totalAnos;

  // SDI del período final (para Art.142 C y para mostrar en el resumen)
  const { iBV: incidenciaBonoVac, iUtil: incidenciaUtilidades, sdi: salarioDiarioIntegral } =
    calcularSDI(salarioDiarioNormal, diasBonVacActual, diasUtilidades);

  // ── Art.142 A,B: Garantía trimestral con interés mensual BCV (Art.143) ─────
  // Usa tasa BCV HISTÓRICA de cada mes para calcular el salario de ese mes.
  // Interés simple (no compuesto) sobre el capital acumulado post-depósito.
  let saldoCapital        = 0;
  let interesesAcumulados = 0;
  let sumSdnUtil          = 0;  // acumula (SDN + iBV) de los meses en año calendario
  let contMesesUtil       = 0;  // cantidad de esos meses

  const mesesUtil    = mesesEnAñoCalendario(fechaIngreso, fechaEgreso);
  const residuoMeses = totalMeses % 3;

  for (let mes = 1; mes <= totalMeses; mes++) {
    // Fecha del primer día de este mes de servicio
    const fechaMes = new Date(Date.UTC(
      ingresoDate.getUTCFullYear(),
      ingresoDate.getUTCMonth() + (mes - 1),
      1, 12, 0, 0,
    ));
    const anioMes  = fechaMes.getUTCFullYear();
    const numMes   = fechaMes.getUTCMonth() + 1;

    // Tasa BCV de ese mes (histórica o actual si es el mes de egreso)
    const tasaMes     = getTasaMes(anioMes, numMes, mesEgresoKey, tasaBCV);
    const sdnMes      = salarioMensualUSD * tasaMes / 30;

    // Años completados al inicio de este mes (para días de bono vacacional)
    const añosAlMes   = Math.floor((mes - 1) / 12);
    const diasBvMes   = 15 + añosAlMes;
    const { iBV: iBvMes, sdi: sdiMes } = calcularSDI(sdnMes, diasBvMes, diasUtilidades);

    // Acumular (SDN + iBV) para los meses que caen en el año calendario de egreso
    // (usados en el promedio base de utilidades fraccionadas)
    const egresoAnio = egresoDate.getUTCFullYear();
    const mismoAño   = anioMes === egresoAnio;
    const mismoAñoInicio = ingresoDate.getUTCFullYear() === egresoAnio;
    if (mismoAño && (mismoAñoInicio ? numMes >= ingresoDate.getUTCMonth() + 1 : true)) {
      sumSdnUtil   += sdnMes + iBvMes;
      contMesesUtil += 1;
    }

    // Depósito trimestral (cada 3 meses) y abono al egreso en trimestre incompleto
    if (mes % 3 === 0) {
      saldoCapital += sdiMes * 15;
    }
    if (mes === totalMeses && residuoMeses > 0) {
      saldoCapital += sdiMes * 15;
    }

    // Interés mensual sobre capital (Art.143) — después del depósito
    interesesAcumulados += saldoCapital * tasaInteresMensual;
  }

  const garantiaCapital = saldoCapital;

  // ── Art.142 C: Prestaciones por finalización ────────────────────────────────
  const prestacionesFinalizacion = totalAnos * 30 * salarioDiarioIntegral;

  // ── Art.142 D: Tomar el mayor ───────────────────────────────────────────────
  const prestacionesSociales = Math.max(garantiaCapital, prestacionesFinalizacion);
  const metodoAplicado       = garantiaCapital >= prestacionesFinalizacion ? 'GARANTIA' : 'FINALIZACION';

  // ── Beneficios fraccionados ─────────────────────────────────────────────────

  // Utilidades fraccionadas (Art.131): promedio de (SDN + iBV) para meses del año en curso
  // (evita circularidad con alícuota utilidades, igual que el Excel)
  const salarioBaseUtil    = contMesesUtil > 0 ? sumSdnUtil / contMesesUtil : salarioDiarioNormal + incidenciaBonoVac;
  const diasUtilidadesFrac = diasUtilidades * mesesUtil / 12;
  const utilidadesFracc    = diasUtilidadesFrac * salarioBaseUtil;

  // Vacaciones y bono vacacional fraccionados (Art.196):
  // meses desde el último aniversario hasta el egreso; días del período siguiente.
  const vacacionesFracc = (diasVacActual / 12)    * mesesFraccion * salarioDiarioNormal;
  const bonoVacFracc    = (diasBonVacActual / 12) * mesesFraccion * salarioDiarioNormal;

  // ── Deducciones (Art.172 FAOV / Art.14 INCE) ──────────────────────────────
  // FAOV: 1% del trabajador sobre vacaciones + bono vacacional + utilidades
  // INCE: 0,5% sobre utilidades fraccionadas
  const FAOV = 0.01  * (vacacionesFracc + bonoVacFracc + utilidadesFracc);
  const INCE = 0.005 * utilidadesFracc;

  // ── Totales ─────────────────────────────────────────────────────────────────
  const montoBruto =
    prestacionesSociales +
    interesesAcumulados  +
    utilidadesFracc      +
    vacacionesFracc      +
    bonoVacFracc         +
    bonificacionEspecial;

  const montoAPagar = montoBruto - FAOV - INCE;

  return {
    // Inputs derivados
    salarioMensualBs,
    salarioDiarioNormal,
    salarioDiarioIntegral,
    incidenciaBonoVac,
    incidenciaUtilidades,

    // Tiempo
    totalMeses,
    totalAnos,
    mesesExactos,
    mesesFraccion,
    diasExtra,
    mesesUtil,
    diasBonVac: diasBonVacActual,
    diasVac:    diasVacActual,
    diasUtilidades,

    // Garantía Art.142 A,B
    garantiaCapital,
    totalGarantia: garantiaCapital + interesesAcumulados,
    interesesAcumulados,

    // Finalización Art.142 C
    prestacionesFinalizacion,

    // Resultado Art.142 D
    prestacionesSociales,
    metodoAplicado,

    // Fraccionados
    diasUtilidadesFrac,
    salarioBaseUtil,
    utilidadesFracc,
    vacacionesFracc,
    bonoVacFracc,
    bonificacionEspecial,

    // Deducciones
    FAOV,
    INCE,

    // Totales
    montoBruto,
    montoAPagar,
  };
}

module.exports = { calcularPrestaciones, calcularTiempoServicio, parseFecha };
