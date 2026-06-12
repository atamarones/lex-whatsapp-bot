'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const { formatBs, timestampLabel } = require('./utils');

const PURPLE = '#4B0082';
const GRAY   = '#555555';
const BLACK  = '#000000';
const LIGHT  = '#F5F5F5';

/**
 * Genera la planilla de liquidación en PDF.
 * @param {Object} opts
 * @param {Object} opts.workerData   - Datos del trabajador (fullName, cedula, cargo, etc.)
 * @param {Object} opts.calcResult   - Resultado de calcularPrestaciones()
 * @param {string} opts.outputPath   - Ruta de salida del archivo PDF
 */
function generatePDF({ workerData: d, calcResult: r, outputPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    stream.on('error', reject);
    stream.on('finish', resolve);

    const pageW = doc.page.width - 100; // ancho útil

    // ── ENCABEZADO ───────────────────────────────────────────────────────────
    doc
      .fillColor(PURPLE)
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('LEX – SISTEMA LEGAL AUTOMATIZADO', { align: 'center' });

    doc
      .fontSize(9)
      .fillColor(GRAY)
      .text('RIF: J-00000000-0', { align: 'center' });

    doc.moveDown(0.3);

    doc
      .fillColor(PURPLE)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('LIQUIDACIÓN DE PRESTACIONES SOCIALES Y BENEFICIOS LABORALES', { align: 'center' });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(PURPLE).lineWidth(1.5).stroke();
    doc.moveDown(0.6);

    // ── SECCIÓN 1: Datos del trabajador ──────────────────────────────────────
    sectionTitle(doc, '1. DATOS DEL TRABAJADOR');

    const workerRows = [
      ['Nombre y Apellido', d.fullName],
      ['Cédula de Identidad', `V-${d.cedula}`],
      ['Cargo', d.cargo],
      ['Tipo de Nómina', d.tipoNomina],
      ['Fecha de Ingreso', d.fechaIngreso],
      ['Fecha de Egreso', d.fechaEgreso],
      ['Tiempo de Servicio', `${r.totalAnos} año(s) y ${r.mesesFraccion} mes(es)`],
      ['Salario Mensual USD', `$ ${d.salarioMensualUSD?.toFixed(2)}`],
      ['Tasa BCV', `${d.tasaBCV} Bs/$`],
      ['Salario Mensual Bs.', `Bs. ${formatBs(r.salarioMensualBs)}`],
      ['Salario Diario Normal', `Bs. ${formatBs(r.salarioDiarioNormal)}`],
      ['Salario Diario Integral', `Bs. ${formatBs(r.salarioDiarioIntegral)}`],
      ['Motivo de Retiro', d.motivoRetiro?.replace(/_/g, ' ')],
    ];
    drawKeyValueTable(doc, workerRows, pageW);
    doc.moveDown(0.8);

    // ── SECCIÓN 2: Cálculo referencial Art.142 ────────────────────────────────
    sectionTitle(doc, '2. CÁLCULO REFERENCIAL ART. 142 LOTTT');

    const refRows = [
      ['Días acumulados garantía (Art.142 A,B)', `${(Math.floor(r.totalMeses / 3) * 15)} días`],
      ['Garantía capital (antes de intereses)', `Bs. ${formatBs(r.garantiaCapital)}`],
      ['Prestaciones por finalización (Art.142 C)', `Bs. ${formatBs(r.prestacionesFinalizacion)}`],
      ['Método aplicado (Art.142 D – el mayor)', r.metodoAplicado],
    ];
    drawKeyValueTable(doc, refRows, pageW);
    doc.moveDown(0.8);

    // ── SECCIÓN 3: Asignaciones ───────────────────────────────────────────────
    sectionTitle(doc, '3. ASIGNACIONES');

    const asignHeaders = ['CONCEPTO', 'DÍAS', 'Bs./DÍA', 'TOTAL Bs.'];
    const asignRows = [
      ['Prestaciones Sociales', String(Math.floor(r.totalMeses / 3) * 15), formatBs(r.salarioDiarioIntegral), formatBs(r.prestacionesSociales)],
      ['Intereses Art.143 LOTTT', '–', '–', formatBs(r.interesesAcumulados)],
      [`Utilidades Fracc. (${r.diasUtilidades} días)`, formatBs(r.diasUtilidades / 12 * r.mesesFraccion), formatBs(r.salarioDiarioIntegral), formatBs(r.utilidadesFracc)],
      [`Vacaciones Fracc. (${r.diasVac} días)`, formatBs(r.diasVac / 12 * r.mesesFraccion), formatBs(r.salarioDiarioNormal), formatBs(r.vacacionesFracc)],
      [`Bono Vacacional Fracc. (${r.diasBonVac} días)`, formatBs(r.diasBonVac / 12 * r.mesesFraccion), formatBs(r.salarioDiarioNormal), formatBs(r.bonoVacFracc)],
      ['Bonificación Especial', '–', '–', formatBs(r.bonificacionEspecial)],
    ];
    drawTable(doc, asignHeaders, asignRows, pageW);

    // Fila MONTO BRUTO
    drawTotalRow(doc, 'MONTO BRUTO Bs.', formatBs(r.montoBruto), pageW);
    doc.moveDown(0.8);

    // ── SECCIÓN 4: Deducciones ────────────────────────────────────────────────
    sectionTitle(doc, '4. DEDUCCIONES');

    const dedHeaders = ['CONCEPTO', 'TASA', 'MESES', 'TOTAL Bs.'];
    const dedRows = [
      ['FAOV (Fondo Habitacional)', '0,132%', String(r.totalMeses), formatBs(r.FAOV)],
      ['INCE (Educación)', '0,044%', String(r.totalMeses), formatBs(r.INCE)],
    ];
    drawTable(doc, dedHeaders, dedRows, pageW);
    drawTotalRow(doc, 'TOTAL DEDUCCIONES Bs.', formatBs(r.FAOV + r.INCE), pageW);
    doc.moveDown(0.8);

    // ── SECCIÓN 5: Monto a pagar ─────────────────────────────────────────────
    const boxY = doc.y;
    doc
      .rect(50, boxY, pageW, 30)
      .fillAndStroke(PURPLE, PURPLE);
    doc
      .fillColor('white')
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(`MONTO A PAGAR: Bs. ${formatBs(r.montoAPagar)}`, 50, boxY + 8, { width: pageW, align: 'center' });
    doc.moveDown(2.2);

    // ── SECCIÓN 6: Disclaimer legal ───────────────────────────────────────────
    doc
      .fillColor(GRAY)
      .fontSize(7.5)
      .font('Helvetica')
      .text(
        'El presente documento es un cálculo referencial basado en la Ley Orgánica del Trabajo, los Trabajadores y las Trabajadoras (LOTTT), ' +
        'Gaceta Oficial N° 6.076 del 07/05/2012. Los montos indicados corresponden a las prestaciones sociales y beneficios legales calculados ' +
        'conforme a los datos suministrados por el trabajador. Este documento no sustituye la liquidación formal emitida por el empleador, ' +
        'ni constituye asesoría legal. Se recomienda la revisión por parte de un profesional del área laboral.',
        { align: 'justify', lineGap: 1 }
      );
    doc.moveDown(1);

    // ── SECCIÓN 7: Firmas ─────────────────────────────────────────────────────
    drawSignatureLines(doc, pageW);

    // ── FOOTER ───────────────────────────────────────────────────────────────
    doc
      .fillColor(GRAY)
      .fontSize(7)
      .font('Helvetica-Oblique')
      .text(
        `Generado el ${timestampLabel()} | Calculado mediante sistema automatizado LexBot`,
        50,
        doc.page.height - 40,
        { align: 'center', width: pageW }
      );

    doc.end();
  });
}

