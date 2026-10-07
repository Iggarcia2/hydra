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

// Formatea un K para UI/reportes (Infinity → texto legible en vez de "Infinity").
function fmtK(v) { return Number.isFinite(v) ? v.toFixed(2) : '∞ (cerrada)'; }
