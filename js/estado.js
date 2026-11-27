// js/estado.js
'use strict';
/* Estado de la aplicación: red, fluido, datos del proyecto, pila de deshacer y fábricas de nodos y arcos. */

let _nextId = 1;
const newId = () => _nextId++;
const state = {
  nodes: [],
  arcs:  [],
  selectedId: null,
  mode: 'select',
  nodeType: 'junction',
  arcType:  'pipe',
  arcFrom:  null,
  pan: {x:0, y:0},
  zoom: 1,
  results: null,
};
let fluid = {
  rho: 998.2,
  nu: 1.004e-6,
  pv_pa: 2339,
  bulk_pa: 2.1e9,
  q_required: 0,
  customName: '',
  presetId: 'water',
  rhoMode: 'rho',     // 'rho' [kg/m³] | 'sg' [-] | 'gamma' [kN/m³]
  viscMode: 'nu_cst'  // 'nu_cst' [cSt] | 'mu_pas' [Pa·s] | 'mu_cp' [cP]
};

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

let projectMeta = { name: 'Red Hidráulica', rev: 'Rev. 0', client: '', engineer: '', notes: '' };
let _pdfPendingAfterMeta = false;

function mkNode(type, x, y, extra={}) {
  const effectiveType = type==='reservoir' ? 'tank' : type;
  const n = {
    id: newId(), type: effectiveType,
    label: effectiveType==='tank'
          ? 'T'+(state.nodes.filter(n=>n.type==='tank').length+1)
          : 'J'+(state.nodes.filter(n=>n.type==='junction').length+1),
    x, y,
    cota:    extra.cota    ?? 0,
    level_m: extra.level_m ?? 0,
    p_bar:   extra.p_bar   ?? (type==='reservoir' ? +(((extra.head??0)*fluid.rho*G/1e5).toFixed(3)) : 0),
    demand: 0, H: null, P: null, P_est: null, velHead: null, cavitation: false,
  };
  for (const [k,v] of Object.entries(extra)) {
    if (!['cota','level_m','p_bar','head','type'].includes(k)) n[k] = v;
  }
  return n;
}

function mkArc(type, fromId, toId, extra={}) {
  const a = {
    id: newId(), type,
    label: type==='pump'?'B'+(state.arcs.filter(a=>a.type==='pump').length+1)
          :type==='valve'?'V'+(state.arcs.filter(a=>a.type==='valve').length+1)
          :type==='equip'?'HX'+(state.arcs.filter(a=>a.type==='equip').length+1)
          :'P'+(state.arcs.filter(a=>a.type==='pipe').length+1),
    fromId, toId,
    // Pipe props
    schedule: 'SCH40',
    D_mm: 200, L_m: 100, eps_mm: 0.046, wall_mm: 8.18,
    kMethod: 'crane',  // [v27] 'crane' (K = LeD · fT(D)) | 'fixed' (K constante orientativo)
    fitQty: new Array(FITTINGS.length).fill(0),
    fitOpen: new Array(FITTINGS.length).fill(100),
    customK: 0,
    // Pump props
    pumpMode: 'curve',
    fixedQ_m3h: 100,
    fixedP_bar: 3,
    pumpCurve: [{Q:0,H:50},{Q:100,H:45},{Q:200,H:35},{Q:300,H:20},{Q:350,H:0}],
    nPumps: 1,
    speed_rpm: 1450,
    viscCorr: true,    // [v27] Corrección viscosa ANSI/HI 9.6.7 activa por defecto
    powerCurve: [],
    // Valve props
    valveType: 'check',
    open_pct: 100,
    setpoint: 0,
    // Equip props
    equipMode: 'quadratic', // [v27] 'quadratic' (Kv real independiente de ρ) | 'threshold' (salto fijo)
    dp_bar: 2,
    q_nom_m3h: 0,           // 0 = usa Q a V_ref = 2.0 m/s en D_mm
    pmin_bar: 0,
    fouling_mm: 0,
    // Results
    Q: null, V: null, hf: null, hf_major: null, hm_minor: null, Re: null, f: null,
    ...extra
  };
  return a;
}

function findNode(id) { return state.nodes.find(n=>n.id===id); }
function findArc(id)  { return state.arcs.find(a=>a.id===id); }

function redActual() { return { nodes: state.nodes, arcs: state.arcs, fluid }; }
