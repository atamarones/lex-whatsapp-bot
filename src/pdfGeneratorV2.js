'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');

const PURPLE = '#4B0082';
const GRAY   = '#666666';
const BLACK  = '#111111';
const LIGHT  = '#F5F2FA';
const WHITE  = '#FFFFFF';

function fmt(n) {
  if (n === null || n === undefined) return '–';
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generatePDFV2(data, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    stream.on('error', reject);
    stream.on('finish', resolve);

    const W = doc.page.width - 100;

    // ════════════════════════════════════════════════════════
    // PÁGINA 1 — CÁLCULO
    // ════════════════════════════════════════════════════════
    drawHeader(doc, W);

    sectionTitle(doc, '1. DATOS DEL TRABAJADOR', W);
    const d = data.datos_trabajador ?? {};
    drawKV(doc, [
      ['Nombre y Apellido',      d.nombre],
      ['Cédula de Identidad',    d.cedula],
      ['Empresa',                d.empresa],
      ['Cargo',                  d.cargo],
      ['Tipo de Salario',        d.tipo_salario],
      ['Fecha de Ingreso',       d.fecha_ingreso],
      ['Fecha de Egreso',        d.fecha_egreso],
      ['Tiempo de Servicio',     d.tiempo_servicio],
      ['Salario Mensual',        `Bs. ${fmt(d.salario_mensual)}`],
      ['Salario Diario',         `Bs. ${fmt(d.salario_diario)}`],
      ['Motivo de Terminación',  d.motivo_terminacion],
    ], W);
    doc.moveDown(0.8);

    sectionTitle(doc, '2. ASIGNACIONES', W);
    const conceptos = data.conceptos ?? [];
    drawTable(doc,
      ['CONCEPTO', 'DÍAS', 'Bs./DÍA', 'TOTAL Bs.'],
      conceptos.map(c => [
        c.concepto,
        c.dias !== null && c.dias !== undefined ? String(c.dias) : '–',
        c.monto_diario !== null && c.monto_diario !== undefined ? fmt(c.monto_diario) : '–',
        fmt(c.monto),
      ]),
      W
    );
    const r = data.resumen ?? {};
    drawTotalRow(doc, 'MONTO BRUTO Bs.', fmt(r.monto_bruto), W);
    doc.moveDown(0.8);

    sectionTitle(doc, '3. DEDUCCIONES', W);
    const deds = data.deducciones ?? [];
    drawTable(doc,
      ['CONCEPTO', 'MONTO Bs.'],
      deds.map(d => [d.concepto, fmt(d.monto)]),
      W
    );
    drawTotalRow(doc, 'TOTAL DEDUCCIONES Bs.', fmt(r.total_deducciones), W);
    doc.moveDown(0.8);

    const boxY = doc.y;
    doc.rect(50, boxY, W, 34).fillAndStroke(PURPLE, PURPLE);
    doc.fillColor(WHITE).fontSize(8).font('Helvetica').text(
      `Método aplicado: ${r.metodo_prestaciones ?? '–'}`,
      54, boxY + 6, { width: W - 8 }
    );
    doc.fillColor(WHITE).fontSize(13).font('Helvetica-Bold').text(
      `MONTO NETO A PAGAR: Bs. ${fmt(r.monto_neto)}`,
      54, boxY + 16, { width: W - 8, align: 'center' }
    );
    doc.moveDown(2.5);

    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').text(
      'Este documento es un cálculo referencial basado en la LOTTT (Gaceta Oficial N° 6.076 del 07/05/2012) ' +
      'y el Manual LOTTT 2012 – Cálculo Laboral. No sustituye la liquidación formal del empleador ni constituye asesoría legal. ' +
      (data.explicacion?.es_provisional ? '⚠ RESULTADO PROVISIONAL por datos incompletos.' : ''),
      { align: 'justify', lineGap: 1 }
    );

    drawFooter(doc, W, 1);

    // ════════════════════════════════════════════════════════
    // PÁGINA 2 — EXPLICACIÓN LEGAL
    // ════════════════════════════════════════════════════════
    doc.addPage();
    drawHeader(doc, W);

    const exp = data.explicacion ?? {};

    sectionTitle(doc, '4. METODOLOGÍA DE CÁLCULO APLICADA', W);
    doc.fillColor(BLACK).fontSize(8.5).font('Helvetica')
      .text(exp.metodologia ?? '–', { align: 'justify', lineGap: 2 });
    doc.moveDown(0.8);

    sectionTitle(doc, '5. FUNDAMENTO LEGAL', W);
    doc.fillColor(BLACK).fontSize(8.5).font('Helvetica')
      .text(exp.fundamento_legal ?? '–', { align: 'justify', lineGap: 2 });
    doc.moveDown(0.8);

    sectionTitle(doc, '6. OBSERVACIONES Y CONDICIONES ESPECIALES', W);
    const disclaimerDeducciones =
      'IMPORTANTE: Este cálculo NO contempla deducciones de ley (IVSS, RPE, FAOV, INCE) ' +
      'ni deducciones por préstamos otorgados por el empleador, adelantos salariales u otras ' +
      'deducciones particulares. El monto neto reflejado es referencial y podrá diferir del ' +
      'pago efectivo una vez aplicadas las deducciones correspondientes.';
    const observacionesTexto = exp.observaciones
      ? `${exp.observaciones}\n\n${disclaimerDeducciones}`
      : disclaimerDeducciones;
    doc.fillColor(BLACK).fontSize(8.5).font('Helvetica')
      .text(observacionesTexto, { align: 'justify', lineGap: 2 });
    doc.moveDown(0.8);

    sectionTitle(doc, '7. CUADRO RESUMEN FINAL', W);
    const resumenRows = [
      ...conceptos.map(c => [c.concepto, `Bs. ${fmt(c.monto)}`, c.base_legal ?? '']),
      ...deds.map(d => [`(-) ${d.concepto}`, `Bs. ${fmt(d.monto)}`, '']),
    ];
    drawTable(doc, ['CONCEPTO', 'MONTO', 'BASE LEGAL'], resumenRows, W);
    drawTotalRow(doc, 'TOTAL NETO Bs.', fmt(r.monto_neto), W);

    drawFooter(doc, W, 2);

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function drawHeader(doc, W) {
  doc.fillColor(PURPLE).fontSize(14).font('Helvetica-Bold')
    .text('LEX – SISTEMA LEGAL AUTOMATIZADO', { align: 'center' });
  doc.fillColor(GRAY).fontSize(9).font('Helvetica')
    .text('Cálculo de Liquidación Laboral – LOTTT 2012', { align: 'center' });
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
    .strokeColor(PURPLE).lineWidth(1.5).stroke();
  doc.moveDown(0.6);
}

function sectionTitle(doc, title, W) {
  doc.fillColor(PURPLE).fontSize(9).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(50 + W, doc.y)
    .strokeColor(PURPLE).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
}

function drawKV(doc, rows, W) {
  const c1 = W * 0.42;
  const c2 = W * 0.58;
  let y = doc.y;
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? LIGHT : WHITE;
    doc.rect(50, y, W, 14).fill(bg);
    doc.fillColor(BLACK).fontSize(8).font('Helvetica-Bold').text(row[0], 54, y + 3, { width: c1 });
    doc.fillColor(BLACK).fontSize(8).font('Helvetica').text(String(row[1] ?? '–'), 54 + c1, y + 3, { width: c2 });
    y += 14;
  });
  doc.y = y;
}

