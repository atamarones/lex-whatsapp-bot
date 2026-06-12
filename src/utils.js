'use strict';

/** Formatea número como Bs. con separadores venezolanos (punto miles, coma decimal) */
function formatBs(amount) {
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Formatea fecha Date → DD/MM/YYYY */
function formatFecha(date) {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** Parsea DD/MM/YYYY → Date (UTC mediodía) */
function parseFecha(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Valida formato DD/MM/YYYY y que sea fecha real */
function isValidFecha(str) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return false;
  const [d, m, y] = str.split('/').map(Number);
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Limpia cédula: quita V-, v-, espacios → deja solo dígitos */
function limpiarCedula(raw) {
  return raw.replace(/[Vv\-\s]/g, '').trim();
}

/** Extrae número de un string (acepta coma o punto como decimal) */
function parseNumber(str) {
  const clean = str.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/** Timestamp legible para PDFs y logs */
function timestampLabel() {
  return new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
}

module.exports = { formatBs, formatFecha, parseFecha, isValidFecha, limpiarCedula, parseNumber, timestampLabel };
