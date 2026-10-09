// js/nucleo/utilidades.js
'use strict';
/* Utilidades puras: escape de HTML, lectura de números con coma o punto y formato de K. */

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY — HTML escaping (aplicar a TODO string de usuario antes de innerHTML)
// ══════════════════════════════════════════════════════════════════════════════
function esc(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// [v19] Acepta coma o punto como separador decimal (teclado/config regional AR-ES). Si hay
// coma Y punto juntos asume formato "miles.decimal" con coma de miles (ej. "1,234.5"->1234.5);
// si hay solo coma, la trata como decimal (ej. "150,5"->150.5). Devuelve NaN si no es un
// número válido — el que llama decide qué hacer (nunca se asume 0 acá).
function parseLocaleFloat(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // [v20] Aparecen los dos separadores: el que esté MÁS A LA DERECHA es el decimal (sea cual
    // sea la convención regional), el otro se descarta como separador de miles. Antes se asumía
    // siempre la convención US (coma=miles, punto=decimal), lo que rompía "1.234,56" en formato
    // local (daba 1.234 en vez de 1234,56) — ahora cubre ambas convenciones sin asumir una sola.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// [v26.1] Texto de una tabla de curva (una fila por punto: «Q  valor», para H-Q o P-Q) → puntos {Q, [clave]: valor}.
// Separadores de columna: tabulación, punto y coma o espacios; la COMA ES DECIMAL («7,5  60,8»; también «7,5;60,8» de una planilla en español).
// Una fila con un solo valor («50,30», «7,5») es ambigua (¿dos columnas o un decimal?) y se rechaza. En v25 la coma separaba columnas siempre, así que
// «7,5  60,8» se leía como Q = 7 y H = 5, y una fila ilegible se guardaba como 0 sin avisar: la curva de la bomba (y el punto de operación) salían mal.
// Devuelve {puntos, errores}: errores lista los números de fila (desde 1) que no son exactamente dos números finitos y no negativos.
// Las filas en blanco y las (0; 0) se ignoran.
function parsearTablaCurva(texto, clave) {
  const puntos = [], errores = [];
  String(texto ?? '').split(/\r?\n/).forEach((fila, i) => {
    if (fila.trim() === '') return;
    const celdas = fila.trim().split(/[\t;\s]+/);
    const v = celdas.map(parseLocaleFloat);
    if (celdas.length !== 2 || !v.every(x => Number.isFinite(x) && x >= 0)) { errores.push(i + 1); return; }
    if (v[0] > 0 || v[1] > 0) puntos.push({ Q: v[0], [clave]: v[1] });
  });
  return { puntos, errores };
}

// Formatea un K para UI/reportes (Infinity → texto legible en vez de "Infinity").
function fmtK(v) { return Number.isFinite(v) ? v.toFixed(2) : '∞ (cerrada)'; }
