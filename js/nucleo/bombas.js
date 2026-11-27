// js/nucleo/bombas.js
'use strict';
/* Curvas de bomba: carga H-Q, corrección por viscosidad según ANSI/HI 9.6.7 y potencia de eje escalada por densidad y viscosidad. */

// Estima el punto de máxima eficiencia (BEP) en agua a partir de la curva H-Q (y P-Q si está disponible).
function _estimateWaterBEP(pts, powerCurve) {
  let bestIdx = 0, bestMetric = -1;
  const hasPwr = Array.isArray(powerCurve) && powerCurve.length >= 2;
  const pSorted = hasPwr ? [...powerCurve].sort((a, b) => a.Q - b.Q) : null;
  const interpP = q => {
    if (!pSorted) return null;
    if (q <= pSorted[0].Q) return pSorted[0].P;
    if (q >= pSorted[pSorted.length - 1].Q) return pSorted[pSorted.length - 1].P;
    for (let i = 0; i < pSorted.length - 1; i++) {
      if (pSorted[i].Q <= q && q <= pSorted[i + 1].Q) {
        const t = (q - pSorted[i].Q) / (pSorted[i + 1].Q - pSorted[i].Q);
        return pSorted[i].P + t * (pSorted[i + 1].P - pSorted[i].P);
      }
    }
    return null;
  };
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i].Q, h = pts[i].H;
    if (q <= 0 || h <= 0) continue;
    const p = interpP(q);
    const metric = (p && p > 0) ? (q * h / p) : (q * h);
    if (metric > bestMetric) { bestMetric = metric; bestIdx = i; }
  }
  if (bestMetric > 0) return { Q_bep: pts[bestIdx].Q, H_bep: pts[bestIdx].H };
  const qMax = pts[pts.length - 1].Q || 100;
  return { Q_bep: Math.max(qMax * 0.75, 1), H_bep: Math.max(pts[0].H * 0.8, 1) };
}

// [v27] Factores de corrección por viscosidad para bombas centrífugas (rotodinámicas) según norma ANSI/HI 9.6.7:
//   B = 16.5 · (ν_cSt)^0.50 · (H_BEP_m)^0.0625 / [ (Q_BEP_m3h)^0.375 · N_rpm^0.25 ]
// Si ν ≤ 1.5 cSt, B ≤ 1.0 o `arc.viscCorr === false`, devuelve factores unitarios (C_Q = C_H = C_eta = 1).
function pumpViscosityFactors(arc, fluid) {
  const unit = { B: 0, C_Q: 1, C_H: 1, C_eta: 1, overLimit: false };
  if (!arc || arc.viscCorr === false || !fluid || !(fluid.nu > 0)) return unit;
  const nu_cSt = fluid.nu * 1e6;
  if (nu_cSt <= 1.5) return unit;   // agua y líquidos ligeros: sin derateo viscoso

  const curve = arc.pumpCurve;
  if (!curve || curve.length < 2) return unit;
  const pts = [...curve].sort((a, b) => a.Q - b.Q);
  const { Q_bep, H_bep } = _estimateWaterBEP(pts, arc.powerCurve);
  const N_rpm = (Number.isFinite(+arc.speed_rpm) && +arc.speed_rpm > 0) ? +arc.speed_rpm : 1450;

  const B = 16.5 * Math.pow(nu_cSt, 0.5) * Math.pow(Math.max(H_bep, 0.5), 0.0625) /
            (Math.pow(Math.max(Q_bep, 0.5), 0.375) * Math.pow(N_rpm, 0.25));
  if (B <= 1.0) return { B, C_Q: 1, C_H: 1, C_eta: 1, overLimit: false, Q_bep };

  const Beff = Math.min(B, 40);
  const logB = Math.log10(Beff);
  const C_Q = Math.exp(-0.165 * Math.pow(logB, 3.15));
  const C_eta = Math.pow(Beff, -0.0547 * Math.pow(Beff, 0.69));
  const C_H = Math.max(0.15, 1 - (1 - C_Q));   // C_H en el BEP (Q = Q_bep)
  return { B, C_Q, C_H, C_eta, overLimit: B >= 40, Q_bep };
}

// Devuelve los puntos H-Q efectivos de UNA bomba (aplicando ANSI/HI 9.6.7 si `fluid` es viscoso y `arc.viscCorr !== false`).
function effectivePumpCurve(arc, fluid) {
  const curve = arc && arc.pumpCurve;
  if (!curve || curve.length < 2) return null;
  const pts = [...curve].sort((a, b) => a.Q - b.Q);
  const vf = pumpViscosityFactors(arc, fluid);
  if (vf.C_Q === 1 && vf.C_H === 1) return pts;
  const qBep = Math.max(vf.Q_bep || 1, 1e-6);
  return pts.map(p => {
    if (p.Q <= 0) return { Q: 0, H: p.H };   // a caudal nulo (shutoff), C_H0 = 1.0 según ANSI/HI 9.6.7
    const qRatio = Math.min(p.Q / qBep, 1.25); // ANSI/HI 9.6.7 tabula C_H hasta 1.2·Q_BEP
    const ch = Math.max(0.15, Math.min(1.0, 1 - (1 - vf.C_Q) * Math.pow(qRatio, 0.75)));
    return { Q: p.Q * vf.C_Q, H: p.H * ch };
  });
}

