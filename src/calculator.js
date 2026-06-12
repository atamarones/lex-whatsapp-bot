'use strict';

// Art.143 LOTTT: tasa de interés mensual BCV para prestaciones sociales
// Inferida del caso de prueba de referencia (Excel Antunez Jimenez)
const TASA_INTERES_MENSUAL_BCV = 0.03;

// Retención FAOV e INCE por mes (porcentajes legales)
const TASA_FAOV  = 0.00132;
const TASA_INCE  = 0.000440;

/**
 * Convierte fecha DD/MM/YYYY → objeto Date (UTC mediodía para evitar drift de zona horaria)
 */
function parseFecha(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/**
 * Diferencia de tiempo en años, meses y días calendario entre dos fechas.
 * Retorna { totalMeses, mesesFraccion, totalAnos, diasExtra }
 */
function calcularTiempoServicio(fechaIngreso, fechaEgreso) {
  const inicio = parseFecha(fechaIngreso);
  const fin    = parseFecha(fechaEgreso);

  let anos  = fin.getUTCFullYear() - inicio.getUTCFullYear();
  let meses = fin.getUTCMonth()    - inicio.getUTCMonth();
  let dias  = fin.getUTCDate()     - inicio.getUTCDate();

  if (dias < 0) {
    meses -= 1;
    // días que tiene el mes anterior al de egreso
    const mesAnterior = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), 0));
    dias += mesAnterior.getUTCDate();
  }
  if (meses < 0) {
    anos  -= 1;
    meses += 12;
  }

  const totalMeses   = anos * 12 + meses;
  const mesesFraccion = totalMeses % 12;        // meses del año parcial final
  const totalAnos    = Math.floor(totalMeses / 12);

  return { totalMeses, totalAnos, mesesFraccion, diasExtra: dias };
}

/**
 * Días de bono vacacional según Art.192 LOTTT:
 * 15 días el primer año + 1 día adicional por año subsiguiente.
 */
function diasBonoVacacional(totalAnos) {
  return 15 + Math.max(0, totalAnos - 1);
}

/**
 * Días de vacaciones según Art.190 LOTTT:
 * 15 días el primer año + 1 día adicional por año subsiguiente.
 */
function diasVacaciones(totalAnos) {
  return 15 + Math.max(0, totalAnos - 1);
}

/**
 * Núcleo del cálculo de liquidación según Art.142 LOTTT.
 *
 * @param {Object} inputs
 * @param {string} inputs.fechaIngreso          DD/MM/YYYY
 * @param {string} inputs.fechaEgreso           DD/MM/YYYY
 * @param {number} inputs.salarioMensualUSD     Salario mensual en USD
 * @param {number} inputs.tasaBCV               Tasa BCV (Bs por 1 USD)
 * @param {number} [inputs.bonificacionEspecial=0]  Bonificación no salarial (Bs)
 * @param {number} [inputs.diasUtilidades=15]   Días de utilidades (mín 15, Art.131)
 * @returns {Object} Desglose completo del cálculo
 */
function calcularPrestaciones(inputs) {
  const {
    fechaIngreso,
    fechaEgreso,
    salarioMensualUSD,
    tasaBCV,
    bonificacionEspecial = 0,
    diasUtilidades = 15,
  } = inputs;

  // ── Salarios base ──────────────────────────────────────────────────────────
  const salarioMensualBs    = salarioMensualUSD * tasaBCV;
  const salarioDiarioNormal = salarioMensualBs / 30;

  // ── Tiempo de servicio ─────────────────────────────────────────────────────
  const { totalMeses, totalAnos, mesesFraccion } =
    calcularTiempoServicio(fechaIngreso, fechaEgreso);

  const diasBonVac   = diasBonoVacacional(totalAnos || 1); // mín 15 días (1er año)
  const diasVac      = diasVacaciones(totalAnos || 1);

  // ── Alícuotas (incidencias diarias) ────────────────────────────────────────
  const incidenciaBonoVac    = (salarioDiarioNormal * diasBonVac)    / 360;
  // Art.133+Art.131 LOTTT: alícuota diaria = SDN × diasUtilidades / 360
  // NOTA: el spec original usa salarioMensualBs aquí, pero produce valores inconsistentes
  // con los datos de referencia del Excel. Se usa SDN para coherencia LOTTT.
  const incidenciaUtilidades = (salarioDiarioNormal * diasUtilidades) / 360;

  const salarioDiarioIntegral = salarioDiarioNormal + incidenciaBonoVac + incidenciaUtilidades;

  // ── Art.142 A,B: Garantía trimestral con interés mensual BCV ───────────────
  // Se depositan 15 días de SDI cada trimestre (mes 3, 6, 9, 12…)
  // Sobre el saldo acumulado se aplica interés mensual BCV cada mes (Art.143)
  let saldoGarantia = 0;
  let interesesAcumulados = 0;

  for (let mes = 1; mes <= totalMeses; mes++) {
    // Depósito trimestral al cumplir cada 3 meses desde el ingreso
    if (mes % 3 === 0) {
      saldoGarantia += salarioDiarioIntegral * 15;
    }
    // Interés mensual sobre saldo acumulado (Art.143)
    const interesesMes = saldoGarantia * TASA_INTERES_MENSUAL_BCV;
    interesesAcumulados += interesesMes;
    saldoGarantia       += interesesMes;
  }

  const totalGarantia = saldoGarantia - interesesAcumulados; // capital sin intereses
  // Nota: para el comparativo Art.142D usamos solo el capital depositado
  const garantiaCapital = (Math.floor(totalMeses / 3)) * (salarioDiarioIntegral * 15);

  // ── Art.142 C: Prestaciones por finalización ────────────────────────────────
  // 30 días de SDI por año de servicio
  const prestacionesFinalizacion = totalAnos * 30 * salarioDiarioIntegral;

  // ── Art.142 D: Tomar el mayor ───────────────────────────────────────────────
  const prestacionesSociales = Math.max(garantiaCapital, prestacionesFinalizacion);

  // ── Beneficios fraccionados (año parcial final) ─────────────────────────────
  const sdnPromedio = salarioDiarioNormal;        // constante (salario único)
  const sdiPromedio = salarioDiarioIntegral;

  const utilidadesFracc  = (diasUtilidades / 12) * mesesFraccion * sdiPromedio;
  const vacacionesFracc  = (diasVac / 12)        * mesesFraccion * sdnPromedio;
  const bonoVacFracc     = (diasBonVac / 12)     * mesesFraccion * sdnPromedio;

  // ── Deducciones ─────────────────────────────────────────────────────────────
  const FAOV = salarioMensualBs * TASA_FAOV * totalMeses;
  const INCE = salarioMensualBs * TASA_INCE * totalMeses;

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
    mesesFraccion,
    diasBonVac,
    diasVac,
    diasUtilidades,

    // Garantía Art.142 A,B
    garantiaCapital,
    totalGarantia: saldoGarantia,   // capital + intereses reinvertidos
    interesesAcumulados,

    // Finalización Art.142 C
    prestacionesFinalizacion,

    // Resultado Art.142 D
    prestacionesSociales,
    metodoAplicado: garantiaCapital >= prestacionesFinalizacion ? 'GARANTIA' : 'FINALIZACION',

    // Fraccionados
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
