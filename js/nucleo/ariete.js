// js/nucleo/ariete.js
'use strict';
/* Golpe de ariete (Joukowsky, cierre instantáneo). */

function pipeWallThickness(arc) {
  if (arc.wall_mm && arc.wall_mm > 0) return arc.wall_mm / 1000;
  const D = (arc.D_mm || 200) / 1000;
  return Math.max(D * 0.06, 0.005);
}

// P_op_bar: presión manométrica real de operación en el nodo origen [bar] (conserva su signo si es negativa).
function calcArieteTramo(arc, fluid, P_op_bar) {
  const D = (arc.D_mm || 200) / 1000;
  const e = pipeWallThickness(arc);
  const L = arc.L_m || 10;
  const V0 = arc.V != null ? Math.abs(arc.V) : 0;

  const material = materialDeArco(arc);
  const E = material ? material.E : E_ACERO;

  // Usa el módulo de compresibilidad volumétrica del fluido seleccionado si está disponible (por defecto K_WATER = 2.1 GPa).
  const K = (fluid && Number.isFinite(+fluid.bulk_pa) && +fluid.bulk_pa > 0) ? +fluid.bulk_pa : K_WATER;
  const rho = fluid.rho;
  const denom = Math.sqrt(1 + (K * D) / (E * e));
  const a = Math.sqrt(K / rho) / denom;

  const Tc = 2 * L / a;
  const dP = rho * a * V0;
  const dH = dP / (rho * G);

  const pOp = Number.isFinite(+P_op_bar) ? +P_op_bar : 0;
  const P_max_bar = pOp + dP / 1e5;
  const P_min_bar = pOp - dP / 1e5;

  let risk = '🟢 Bajo';
  if (dP > 10e5) risk = '🔴 Alto';
  else if (dP > 5e5) risk = '🟡 Medio';

  return { arc, a, Tc, dP, dH, P_op_bar: pOp, P_max_bar, P_min_bar, risk, V0, material: material ? material.label : null, E, K };
}