// ── Helpers de layout ────────────────────────────────────────────────────────

function sectionTitle(doc, title) {
  doc
    .fillColor(PURPLE)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(title.toUpperCase())
    .moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(PURPLE).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
}

function drawKeyValueTable(doc, rows, width) {
  const colW = [width * 0.42, width * 0.58];
  let y = doc.y;
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? LIGHT : 'white';
    doc.rect(50, y, width, 14).fill(bg);
    doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text(row[0], 54, y + 3, { width: colW[0] });
    doc.fillColor(BLACK).fontSize(8).font('Helvetica').text(String(row[1] ?? '–'), 54 + colW[0], y + 3, { width: colW[1] });
    y += 14;
  });
  doc.y = y;
}

function drawTable(doc, headers, rows, width) {
  const cols = headers.length;
  const colW = width / cols;
  let y = doc.y;

  // Header
  doc.rect(50, y, width, 16).fillAndStroke(PURPLE, PURPLE);
  headers.forEach((h, i) => {
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold').text(h, 52 + i * colW, y + 4, { width: colW - 4, align: i > 0 ? 'right' : 'left' });
  });
  y += 16;

  // Rows
  rows.forEach((row, ri) => {
    const bg = ri % 2 === 0 ? LIGHT : 'white';
    doc.rect(50, y, width, 14).fill(bg);
    row.forEach((cell, ci) => {
      doc.fillColor(BLACK).fontSize(7.5).font('Helvetica').text(String(cell), 52 + ci * colW, y + 3, { width: colW - 4, align: ci > 0 ? 'right' : 'left' });
    });
    y += 14;
  });
  doc.y = y;
}

function drawTotalRow(doc, label, value, width) {
  const y = doc.y;
  doc.rect(50, y, width, 16).fillAndStroke('#E8E0F0', '#E8E0F0');
  doc.fillColor(PURPLE).fontSize(9).font('Helvetica-Bold').text(label, 54, y + 4, { width: width * 0.7 });
  doc.fillColor(PURPLE).fontSize(9).font('Helvetica-Bold').text(value, 54 + width * 0.3, y + 4, { width: width * 0.68, align: 'right' });
  doc.y = y + 16;
}

function drawSignatureLines(doc, width) {
  const signW = width / 3 - 10;
  const labels = ['ADMINISTRACIÓN', 'REVISADO POR', 'RECIBIDO POR'];
  const y = doc.y + 20;

  labels.forEach((label, i) => {
    const x = 50 + i * (width / 3 + 5);
    doc.moveTo(x, y + 30).lineTo(x + signW, y + 30).strokeColor('#AAAAAA').lineWidth(0.8).stroke();
    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').text(label, x, y + 33, { width: signW, align: 'center' });
    if (label === 'RECIBIDO POR') {
      doc.fillColor(GRAY).fontSize(7).text('C.I.: _______________', x, y + 43, { width: signW, align: 'center' });
    }
  });
}

module.exports = { generatePDF };
