'use strict';

const Airtable = require('airtable');

let _base = null;

function getBase() {
  if (_base) return _base;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error('AIRTABLE_API_KEY y AIRTABLE_BASE_ID requeridos');
  _base = new Airtable({ apiKey }).base(baseId);
  return _base;
}

const TABLE = () => process.env.AIRTABLE_TABLE ?? 'Liquidaciones';

/**
 * Guarda un registro de liquidación en Airtable.
 * Si falla, solo loguea — no interrumpe el flujo principal.
 */
async function guardarRegistro(datos) {
  try {
    await getBase()(TABLE()).create([{
      fields: {
        'Cédula':              String(datos.cedula ?? ''),
        'Nombre':              String(datos.nombre ?? ''),
        'Empresa':             String(datos.empresa ?? ''),
        'Cargo':               String(datos.cargo ?? ''),
        'Móvil':               String(datos.movil ?? ''),
        'Fecha Ingreso':       String(datos.fechaIngreso ?? ''),
        'Fecha Egreso':        String(datos.fechaEgreso ?? ''),
        'Tiempo Servicio':     String(datos.tiempoServicio ?? ''),
        'Salario Mensual Bs':  Number(datos.salarioMensualBs ?? 0),
        'Tipo Salario':        String(datos.tipoSalario ?? 'FIJO'),
        'Motivo Terminación':  String(datos.motivoTerminacion ?? ''),
        'Método Prestaciones': String(datos.metodoAplicado ?? ''),
        'Monto Bruto Bs':      Number(datos.montoBruto ?? 0),
        'Deducciones Bs':      Number(datos.totalDeducciones ?? 0),
        'Monto Neto Bs':       Number(datos.montoNeto ?? 0),
        'Canal':               String(datos.canal ?? 'API'),
        'Fecha Cálculo':       new Date().toISOString().slice(0, 10),
      },
    }]);
    console.log(`[airtable] registro guardado: ${datos.cedula} – ${datos.nombre}`);
  } catch (err) {
    console.error('[airtable] error al guardar registro:', err.message);
  }
}

/**
 * Busca el registro más reciente por cédula o móvil y actualiza el feedback.
 * Si no encuentra registro previo, crea uno nuevo solo con el feedback.
 */
async function guardarFeedback({ cedula, movil, valoracion, razon }) {
  try {
    const base = getBase();
    const tabla = TABLE();

    // Buscar registro más reciente por cédula o móvil
    const filtro = cedula
      ? `{Cédula}="${cedula}"`
      : `{Móvil}="${movil}"`;

    const registros = await base(tabla).select({
      filterByFormula: filtro,
      sort: [{ field: 'Fecha Cálculo', direction: 'desc' }],
      maxRecords: 1,
    }).firstPage();

    const campos = {
      'Valoración': String(valoracion ?? ''),
      ...(razon ? { 'Razón': String(razon) } : {}),
    };

    if (registros.length > 0) {
      await base(tabla).update(registros[0].id, campos);
      console.log(`[airtable] feedback actualizado: ${cedula ?? movil}`);
    } else {
      await base(tabla).create([{
        fields: {
          'Cédula': String(cedula ?? ''),
          'Móvil':  String(movil ?? ''),
          'Canal':  'FEEDBACK',
          'Fecha Cálculo': new Date().toISOString().slice(0, 10),
          ...campos,
        },
      }]);
      console.log(`[airtable] feedback sin registro previo, creado nuevo: ${cedula ?? movil}`);
    }
  } catch (err) {
    console.error('[airtable] error al guardar feedback:', err.message);
  }
}

module.exports = { guardarRegistro, guardarFeedback };
