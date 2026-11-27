// js/nucleo/resultados.js
'use strict';
/* Aplicar o limpiar los resultados del solver sobre nodos y arcos, y validar el rol declarado de los tanques. */

function aplicarResultados(nodes, arcs, result) {
  for (const n of nodes) {
    const r = result.nodeRes[n.id] || result.nodeRes[String(n.id)];
    if (r) {
      n.H = r.H;
      n.P = r.P;
      n.P_est = r.P_est ?? r.P;
      n.velHead = r.velHead ?? 0;
      n.cavitation = !!r.cavitation;
    }
  }
  for (const a of arcs) {
    const r = result.arcRes[a.id] || result.arcRes[String(a.id)];
    if (r) {
      a.Q = r.Q; a.V = r.V; a.Re = r.Re; a.f = r.f; a.hf = r.hf;
      a.hf_major = r.hf_major ?? null;
      a.hm_minor = r.hm_minor ?? null;
      a.regime = r.regime;
      if (a.type === 'pump' && a.Q != null) {
        a.P_hid = r.P_hid ?? null;
        a.P_eje = r.P_eje ?? null;
        a.NPSHa = r.NPSHa ?? null;
        a.viscB = r.viscB ?? 0;
        a.C_Q = r.C_Q ?? 1;
        a.C_H = r.C_H ?? 1;
        a.C_eta = r.C_eta ?? 1;
      }
    }
  }
}

function limpiarResultados(nodes, arcs) {
  for (const n of nodes) {
    n.H = null; n.P = null; n.P_est = null; n.velHead = null; n.cavitation = false;
  }
  for (const a of arcs) {
    a.Q = null; a.V = null; a.Re = null; a.f = null; a.hf = null;
    a.hf_major = null; a.hm_minor = null; a.regime = null;
    a.P_hid = null; a.P_eje = null; a.NPSHa = null; a.viscB = null;
  }
}

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
