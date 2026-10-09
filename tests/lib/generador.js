// tests/lib/generador.js
'use strict';
/* Generador de redes aleatorias (con semilla fija, reproducible) para las pruebas del motor.
   Devuelve objetos planos serializables: {nodes, arcs, fluid, opc}. Cubre los cinco tipos de arco, los tres modos de bomba,
   válvulas con curva (incluida 0 % = cerrada), accesorios, equipos, fluido de agua y personalizado, y tolerancias raras. */

function prng(semilla) {            // mulberry32
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generar(semilla) {
  const rnd = prng(semilla);
  const u = (a, b) => a + (b - a) * rnd();
  const ent = (a, b) => Math.floor(u(a, b + 1));
  const elegir = lista => lista[ent(0, lista.length - 1)];
  const redondear = (x, d) => +x.toFixed(d);

  const nTanques = ent(1, 3), nJunc = ent(1, 8);
  const nodes = [];
  let id = 1;
  for (let i = 0; i < nTanques; i++) nodes.push({ id: id++, type: 'tank', label: 'T' + (i + 1), x: ent(0, 800), y: ent(0, 500), cota: redondear(u(0, 30), 1), p_bar: redondear(u(0, 2), 2), demand: 0, H: null, P: null, role: elegir([null, 'source', 'sink']) });
  for (let i = 0; i < nJunc; i++) nodes.push({ id: id++, type: 'junction', label: 'J' + (i + 1), x: ent(0, 800), y: ent(0, 500), cota: redondear(u(0, 20), 1), p_bar: 0, demand: rnd() < 0.3 ? 0 : redondear(u(0, 40), 1), H: null, P: null });

  const NFIT = 14;
  const DN = [574.65, 477.9, 428.65, 381.0, 333.35, 303.2, 254.5, 202.7, 154.1, 128.2, 102.3, 77.9, 62.7, 52.5, 40.9, 26.6];   // interiores Sch 40 (los de js/datos/tuberias.js)
  const EPS = [0, 0.015, 0.046, 0.15, 0.0015, 0.0015, 0.26];                                                                    // 0 = tubo liso
  let aid = id;
  const arcs = [];
  function nuevoArco(tipo, de, a) {
    const A = {
      id: aid++, type: tipo, label: tipo[0].toUpperCase() + (arcs.length + 1), fromId: de, toId: a,
      D_mm: rnd() < 0.85 ? elegir(DN.slice(4, 11)) : (rnd() < 0.5 ? elegir(DN) : redondear(u(40, 500), 1)), L_m: redondear(u(5, 250), 1), eps_mm: elegir(EPS), wall_mm: redondear(u(2, 15), 1),
      fitQty: new Array(NFIT).fill(0), fitOpen: new Array(NFIT).fill(100), customK: rnd() < 0.2 ? redondear(u(0, 10), 2) : 0,
      pumpMode: 'curve', fixedQ_m3h: 100, fixedP_bar: 3,
      pumpCurve: [{ Q: 0, H: 50 }, { Q: 100, H: 45 }, { Q: 200, H: 35 }, { Q: 300, H: 20 }, { Q: 350, H: 0 }], nPumps: 1, powerCurve: [],
      valveType: 'check', open_pct: 100, setpoint: 0, dp_bar: 2, pmin_bar: 0, fouling_mm: rnd() < 0.15 ? redondear(u(0, 0.5), 3) : 0,
      Q: null, V: null, hf: null, Re: null, f: null,
    };
    if (tipo === 'pipe' || tipo === 'check') {
      for (let k = 0; k < NFIT; k++) if (rnd() < 0.2) A.fitQty[k] = ent(1, 3);
      for (let k = 0; k < NFIT; k++) if (rnd() < 0.3) A.fitOpen[k] = elegir([100, 90, 75, 50, 35, 20]);
      if (rnd() < 0.04) A.fitOpen[5] = 0;            // una válvula cerrada de vez en cuando (tramo bloqueado)
    }
    if (tipo === 'pump') {
      A.pumpMode = elegir(['curve', 'curve', 'curve', 'curve', 'fixedQ', 'fixedP']);
      const H0 = redondear(u(25, 80), 1), Qm = redondear(u(200, 600), 0), n = ent(4, 6);
      A.pumpCurve = [];
      for (let k = 0; k < n; k++) { const q = Qm * k / (n - 1); A.pumpCurve.push({ Q: redondear(q, 1), H: redondear(H0 * (1 - Math.pow(k / (n - 1), 2) * 0.95), 2) }); }
      A.nPumps = elegir([1, 1, 1, 2, 3]);
      A.fixedQ_m3h = redondear(u(10, 120), 1); A.fixedP_bar = redondear(u(1, 6), 2);
      if (rnd() < 0.5) A.powerCurve = [{ Q: 0, P: 5 }, { Q: Qm / 3, P: 12 }, { Q: Qm * 2 / 3, P: 18 }, { Q: Qm, P: 22 }];
    }
    if (tipo === 'valve') { A.valveType = elegir(['check', 'gate', 'ball', 'butterfly', 'globe', 'prv']); A.open_pct = elegir([100, 100, 100, 75, 50, 30, 10, rnd() < 0.2 ? 0 : 100]); }
    if (tipo === 'equip') A.dp_bar = redondear(u(0.2, 3), 2);
    arcs.push(A);
    return A;
  }
  // Árbol que crece desde los tanques (cada nodo nuevo se cuelga de uno ya conectado), más lazos extra
  const conectados = nodes.filter(n => n.type === 'tank').slice(0, 1).map(n => n.id);
  const pendientes = nodes.filter(n => !conectados.includes(n.id)).map(n => n.id).sort(() => rnd() - 0.5);
  let hayBomba = false;
  for (const nid of pendientes) {
    const padre = elegir(conectados);
    let tipo = elegir(['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'valve', 'equip', 'check', 'pump']);
    if (!hayBomba && conectados.length === 1 && rnd() < 0.85) tipo = 'pump';      // el primer tramo desde el tanque suele ser una bomba
    if (tipo === 'pump') hayBomba = true;
    nuevoArco(tipo, padre, nid);
    conectados.push(nid);
  }
  const extra = ent(0, 2);
  for (let i = 0; i < extra; i++) {
    const a = elegir(nodes).id, b = elegir(nodes).id;
    if (a !== b) nuevoArco(elegir(['pipe', 'pipe', 'pipe', 'check', 'valve']), a, b);
  }

  const fluid = rnd() < 0.7
    ? { type: 'water', temp: ent(5, 90), q_required: rnd() < 0.5 ? 0 : redondear(u(10, 300), 1), customName: '' }
    : { type: 'custom', rho: redondear(u(700, 1500), 1), nu: redondear(u(0.5, 50), 3) * 1e-6, q_required: 0, customName: 'Fluido X' };
  const opc = { tol: elegir(['1e-4', '1e-4', '1e-6', '0.001', '', 'abc', '0']), maxIter: elegir(['300', '60', '40', '40', '', '0', 'x']) };
  return { nodes, arcs, fluid, opc };
}

module.exports = { prng, generar };
