// js/nucleo/ariete.js
'use strict';
/* Golpe de ariete (Joukowsky, cierre instantáneo). */

// SDR → espesor = D / SDR (dimensionless ratio diámetro ext / espesor)
// Si no hay SDR, se asume Sch40 aproximado: e ≈ 0.06 × D (5mm mín)
function pipeWallThickness(arc) {
  if (arc.wall_mm && arc.wall_mm > 0) return arc.wall_mm / 1000;
  const D = (arc.D_mm || 200) / 1000;
  return Math.max(D * 0.06, 0.005); // 6% del diámetro, mín 5mm
}

// [repo] Cálculo Joukowsky de un tramo (antes mezclado con el dibujo de la tabla en calcAriete). Sin DOM ni estado global.
// P_op_bar: presión de operación en el nodo origen [bar] (0 si no hay resultado).
function calcArieteTramo(arc, fluid, P_op_bar) {
  const D = (arc.D_mm || 200) / 1000;  // m
  const e = pipeWallThickness(arc);     // m
  const L = arc.L_m || 10;             // m
  const V0 = arc.V != null ? Math.abs(arc.V) : 0;  // m/s

  // Módulo de Young del material del tramo. [v26] Antes se buscaba en una tabla con claves que no coincidían con los nombres de los
  // materiales y TODOS usaban el del acero (200 GPa): para PVC o HDPE la celeridad y la sobrepresión salían sobreestimadas.
  // Si el material no se puede determinar (proyecto de v25 con ε = 0,0015: PVC, HDPE o cobre) se usa el del acero, del lado conservador.
  const material = materialDeArco(arc);
  const E = material ? material.E : E_ACERO;

  // Celeridad de onda  a = sqrt(K/ρ) / sqrt(1 + K*D/(E*e))
  const K = K_WATER;
  const rho = fluid.rho;
  const denom = Math.sqrt(1 + (K * D) / (E * e));
  const a = Math.sqrt(K / rho) / denom;   // m/s

  // Tiempo crítico  Tc = 2L/a
  const Tc = 2 * L / a;    // s

  // Sobrepresión Joukowsky  ΔP = ρ·a·ΔV  (cierre instantáneo ΔV = V0)
  const dP = rho * a * V0; // Pa
  const dH = dP / (rho * 9.81); // m de columna de agua

  const P_max_bar = P_op_bar + dP / 1e5;

  // Clasificación de riesgo
  let risk = '🟢 Bajo';
  if (dP > 10e5) risk = '🔴 Alto';
  else if (dP > 5e5) risk = '🟡 Medio';

  return { arc, a, Tc, dP, dH, P_op_bar, P_max_bar, risk, V0, material: material ? material.label : null, E };
}
