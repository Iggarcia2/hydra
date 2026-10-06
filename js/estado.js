// js/estado.js
'use strict';
/* Estado de la aplicación (única fuente de verdad): red, fluido, datos del proyecto, pila de deshacer, fábricas de nodos y arcos. */

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════
let _nextId = 1;
const newId = () => _nextId++;
const state = {
  nodes: [],   // array of node objects
  arcs:  [],   // array of arc objects
  selectedId: null,
  mode: 'select',          // select | node | arc | pan
  nodeType: 'junction',    // junction | reservoir | tank
  arcType:  'pipe',        // pipe | pump | valve | equip | check
  arcFrom:  null,          // node id when drawing arc
  pan: {x:0, y:0},
  zoom: 1,
  results: null,           // solver output
};
let fluid = { rho: 998.2, nu: 1.004e-6, q_required: 0, customName: '' };

// ── Undo / Redo ────────────────────────────────────────────────────────────────────────
const UNDO_LIMIT = 50;
const _undoStack = [];
const _redoStack = [];

function _snap() {
  return JSON.stringify({
    nodes: state.nodes.map(n => ({...n})),
    arcs:  state.arcs.map(a => ({
      ...a,
      fitQty:     [...(a.fitQty     || [])],
      fitOpen:    [...(a.fitOpen    || [])],
      pumpCurve:  [...(a.pumpCurve  || [])],
      powerCurve: [...(a.powerCurve || [])]
    }))
  });
}

// ── Project metadata ───────────────────────────────────────────────────────────
let projectMeta = { name: 'Red Hidráulica', rev: 'Rev. 0', client: '', engineer: '', notes: '' };
// [v14] true cuando el modal se abrió desde el botón PDF (en vez del botón "Proyecto" normal)
let _pdfPendingAfterMeta = false;

// Node factory
function mkNode(type, x, y, extra={}) {
  // 'reservoir' kept only for backward-compat JSON import (auto-converted to tank)
  const effectiveType = type==='reservoir' ? 'tank' : type;
  const n = {
    id: newId(), type: effectiveType,
    label: effectiveType==='tank'
          ? 'T'+(state.nodes.filter(n=>n.type==='tank').length+1)
          : 'J'+(state.nodes.filter(n=>n.type==='junction').length+1),
    x, y,
    cota:  extra.cota  ?? 0,
    p_bar: extra.p_bar ?? (type==='reservoir' ? +((( extra.head??0)*fluid.rho*9.81/1e5).toFixed(3)) : 0),
    demand: 0, H: null, P: null,
  };
  for (const [k,v] of Object.entries(extra)) {
    if (!['cota','p_bar','head','type'].includes(k)) n[k] = v;
  }
  return n;
}

// Arc factory
function mkArc(type, fromId, toId, extra={}) {
  const from = state.nodes.find(n=>n.id===fromId);
  const to   = state.nodes.find(n=>n.id===toId);
  const a = {
    id: newId(), type,
    label: type==='pump'?'B'+(state.arcs.filter(a=>a.type==='pump').length+1)
          :type==='valve'?'V'+(state.arcs.filter(a=>a.type==='valve').length+1)
          :type==='equip'?'HX'+(state.arcs.filter(a=>a.type==='equip').length+1)
          :'P'+(state.arcs.filter(a=>a.type==='pipe').length+1),
    fromId, toId,
    // Pipe props
    D_mm: 200, L_m: 100, eps_mm: 0.046, wall_mm: 5.0,
    fitQty: new Array(FITTINGS.length).fill(0),
    fitOpen: new Array(FITTINGS.length).fill(100), // [v13] % apertura por accesorio (solo aplica a válvulas con curva)
    customK: 0,
    // Pump props
    pumpMode: 'curve', // 'curve' (curva H-Q) | 'fixedQ' (caudal fijo) | 'fixedP' (presión fija) [v17/v18]
    fixedQ_m3h: 100,   // [v17] caudal requerido, solo se usa en modo 'fixedQ'
    fixedP_bar: 3,     // [v18] presión de descarga (manómetro a la salida de la bomba), solo en modo 'fixedP'
    pumpCurve: [{Q:0,H:50},{Q:100,H:45},{Q:200,H:35},{Q:300,H:20},{Q:350,H:0}],
    nPumps: 1,
    powerCurve: [],   // P-Q: [{Q[m³/h], P[kW]}] para UNA bomba
    // Valve props
    valveType: 'check', // check | prv | fcv | gate | butterfly | globe
    open_pct: 100, // [v21] % apertura del elemento Valvula (0-100; 0 = tramo bloqueado)
    setpoint: 0,
    // Equip props
    dp_bar: 2,     // pressure drop [bar]
    pmin_bar: 0,   // min inlet pressure [bar]
    fouling_mm: 0, // extra roughness from fouling [mm]
    // Results
    Q: null, V: null, hf: null, Re: null, f: null,
    ...extra
  };
  return a;
}

function findNode(id) { return state.nodes.find(n=>n.id===id); }
function findArc(id)  { return state.arcs.find(a=>a.id===id); }

// [repo] Vista del estado para el motor de cálculo (js/nucleo/): nodos, arcos y fluido. No copia nada: son los mismos objetos.
function redActual() { return { nodes: state.nodes, arcs: state.arcs, fluid }; }
