// js/nucleo/hidraulica.js
'use strict';
/* Fricción (laminar Hagen-Poiseuille, transición continua, turbulento Colebrook-White), desglose hf_major / hm_minor y modelo físico de Equipo. */

const RE_LAMINAR    = 2300;
const RE_TURBULENTO = 4000;
const COND_RETENCION_CERRADA = 1e-6;
const EPS_DEFECTO_MM = 0.046;

function arcEpsMm(arc) {
  const e = (arc.eps_mm != null && Number.isFinite(+arc.eps_mm)) ? +arc.eps_mm : EPS_DEFECTO_MM;
  const s = Number.isFinite(+arc.fouling_mm) ? +arc.fouling_mm : 0;
  return Math.max(0, e) + Math.max(0, s);
}

// Colebrook-White (turbulento): 1/√f = −2·log10(ε/(3,7·D) + 2,51/(Re·√f)), por punto fijo desde semilla Swamee-Jain.
function colebrook(Re, eD) {
  let f = 0.25 / Math.pow(Math.log10(eD / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  for (let i = 0; i < 60; i++) {
    const fn = 1 / Math.pow(-2 * Math.log10(eD / 3.7 + 2.51 / (Re * Math.sqrt(f))), 2);
    if (Math.abs(fn - f) < 1e-12) { f = fn; break; }
    f = fn;
  }
  return f;
}

function frictionFactor(Re, eD) {
  if (!(Re >= 1)) return 0.02;
  if (Re < RE_LAMINAR) return 64 / Re;
  if (Re >= RE_TURBULENTO) return colebrook(Re, eD);
  const fL = 64 / RE_LAMINAR, fT = colebrook(RE_TURBULENTO, eD);
  return fL + (fT - fL) * (Re - RE_LAMINAR) / (RE_TURBULENTO - RE_LAMINAR);
}

// Calcula caudal Q [m³/h], V [m/s], Re, f, pérdida total hf [m], pérdida primaria hf_major [m], pérdida menor hm_minor [m] y conductancia.
function pipeCalc(dH, arc, fluid) {
  if (!fluid || !(Number.isFinite(fluid.nu) && fluid.nu > 0)) throw new Error('pipeCalc: falta el fluido o su viscosidad cinemática no es positiva');
  const { D_mm, L_m } = arc;
  const K = arcTotalK(arc);
  if (!Number.isFinite(K))
    return { Q: 0, V: 0, Re: 0, f: 0.02, hf: 0, hf_major: 0, hm_minor: 0, velHead: 0, regime: 'Cerrada', cond: 0 };

  const isValveArc = arc.type === 'valve';
  const Lterm = isValveArc ? 0 : L_m;
  const Keff = (isValveArc && K <= 0) ? 0.01 : K;
  const D = D_mm / 1000, A = Math.PI * D * D / 4, eD = (arcEpsMm(arc) / 1000) / D;
  const resistanceless = (Lterm <= 0) && (Keff <= 0);
  if (D <= 0 || Lterm < 0 || resistanceless || !Number.isFinite(dH))
    return { Q: 0, V: 0, Re: 0, f: 0.02, hf: 0, hf_major: 0, hm_minor: 0, velHead: 0, regime: '—', cond: 0 };

  const nu = fluid.nu;
  if (Math.abs(dH) < 1e-12) {
    const b0 = 32 * nu * Lterm / (G * D * D);
    return { Q: 0, V: 0, Re: 0, f: 0.02, hf: 0, hf_major: 0, hm_minor: 0, velHead: 0, regime: '—', cond: (b0 > 0 ? A / b0 : 1e-6) * 3600 };
  }
  const sign = dH > 0 ? 1 : -1;
  const adH = Math.abs(dH);
  const kL = Lterm / D;
  const hfDeV = (V, f) => (f * kL + Keff) * V * V / (2 * G);

  // (1) Laminar: f = 64/Re => hf = b·V + a·V²
  const a = Keff / (2 * G), b = 32 * nu * Lterm / (G * D * D);
  let V = 2 * adH / (b + Math.sqrt(b * b + 4 * a * adH));
  let Re = V * D / nu, f;
  let dhdV;
  if (Re <= RE_LAMINAR || kL === 0) {
    f = frictionFactor(Re, eD);
    if (Re <= RE_LAMINAR) dhdV = b + 2 * a * V;
  } else {
    const V4 = RE_TURBULENTO * nu / D;
    const fT = colebrook(RE_TURBULENTO, eD);
    if (adH <= hfDeV(V4, fT)) {
      // (2) Transición: bisección
      let lo = RE_LAMINAR * nu / D, hi = V4;
      for (let i = 0; i < 200; i++) {
        const m = (lo + hi) / 2;
        if (hfDeV(m, frictionFactor(m * D / nu, eD)) < adH) lo = m; else hi = m;
        if (hi - lo <= 1e-15 * hi) break;
      }
      V = (lo + hi) / 2; Re = V * D / nu; f = frictionFactor(Re, eD);
      const dfdRe = (fT - 64 / RE_LAMINAR) / (RE_TURBULENTO - RE_LAMINAR);
      dhdV = (f * kL + Keff) * V / G + (V * V / (2 * G)) * kL * dfdRe * (D / nu);
    } else {
      // (3) Turbulento: punto fijo en f hasta tolerancia 1e-12
      f = 0.02;
      for (let i = 0; i < 100; i++) {
        const r = (f * kL + Keff) / (2 * G * A * A);
        const Q = Math.sqrt(adH / r);
        V = Q / A; Re = V * D / nu;
        const fn = frictionFactor(Re, eD);
        const hecho = Math.abs(fn - f) < 1e-12;
        f = fn;
        if (hecho) break;
      }
    }
  }
  const Qabs = V * A;
  const velHead = V * V / (2 * G);
  const hmAbs = Keff * velHead;
  const hfAbs = Math.max(0, adH - hmAbs);
  const regime = Re < RE_LAMINAR ? 'Laminar' : Re < RE_TURBULENTO ? 'Transición' : 'Turbulento';
  const cond = (dhdV !== undefined) ? A / dhdV : (Qabs > 1e-10 ? Qabs / (2 * adH) : 1e-6);
  return {
    Q: sign * Qabs * 3600,
    V,
    Re,
    f,
    hf: dH,
    hf_major: sign * hfAbs,
    hm_minor: sign * hmAbs,
    velHead,
    regime,
    cond: cond * 3600
  };
}

function esRetencion(arc) {
  return arc.type === 'check' || (arc.type === 'valve' && arc.valveType === 'check');
}

function caudalTramo(arc, dH, fluid) {
  if (esRetencion(arc) && dH < 0) return { Q_ms: 0, Q_m3h: 0, cond: COND_RETENCION_CERRADA };
  const r = pipeCalc(dH, arc, fluid);
  return { Q_ms: r.Q / 3600, Q_m3h: r.Q, cond: r.cond / 3600 };
}

// [v27] Modelo físico de Equipo de proceso (intercambiador de calor, filtro, enfriador):
// Por defecto (`equipMode !== 'threshold'`), `dp_bar` representa la caída de presión nominal del equipo ensayada con agua
// (ρ_ref = 998.2 kg/m³) al caudal nominal `q_nom_m3h` (o, si no se define, a V_ref = 2 m/s en las boquillas `D_mm`).
// La ley hidráulica es cuadrática y bidireccional sin umbral artificial: ΔH = sign(Q) · H_nom · (Q / Q_nom)²,
// donde H_nom = dp_bar · 10⁵ / (ρ_ref · G) es una propiedad geométrica (Kv) independiente de la densidad del fluido bombeado:
// así, al subir ρ, ΔP = ρ·g·ΔH crece proporcionalmente con ρ y el caudal de una bomba centrífuga NO sube falsamente.
// Si `dp_bar === 0`, la resistencia es casi nula; si `equipMode === 'threshold'`, mantiene el modelo antiguo con umbral de presión fija.
function caudalEquipo(arc, dH, fluid, dpBarOverride) {
  const dpBar = dpBarOverride !== undefined ? dpBarOverride : (arc.dp_bar ?? 0);
  const _D = (arc.D_mm || 200) / 1000, _A = Math.PI * _D * _D / 4;
  const Q_nom_ms = (arc.q_nom_m3h && arc.q_nom_m3h > 0) ? (arc.q_nom_m3h / 3600) : (_A * 2.0);
  if (arc.equipMode === 'threshold') {
    const dpH = Math.max(dpBar * 1e5 / (fluid.rho * G), 1e-6);
    const effDH = dH - dpH;
    const Q_ms = effDH > 0 ? Q_nom_ms * Math.sqrt(effDH / dpH) : 0;
    const effCond = Math.max(effDH, 0.02 * dpH);
    const cond = (Q_nom_ms * Math.sqrt(effCond / dpH)) / (2 * effCond);
    return { Q_ms, Q_m3h: Q_ms * 3600, cond };
  }
  const rhoRef = (typeof RHO_REF_AGUA !== 'undefined') ? RHO_REF_AGUA : 998.2;
  const H_nom = Math.max(dpBar * 1e5 / (rhoRef * G), 1e-6);
  const adH = Math.abs(dH);
  if (adH < 1e-12) {
    // Pendiente linealizada regularizada en el origen para evitar singularidad en dH = 0
    const dH_reg = 1e-6;
    const cond0 = (Q_nom_ms / Math.sqrt(H_nom)) / (2 * Math.sqrt(dH_reg));
    return { Q_ms: 0, Q_m3h: 0, cond: cond0 };
  }
  const sign = dH > 0 ? 1 : -1;
  const Qabs = Q_nom_ms * Math.sqrt(adH / H_nom);
  const dH_for_cond = Math.max(adH, 1e-8);
  const cond = (Q_nom_ms / Math.sqrt(H_nom)) / (2 * Math.sqrt(dH_for_cond));
  return { Q_ms: sign * Qabs, Q_m3h: sign * Qabs * 3600, cond };
}
