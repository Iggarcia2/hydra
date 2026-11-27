// js/nucleo/accesorios.js
'use strict';
/* K de accesorios y válvulas según Crane TP 410 (K = LeD · fT(D)) o modo clásico fijo, más pérdidas por cambio brusco de sección. */

// Rugosidad equivalente de acero comercial limpio en Crane TP 410: 0.00015 ft = 0.04572 mm
const EPS_CRANE_M = 0.00004572;

// Factor de fricción en zona de turbulencia completa fT(D) según Tabla A-26 de Crane TP 410 / Tabla 10.5 de Robert L. Mott
// para tuberías comerciales de acero limpio (con fallback continuo de Nikuradse fuera del rango nominal estándar).
const CRANE_FT_BANDS = [
  [17, 0.027],   // ≤ 1/2"
  [23, 0.025],   // 3/4"
  [30, 0.023],   // 1"   (DN25: 26.6 mm)
  [37, 0.022],   // 1¼"  (DN32: 35.1 mm)
  [45, 0.021],   // 1½"  (DN40: 40.9 mm)
  [57, 0.019],   // 2"   (DN50: 52.5 mm)
  [85, 0.018],   // 2½"–3" (DN65–DN80: 62.7–77.9 mm)
  [115, 0.017],  // 4"   (DN100: 102.3 mm)
  [140, 0.016],  // 5"   (DN125: 128.2 mm)
  [175, 0.015],  // 6"   (DN150: 154.1 mm)
  [275, 0.014],  // 8"–10" (DN200–DN250: 202.7–254.5 mm)
  [400, 0.013],  // 12"–16" (DN300–DN400: 303.2–381.0 mm)
  [620, 0.012],  // 18"–24" (DN450–DN600: 428.65–574.65 mm)
];
function craneFt(D_mm) {
  const d = (Number.isFinite(+D_mm) && +D_mm > 0) ? +D_mm : 52.5;
  for (let i = 0; i < CRANE_FT_BANDS.length; i++) {
    if (d <= CRANE_FT_BANDS[i][0]) return CRANE_FT_BANDS[i][1];
  }
  const d_m = d / 1000;
  const eD = Math.min(Math.max(EPS_CRANE_M / d_m, 1e-7), 0.1);
  return 0.25 / Math.pow(Math.log10(eD / 3.7), 2);
}

// Pérdida menor por expansión brusca (Borda-Carnot): K = (1 - (D1/D2)²)², referenciado a la velocidad de la tubería menor D1.
function kSuddenExpansion(D1_mm, D2_mm) {
  if (!(D1_mm > 0 && D2_mm > D1_mm)) return 0;
  const beta2 = Math.pow(D1_mm / D2_mm, 2);
  return Math.pow(1 - beta2, 2);
}

// Pérdida menor por contracción brusca (fórmula empírica Crane TP 410 / Idelchik): K ≈ 0.5 · (1 - (D2/D1)²), referenciado a la tubería menor D2.
function kSuddenContraction(D1_mm, D2_mm) {
  if (!(D2_mm > 0 && D1_mm > D2_mm)) return 0;
  const beta2 = Math.pow(D2_mm / D1_mm, 2);
  return 0.5 * (1 - beta2);
}

// Interpola K (log-lineal entre puntos tabulados) según % de apertura sobre la curva base.
// Si se pasa `D_mm` y `kMethod !== 'fixed'`, escala proporcionalmente al K abierto de Crane TP 410: K_open = LeD · fT(D_mm).
function valveKAtPct(curveKey, pct, D_mm, kMethod) {
  const curve = VALVE_OPENING_CURVES[curveKey];
  if (!curve) return 0;
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 100));
  if (p <= 0) return Infinity;
  let kBase;
  if (p >= 100) {
    kBase = curve[0][1];
  } else {
    for (let i = 0; i < curve.length - 1; i++) {
      const [pHi, kHi] = curve[i], [pLo, kLo] = curve[i + 1];
      if (p <= pHi && p >= pLo) {
        const t = (p - pLo) / (pHi - pLo);
        kBase = Math.pow(10, Math.log10(kLo) + t * (Math.log10(kHi) - Math.log10(kLo)));
        break;
      }
    }
    if (kBase === undefined) {
      const [pA, kA] = curve[curve.length - 2], [pB, kB] = curve[curve.length - 1];
      const slope = (Math.log10(kB) - Math.log10(kA)) / (pB - pA);
      kBase = Math.pow(10, Math.log10(kB) + slope * (p - pB));
    }
  }
  const useCrane = (kMethod || 'crane') !== 'fixed' && D_mm != null && Number.isFinite(+D_mm) && +D_mm > 0;
  const led = (typeof VALVE_CRANE_LED !== 'undefined') ? VALVE_CRANE_LED[curveKey] : null;
  if (useCrane && led) {
    const kOpenCrane = led * craneFt(+D_mm);
    return kBase * (kOpenCrane / curve[0][1]);
  }
  return kBase;
}

// K individual de un accesorio i en el arco `arc` (útil tanto para el cálculo como para mostrar en la tabla del panel).
function fittingUnitK(arc, i) {
  const f = FITTINGS[i];
  if (!f) return 0;
  const kMethod = (arc && arc.kMethod) || 'crane';
  const D_mm = arc ? arc.D_mm : null;
  const fitOpen = (arc && arc.fitOpen) || [];
  if (f.curve) {
    return valveKAtPct(f.curve, fitOpen[i] ?? 100, D_mm, kMethod);
  }
  if (kMethod !== 'fixed' && f.LeD && D_mm != null && Number.isFinite(+D_mm) && +D_mm > 0) {
    return f.LeD * craneFt(+D_mm);
  }
  return f.k || 0;
}

// Suma de K de accesorios instalados en un tramo.
function fittingsK(arc) {
  const fitQty = arc.fitQty || [];
  let k = 0;
  for (let i = 0; i < FITTINGS.length; i++) {
    const q = fitQty[i] || 0;
    if (q <= 0) continue;
    const ku = fittingUnitK(arc, i);
    if (!Number.isFinite(ku)) return Infinity;
    k += q * ku;
  }
  return k;
}

// K total del tramo = accesorios + K adicional manual + válvula dedicada (si arc.type === 'valve').
function arcTotalK(arc) {
  let k = fittingsK(arc) + (arc.customK || 0);
  if (arc.type === 'valve' && VALVE_OPENING_CURVES[arc.valveType]) {
    const kv = valveKAtPct(arc.valveType, arc.open_pct ?? 100, arc.D_mm, arc.kMethod || 'crane');
    if (!Number.isFinite(kv)) return Infinity;
    k += kv;
  }
  return k;
}

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
      kUnit: fittingUnitK(arc, i),
      tipo: f.curve ? (VALVE_TYPE_LABELS[f.curve] || '') : null,
      apertura: f.curve ? (fitOpen[i] ?? 100) : null,
    });
  }
  if (arc.type === 'valve' && VALVE_OPENING_CURVES[arc.valveType]) {
    rows.push({
      accesorio: 'Elemento válvula',
      cantidad: 1,
      kUnit: valveKAtPct(arc.valveType, arc.open_pct ?? 100, arc.D_mm, arc.kMethod || 'crane'),
      tipo: VALVE_TYPE_LABELS[arc.valveType] || '',
      apertura: arc.open_pct ?? 100,
    });
  }
  return rows;
}
