// js/nucleo/materiales.js
'use strict';
/* Material de un tramo de tubería: el elegido en el panel o, si el proyecto no lo trae, el que se deduce de la rugosidad. */

// El material guardado en el tramo (arc.material) vale mientras la rugosidad siga siendo la suya; si se escribió otra rugosidad a mano,
// o el proyecto es de v25 (no guardaba el material), se deduce de ε: solo si UN material tiene esa rugosidad. Con varios (PVC, HDPE y
// cobre comparten 0,0015 mm) no se puede saber cuál es y devuelve null.
function materialDeArco(arc) {
  const eps = (arc.eps_mm != null && Number.isFinite(+arc.eps_mm)) ? +arc.eps_mm : EPS_DEFECTO_MM;
  const guardado = MATERIALS.find(m => m.label === arc.material);
  if (guardado && Math.abs(guardado.eps - eps) < 1e-5) return guardado;
  const posibles = MATERIALS.filter(m => Math.abs(m.eps - eps) < 1e-5);
  return posibles.length === 1 ? posibles[0] : null;
}

// Texto del material para listas e informes: el nombre, o «ε=… mm» cuando no se puede determinar.
function etiquetaMaterial(arc) {
  const m = materialDeArco(arc);
  if (m) return m.label;
  const eps = (arc.eps_mm != null && Number.isFinite(+arc.eps_mm)) ? +arc.eps_mm : EPS_DEFECTO_MM;
  return 'ε=' + eps + ' mm';
}
