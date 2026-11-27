// js/nucleo/modelo.js
'use strict';
/* Validación y normalización de nodos y arcos importados desde JSON. */

const TIPOS_NODO = ['junction', 'tank'];
const TIPOS_ARCO = ['pipe', 'pump', 'valve', 'equip', 'check'];
const CAMPOS_NUMERICOS_ARCO = [
  ['nPumps', 1], ['fixedQ_m3h', 100], ['fixedP_bar', 3], ['dp_bar', 2], ['q_nom_m3h', 0],
  ['pmin_bar', 0], ['wall_mm', 5], ['fouling_mm', 0], ['setpoint', 0], ['speed_rpm', 1450]
];

function _num(v, def) {
  if (v == null) return v;
  const n = (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? +v : NaN;
  return Number.isFinite(n) ? n : def;
}
const _punto = (p, k) => (p !== null && typeof p === 'object') ? { Q: _num(p.Q, 0) ?? 0, [k]: _num(p[k], 0) ?? 0 } : { Q: 0, [k]: 0 };

function sanitizeNode(n) {
  if (n === null || typeof n !== 'object' || Array.isArray(n)) throw new Error('El archivo tiene un nodo con formato inválido');
  const N = { ...n };
  if (!Number.isInteger(N.id)) throw new Error('El archivo tiene un nodo sin id numérico entero');
  if (!TIPOS_NODO.includes(N.type)) throw new Error('El archivo tiene un nodo de tipo no válido: ' + String(N.type).slice(0, 30));
  N.cota    = Number.isFinite(+N.cota)    ? +N.cota    : 0;
  N.level_m = Number.isFinite(+N.level_m) && +N.level_m >= 0 ? +N.level_m : 0;
  N.demand  = Number.isFinite(+N.demand)  ? +N.demand  : 0;
  N.p_bar   = Number.isFinite(+N.p_bar)   ? +N.p_bar   : 0;
  N.label   = String(N.label ?? '');
  N.x = _num(N.x, 0) ?? 0; N.y = _num(N.y, 0) ?? 0;
  return N;
}

function sanitizeArc(a) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new Error('El archivo tiene un arco con formato inválido');
  const A = { ...a };
  if (!Number.isInteger(A.id) || !Number.isInteger(A.fromId) || !Number.isInteger(A.toId)) throw new Error('El archivo tiene un arco sin id, origen o destino numérico entero');
  if (!TIPOS_ARCO.includes(A.type)) throw new Error('El archivo tiene un arco de tipo no válido: ' + String(A.type).slice(0, 30));
  if (A.regime != null) A.regime = String(A.regime);
  A.label   = String(A.label ?? '');
  A.D_mm    = Number.isFinite(+A.D_mm) && +A.D_mm > 0 ? +A.D_mm : 200;
  A.L_m     = Number.isFinite(+A.L_m) && +A.L_m >= 0  ? +A.L_m  : 100;
  A.eps_mm  = Number.isFinite(+A.eps_mm) && +A.eps_mm >= 0 ? +A.eps_mm : EPS_DEFECTO_MM;
  if (!MATERIALS.some(m => m.label === A.material)) delete A.material;
  if (!['crane', 'fixed'].includes(A.kMethod)) A.kMethod = 'crane';
  if (!['quadratic', 'threshold'].includes(A.equipMode)) A.equipMode = 'quadratic';
  A.viscCorr = A.viscCorr !== false;
  A.customK = Number.isFinite(+A.customK) ? +A.customK : 0;

  // [v27] Compatibilidad con proyectos de v25/v26 (14 accesorios) y longitud actual de FITTINGS (16 accesorios):
  // si fitQty es un arreglo más corto pero válido (ej. 14), rellena con ceros al final; si no es arreglo o es muy corto (<14), reinicia.
  if (!Array.isArray(A.fitQty) || (A.fitQty.length !== FITTINGS.length && A.fitQty.length !== 14)) {
    A.fitQty = new Array(FITTINGS.length).fill(0);
  } else if (A.fitQty.length < FITTINGS.length) {
    A.fitQty = A.fitQty.concat(new Array(FITTINGS.length - A.fitQty.length).fill(0));
  }
  const prevOpen = Array.isArray(A.fitOpen) ? A.fitOpen : [];
  A.fitOpen = FITTINGS.map((_, i) => Number.isFinite(+prevOpen[i]) ? +prevOpen[i] : 100);

  if (A.type === 'pump' && (!Array.isArray(A.pumpCurve) || A.pumpCurve.length < 2))
    A.pumpCurve = [{ Q: 0, H: 50 }, { Q: 200, H: 0 }];
  if (!Array.isArray(A.powerCurve)) A.powerCurve = [];
  if (A.type === 'pump' && !['curve', 'fixedQ', 'fixedP'].includes(A.pumpMode)) A.pumpMode = 'curve';
  if (A.type === 'pump' && !Number.isFinite(+A.fixedQ_m3h)) A.fixedQ_m3h = 100;
  if (A.type === 'pump' && !Number.isFinite(+A.fixedP_bar)) A.fixedP_bar = 3;
  if (A.type === 'valve')
    A.open_pct = Number.isFinite(+A.open_pct) ? Math.min(100, Math.max(0, +A.open_pct)) : 100;

  for (const [k, def] of CAMPOS_NUMERICOS_ARCO) if (A[k] != null) A[k] = _num(A[k], def);
  if (A.fouling_mm != null && A.fouling_mm < 0) A.fouling_mm = 0;
  A.fitQty  = A.fitQty.map(q => _num(q, 0) ?? 0);
  A.fitOpen = A.fitOpen.map(q => _num(q, 100) ?? 100);
  if (Array.isArray(A.pumpCurve)) A.pumpCurve = A.pumpCurve.map(p => _punto(p, 'H'));
  A.powerCurve = A.powerCurve.map(p => _punto(p, 'P'));
  return A;
}