// Carga H [m] entregada por UNA bomba a caudal Q_m3h [m³/h]. Si se pasa `fluid`, aplica corrección viscosa ANSI/HI 9.6.7.
function pumpHead(Q_m3h, arc, fluid) {
  const pts = effectivePumpCurve(arc, fluid);
  if (!pts || pts.length < 2) return 50;
  const Q = Math.abs(Q_m3h);
  if (Q <= pts[0].Q) return pts[0].H;
  if (Q >= pts[pts.length - 1].Q) {
    const n = pts.length - 1;
    const dq = pts[n].Q - pts[n - 1].Q;
    const slope = dq > 1e-12 ? (pts[n].H - pts[n - 1].H) / dq : -0.1;
    const extrapolated = pts[n].H + slope * (Q - pts[n].Q);
    return Math.max(extrapolated, -0.3 * pts[0].H);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].Q <= Q && Q <= pts[i + 1].Q) {
      const dq = pts[i + 1].Q - pts[i].Q;
      const t = dq > 1e-12 ? (Q - pts[i].Q) / dq : 0;
      return pts[i].H + t * (pts[i + 1].H - pts[i].H);
    }
  }
  return 0;
}

function pumpHeadDeriv(Q_m3h, arc, fluid) {
  const dQ = 0.5, Qc = Math.max(Math.abs(Q_m3h), dQ);
  return (pumpHead(Qc + dQ, arc, fluid) - pumpHead(Qc - dQ, arc, fluid)) / (2 * dQ);
}

function pumpMaxQ(arc, fluid) {
  const pts = effectivePumpCurve(arc, fluid);
  if (!pts || !pts.length) return 0;
  return pts[pts.length - 1].Q * (arc.nPumps || 1);
}

// [v27] Potencia de eje [kW] en Q [m³/h] para UNA bomba:
//   1. Interpola la curva P-Q de catálogo (ensayada en agua a 20 °C, ρ_ref = 998.2 kg/m³) en el caudal equivalente de agua Q_agua = Q / C_Q.
//   2. Escala por relación de densidades (ρ / ρ_ref) — evita el error termodinámico P_hid > P_eje (η > 100 %) al subir ρ.
//   3. Si hay derateo viscoso ANSI/HI 9.6.7, aplica el factor (C_Q · C_H_op / C_eta).
// Si no se pasa `fluid`, devuelve el valor puro de la curva en agua (compatibilidad con llamadas unitarias sin fluido).
function pumpPower(Q_m3h, arc, fluid) {
  const curve = arc.powerCurve;
  if (!curve || curve.length < 2) return null;
  const pts = [...curve].sort((a, b) => a.Q - b.Q);
  const vf = pumpViscosityFactors(arc, fluid);
  const Q = Math.abs(Q_m3h);
  const Q_water = vf.C_Q > 0 ? Q / vf.C_Q : Q;

  let pWater;
  if (Q_water <= pts[0].Q) {
    pWater = pts[0].P;
  } else if (Q_water >= pts[pts.length - 1].Q) {
    const n = pts.length - 1;
    const slope = (pts[n].P - pts[n - 1].P) / (pts[n].Q - pts[n - 1].Q);
    pWater = Math.max(0, pts[n].P + slope * (Q_water - pts[n].Q));
  } else {
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].Q <= Q_water && Q_water <= pts[i + 1].Q) {
        const t = (Q_water - pts[i].Q) / (pts[i + 1].Q - pts[i].Q);
        pWater = pts[i].P + t * (pts[i + 1].P - pts[i].P);
        break;
      }
    }
  }
  if (pWater == null) return null;
  if (!fluid || !(fluid.rho > 0)) return pWater;

  const rhoRef = (typeof RHO_REF_AGUA !== 'undefined') ? RHO_REF_AGUA : 998.2;
  const densityRatio = fluid.rho / rhoRef;
  if (vf.C_eta === 1) return pWater * densityRatio;

  const qBep = Math.max(vf.Q_bep || 1, 1e-6);
  const qRatio = Math.min(Q_water / qBep, 1.25);
  const chOp = Q_water > 0 ? Math.max(0.15, Math.min(1.0, 1 - (1 - vf.C_Q) * Math.pow(qRatio, 0.75))) : 1.0;
  // En la zona de operación (Q_water ≥ 0.6·Q_BEP), ANSI/HI 9.6.7 da P_vis = P_agua(Q_water)·(ρ/ρ_ref)·(C_Q·C_H / C_eta).
  // Hacia caudal nulo (shutoff, Q→0), toda la potencia es rozamiento de disco y recirculación (sin potencia útil Q·H),
  // por lo que escala con 1/C_eta sin contraerse por C_Q. Se interpola suavemente entre ambos regímenes.
  const wFlow = Math.min(1, Q_water / (0.6 * qBep));
  const numScale = (1 - wFlow) * 1.0 + wFlow * (vf.C_Q * chOp);
  return pWater * densityRatio * (numScale / vf.C_eta);
}
