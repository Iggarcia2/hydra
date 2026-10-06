// js/nucleo/resultados.js
'use strict';
/* Aplicar o limpiar los resultados del solver sobre nodos y arcos, y validar el rol declarado de los tanques. */

// [repo] Extraído de _runSolverHeavy(): copia el resultado del solver a los nodos y arcos. Sin DOM ni estado global.
function aplicarResultados(nodes, arcs, result) {
  for (const n of nodes) {
    const r = result.nodeRes[n.id] || result.nodeRes[String(n.id)];
    if (r) { n.H = r.H; n.P = r.P; }
  }
  for (const a of arcs) {
    const r = result.arcRes[a.id] || result.arcRes[String(a.id)];
    if (r) {
      a.Q=r.Q; a.V=r.V; a.Re=r.Re; a.f=r.f; a.hf=r.hf; a.regime=r.regime;
      if (a.type==='pump' && a.Q!=null) {
        a.P_hid = r.P_hid ?? null;
        a.P_eje = r.P_eje ?? null;
      }
    }
  }
}

// [FIX] limpiar resultados obsoletos para no mostrar valores previos como válidos
function limpiarResultados(nodes, arcs) {
  for (const n of nodes) { n.H = null; n.P = null; }
  for (const a of arcs) { a.Q=null; a.V=null; a.Re=null; a.f=null; a.hf=null; a.regime=null; a.P_hid=null; a.P_eje=null; }
}

// Validar roles de tanques: devuelve la lista de advertencias (vacía si todo coincide)
function advertenciasRolTanque(nodes, arcs) {
  const roleWarnings = [];
  for (const n of nodes) {
    if (n.type !== 'tank' || !n.role) continue;
    let netIn = 0;
    for (const a of arcs) {
      if (a.Q == null) continue;
      if (a.toId   === n.id) netIn += a.Q;
      if (a.fromId === n.id) netIn -= a.Q;
    }
    if (n.role === 'sink'   && netIn < -0.01)
      roleWarnings.push(`${n.label} declarado RECIBE pero entrega ${(-netIn).toFixed(1)} m³/h`);
    if (n.role === 'source' && netIn >  0.01)
      roleWarnings.push(`${n.label} declarado ENTREGA pero recibe ${netIn.toFixed(1)} m³/h`);
  }
  return roleWarnings;
}
