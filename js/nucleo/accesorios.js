// js/nucleo/accesorios.js
'use strict';
/* K de accesorios y válvulas: fuente única de la pérdida localizada de un tramo. */

// Interpola K (log-lineal entre puntos tabulados) según % de apertura.
// pct<=0 → Infinity (válvula cerrada, ver fittingsK/pipeCalc para el bloqueo del tramo).
function valveKAtPct(curveKey, pct) {
  const curve = VALVE_OPENING_CURVES[curveKey];
  if (!curve) return 0;
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 100));
  if (p <= 0) return Infinity;
  if (p >= 100) return curve[0][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [pHi, kHi] = curve[i], [pLo, kLo] = curve[i+1];
    if (p <= pHi && p >= pLo) {
      const t = (p - pLo) / (pHi - pLo);
      return Math.pow(10, Math.log10(kLo) + t * (Math.log10(kHi) - Math.log10(kLo)));
    }
  }
  // Por debajo del último punto tabulado (10%): extrapola la misma pendiente log-lineal.
  const [pA,kA] = curve[curve.length-2], [pB,kB] = curve[curve.length-1];
  const slope = (Math.log10(kB) - Math.log10(kA)) / (pB - pA);
  return Math.pow(10, Math.log10(kB) + slope*(p - pB));
}

// Fuente única de verdad para el K de accesorios de un tramo (fitQty × K, con curva si aplica).
// Usado por el solver (pipeCalc) y por toda la UI/exportaciones — evita fórmulas duplicadas.
function fittingsK(arc) {
  const fitQty = arc.fitQty || [];
  const fitOpen = arc.fitOpen || [];
  let k = 0;
  for (let i = 0; i < FITTINGS.length; i++) {
    const q = fitQty[i] || 0;
    if (q <= 0) continue;
    const f = FITTINGS[i];
    if (!f) continue;
    if (f.curve) {
      const kv = valveKAtPct(f.curve, fitOpen[i] ?? 100);
      if (!Number.isFinite(kv)) return Infinity; // válvula cerrada → tramo bloqueado
      k += q * kv;
    } else {
      k += q * (f.k || 0);
    }
  }
  return k;
}

// K total del tramo = accesorios + K adicional manual. Puede ser Infinity (válvula al 0%).
function arcTotalK(arc) {
  let k = fittingsK(arc) + (arc.customK||0);
  // [v21] El elemento Valvula dedicado (arc.type==='valve') tiene su propio % de apertura,
  // conectado a las MISMAS curvas K-vs-apertura que ya usan los accesorios tipo valvula (ver
  // VALVE_OPENING_CURVES) -- se suma aca, en la unica fuente de verdad del K de un tramo, para
  // que el solver y toda la UI/PDF lo vean automaticamente sin duplicar la formula en otro lado.
  if (arc.type === 'valve' && VALVE_OPENING_CURVES[arc.valveType]) {
    const kv = valveKAtPct(arc.valveType, arc.open_pct ?? 100);
    if (!Number.isFinite(kv)) return Infinity; // 0% de apertura -> tramo bloqueado
    k += kv;
  }
  return k;
}

// [v21] Filas de "accesorios / elementos con apertura" de un tramo, para el informe PDF
// (sección 4.1 Accesorios por tramo). Devuelve un array de {accesorio, cantidad, tipo, apertura}:
// una entrada por cada accesorio con cantidad>0 (fitQty/fitOpen, igual fuente que fittingsK),
// más — si el propio tramo ES un elemento Válvula dedicado con curva K-vs-apertura — una fila
// extra para el tramo mismo (usa arc.valveType/arc.open_pct, igual fuente que arcTotalK).
// tipo/apertura quedan null cuando no aplica (accesorios sin curva: codos, tees, filtro,
// válvula de retención) — el llamador decide cómo mostrar eso ('-', celda vacía, etc.).
function arcAccessoryRows(arc) {
  const rows = [];
  const fitQty = arc.fitQty || [];
  const fitOpen = arc.fitOpen || [];
  for (let i = 0; i < FITTINGS.length; i++) {
    const q = fitQty[i] || 0;
    if (q <= 0) continue;
    const f = FITTINGS[i];
    if (!f) continue;
    rows.push({
      accesorio: f.name,
      cantidad: q,
      tipo: f.curve ? (VALVE_TYPE_LABELS[f.curve] || '') : null,
      apertura: f.curve ? (fitOpen[i] ?? 100) : null,
    });
  }
  if (arc.type === 'valve' && VALVE_OPENING_CURVES[arc.valveType]) {
    rows.push({
      accesorio: 'Elemento válvula',
      cantidad: 1,
      tipo: VALVE_TYPE_LABELS[arc.valveType] || '',
      apertura: arc.open_pct ?? 100,
    });
  }
  return rows;
}