function colWidths(cols, W) {
  if (cols === 4) return [W * 0.44, W * 0.14, W * 0.20, W * 0.22];
  if (cols === 2) return [W * 0.68, W * 0.32];
  if (cols === 3) return [W * 0.42, W * 0.20, W * 0.38];
  return Array(cols).fill(W / cols);
}

// Estima líneas necesarias para un texto dado un ancho de columna y tamaño de fuente
function estimarLineas(text, colWidth, fontSize) {
  const avgCharW   = fontSize * 0.52; // factor Helvetica
  const charsXLine = Math.max(1, Math.floor(colWidth / avgCharW));
  return Math.ceil(String(text ?? '–').length / charsXLine);
}

function drawTable(doc, headers, rows, W) {
  const cols    = headers.length;
  const cw      = colWidths(cols, W);
  const PAD     = 4;
  const FS      = 7.5;
  const LINE_H  = 10; // alto por línea a 7.5pt
  const MIN_H   = 18;
  let y = doc.y;

  // Header
  doc.rect(50, y, W, 17).fillAndStroke(PURPLE, PURPLE);
  let xh = 52;
  headers.forEach((h, i) => {
    doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold')
      .text(h, xh, y + 4, { width: cw[i] - PAD, align: i === 0 ? 'left' : 'right', lineBreak: false });
    xh += cw[i];
  });
  y += 17;

  rows.forEach((row, ri) => {
    // Calcular altura por la celda que más líneas necesite
    const lineas = row.map((cell, ci) => estimarLineas(cell, cw[ci] - PAD, FS));
    const rowH   = Math.max(MIN_H, Math.max(...lineas) * LINE_H + 6);

    // Salto de página si no cabe
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      drawHeader(doc, W);
      y = doc.y;
    }

    const bg = ri % 2 === 0 ? LIGHT : WHITE;
    doc.rect(50, y, W, rowH).fill(bg);

    let xr = 52;
    row.forEach((cell, ci) => {
      doc.fillColor(BLACK).fontSize(FS).font('Helvetica')
        .text(String(cell ?? '–'), xr, y + 3, {
          width:     cw[ci] - PAD,
          align:     ci === 0 ? 'left' : 'right',
          lineBreak: true,
        });
      xr += cw[ci];
    });

    y += rowH;
  });
  doc.y = y;
}

function drawTotalRow(doc, label, value, W) {
  const y = doc.y;
  doc.rect(50, y, W, 16).fillAndStroke('#E8E0F0', '#E8E0F0');
  doc.fillColor(PURPLE).fontSize(9).font('Helvetica-Bold')
    .text(label, 54, y + 4, { width: W * 0.6 });
  doc.fillColor(PURPLE).fontSize(9).font('Helvetica-Bold')
    .text(value, 54 + W * 0.3, y + 4, { width: W * 0.68, align: 'right' });
  doc.y = y + 16;
}

// El footer usa y dentro del área segura (< page.height - margin.bottom = 742pt)
// para evitar que PDFKit auto-inserte una página en blanco.
function drawFooter(doc, W, page) {
  const ts  = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
  const footerY = doc.page.height - doc.page.margins.bottom - 20;
  doc.fillColor(GRAY).fontSize(7).font('Helvetica-Oblique').text(
    `Página ${page} | Generado el ${ts} | LegalTrust – Sistema Legal Automatizado`,
    50, footerY,
    { width: W, align: 'center', lineBreak: false }
  );
}

module.exports = { generatePDFV2 };