const _noFinito = v => v != null && !Number.isFinite(+v);
const _puntoMalo = (p, k) => p == null || !Number.isFinite(+p.Q) || !Number.isFinite(+p[k]);

function primerDatoNoFinito(nodes, arcs) {
  for (const n of nodes)
    for (const k of ['cota', 'level_m', 'demand', 'p_bar']) if (_noFinito(n[k])) return k + ' del nodo «' + n.label + '»';
  for (const a of arcs) {
    for (const k of ['D_mm', 'L_m', 'eps_mm', 'fouling_mm', 'customK', 'nPumps', 'fixedQ_m3h', 'fixedP_bar', 'dp_bar', 'q_nom_m3h', 'open_pct', 'speed_rpm'])
      if (_noFinito(a[k])) return k + ' del arco «' + a.label + '»';
    for (const k of ['fitQty', 'fitOpen'])
      if (Array.isArray(a[k]) && a[k].some(_noFinito)) return k + ' del arco «' + a.label + '»';
    if (a.type === 'pump') {
      if (Array.isArray(a.pumpCurve)  && a.pumpCurve.some(p => _puntoMalo(p, 'H')))  return 'curva H-Q de la bomba «' + a.label + '»';
      if (Array.isArray(a.powerCurve) && a.powerCurve.some(p => _puntoMalo(p, 'P'))) return 'curva P-Q de la bomba «' + a.label + '»';
    }
  }
  return null;
}

function validarModelo(nodes, arcs) {
  const vistos = new Set();
  for (const e of nodes.concat(arcs)) {
    if (vistos.has(e.id)) throw new Error('El archivo repite el id ' + e.id + ' (cada nodo y cada arco necesita un id propio)');
    vistos.add(e.id);
  }
  const idsNodo = new Set(nodes.map(n => n.id));
  for (const a of arcs)
    if (!idsNodo.has(a.fromId) || !idsNodo.has(a.toId)) throw new Error('El archivo tiene el arco «' + a.label + '» unido a un nodo que no existe');
}
