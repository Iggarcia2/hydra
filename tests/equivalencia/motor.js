// tests/equivalencia/motor.js
'use strict';
/* Prueba del MOTOR DE CÁLCULO contra la versión original de un solo archivo (versiones/hydra_v25.html).
   Desde la v26 el motor ya NO es idéntico al de v25 (corrige la ley de fricción, el criterio de convergencia, etc.; ver README), así que
   la comparación es en tres niveles. Para cada red aleatoria (semilla fija) corre el mismo caso en dos contextos de Node:
     · «v25»: el texto original del HTML, tal cual, con un `document` de mentira que solo sirve la tolerancia y las iteraciones;
     · «repo»: los archivos de js/ (datos + nucleo + estado + calculo + resultados).
   1. EXACTO, número por número (incluidos NaN, Infinity y -0), en lo que la v26 no tocó: K de accesorios, curvas de bombas y potencia,
      propiedades del agua, y la tabla de golpe de ariete (salvo la columna nueva «Material»).
   2. CON TOLERANCIA, en el dominio donde v25 era correcto: el solver. Se resuelve con una tolerancia muy fina en las dos versiones y se
      comparan cargas y caudales; quedan fuera, y se cuentan aparte, las redes con un tramo laminar o de transición (Re < 4000, donde la
      ley de fricción cambió a propósito) y los caudales que v25 informaba mal en retenciones contra la corriente. También se exige que el motor
      nuevo resuelva todo lo que resolvía v25 y se cuenta lo que ahora resuelve de más (nodos sin salida, que v25 declaraba «singular»). La única excepción
      aceptada: una solución de v25 con una bomba a contraflujo, que el motor nuevo informa como error explícito («Caudal inverso en la bomba…»); se cuenta aparte.
   3. pipeCalc() suelto, solo donde ambas versiones dan flujo turbulento: mismo caudal.
   Usá:  node tests/equivalencia/motor.js [cantidad_de_redes]      (por defecto 150) */
const fs = require('fs'), path = require('path');
const { RAIZ, crear, contexto, ejecutar, evaluar } = require('../lib/cargar.js');
const { generar } = require('../lib/generador.js');

const N = Math.max(1, parseInt(process.argv[2], 10) || 150);
const LIMITE_MS = 4000;   // una red que tarda más que esto en el original se descarta (se cuenta aparte): el objetivo es comparar, no medir
const TOL = 1e-9, MAX_ITER = 300;                        // tolerancia fina para el solver de las dos versiones
const LIM_H = 1e-5, LIM_Q = 1e-5;                        // [m] y [relativo al mayor caudal de la red] aceptados entre las dos soluciones
const RE_TURB = 4000;

// ── Texto original: el <script> de versiones/hydra_v25.html. Los rangos son líneas de ese script (la 1 es 'use strict').
const html = fs.readFileSync(path.join(RAIZ, 'versiones', 'hydra_v25.html'), 'utf8').split('\n');
const iScript = html.findIndex(l => l.trim() === '<script>');
if (iScript < 0) throw new Error('No se encontró el <script> de la versión original');
const js = html.slice(iScript + 1);
const R = (a, b) => js.slice(a - 1, b).join('\n');
const ORIGINAL = [
  R(2, 5), R(9, 61), R(62, 149), R(150, 151), R(155, 172), R(697, 698), R(703, 713), R(738, 851), R(863, 1415), R(1417, 1440), R(1442, 1677),
  R(3329, 3330), R(3332, 3340), R(3342, 3348), R(3350, 3431), R(1778, 1853),
].join('\n\n');

// ── Doble de `document`: sirve valores de entrada y recuerda lo que se le escribe
function crearDom(valores) {
  const els = {};
  return { getElementById(id) { return els[id] || (els[id] = { id, value: valores[id], className: '', textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }); }, els };
}
const CANON = `function canon(v){
  if (v === undefined) return 'U';
  if (v === null) return 'N';
  if (typeof v === 'number') return Object.is(v, -0) ? 'n-0' : 'n' + String(v);
  if (typeof v === 'string') return 's' + JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (typeof v === 'function') return 'fn';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}`;
const STUBS = 'let _sysCurveCache = {}; function renderNetwork(){} function renderResults(){} function renderSidebarLists(){}';

function nuevoContextoV25(dom) {
  const ctx = contexto({ document: dom });
  evaluar(ctx, STUBS); evaluar(ctx, ORIGINAL); evaluar(ctx, CANON);
  return ctx;
}
function nuevoContextoRepo(dom) {
  const ctx = crear(['nucleo', 'js/estado.js', 'js/ui/calculo.js', 'js/ui/resultados.js'], { document: dom });
  evaluar(ctx, STUBS); evaluar(ctx, CANON);
  return ctx;
}

// Dos materiales cambian de comportamiento A PROPÓSITO en v26 y no se prueban acá (tienen sus propias pruebas): ε = 0 (v25 lo tomaba como
// 0,046) y ε = 0,26 (fundición gris: ahora con su módulo de Young). Se reemplazan igual en las dos versiones.
function normalizar(red) {
  for (const a of red.arcs) { if (a.eps_mm === 0) a.eps_mm = 0.046; if (a.eps_mm === 0.26) a.eps_mm = 0.25; }
  return red;
}
function cargarRed(ctx, red) {
  evaluar(ctx, `
    state.nodes = ${JSON.stringify(red.nodes)}; state.arcs = ${JSON.stringify(red.arcs)}; state.results = null;
    ${red.fluid.type === 'water'
      ? `[fluid.rho, fluid.nu] = getWaterProps(${red.fluid.temp});`
      : `fluid.rho = ${red.fluid.rho}; fluid.nu = ${red.fluid.nu};`}
    fluid.q_required = ${red.fluid.q_required}; fluid.customName = ${JSON.stringify(red.fluid.customName)};
    _sysCurveCache = {};`);
}

// Nivel 2: solver con tolerancia fina. Devuelve {ok, msg} o {ok, H:{nodo:H}, Q:{arco:Q}, Re:{arco:Re}}.
function resolver(ctx, dom, red, esRepo) {
  cargarRed(ctx, red);
  dom.els['solver-tol'] = { value: TOL }; dom.els['solver-maxiter'] = { value: MAX_ITER };
  const solve = esRepo ? 'solveNetwork(redActual(), leerOpcionesSolver())' : 'solveNetwork()';
  const txt = evaluar(ctx, `JSON.stringify((() => { let s; try { s = ${solve}; } catch (e) { return {ok:false, msg:'ERROR ' + e.message}; }
    if (!s.ok) return {ok:false, msg:s.msg};
    const H = {}, Q = {}, Re = {};
    for (const n of state.nodes) H[n.id] = s.nodeRes[n.id].H;
    for (const a of state.arcs) { Q[a.id] = s.arcRes[a.id].Q; Re[a.id] = s.arcRes[a.id].Re; }
    return {ok:true, H, Q, Re}; })())`, LIMITE_MS);
  return JSON.parse(txt);
}

// Niveles 1 y 3: pasos exactos sobre la misma red.
function pasosExactos(ctx, dom, red, esRepo) {
  const out = {};
  cargarRed(ctx, red);
  // funciones sueltas sobre los arcos de la red
  out.sueltas = evaluar(ctx, `canon(state.arcs.map(a => {
    const r = {};
    r.K = arcTotalK(a); r.fK = fittingsK(a); r.acc = arcAccessoryRows(a);
    if (a.type === 'pump') { r.h = [0, 20, 80, 500].map(q => pumpHead(q, a)); r.dh = pumpHeadDeriv(120, a); r.p = [0, 60, 900].map(q => pumpPower(q, a)); r.qmax = pumpMaxQ(a); }
    return r;
  }))`);
  out.agua = evaluar(ctx, 'canon([0, 4, 20, 37.5, 60, 99, 100].map(T => getWaterProps(T)))');
  // tabla de golpe de ariete con velocidades y presiones fijas (iguales en las dos versiones, para no depender del solver)
  evaluar(ctx, `state.nodes.forEach(n => { n.P = 1.5 + (n.id % 4) * 0.7; }); state.arcs.forEach(a => { a.V = 0.4 + (a.id % 6) * 0.35; }); state.results = { ok: true };`);
  dom.els['ariete-content'] = { innerHTML: '' };
  evaluar(ctx, 'calcAriete()');
  let celdas = dom.els['ariete-content'].innerHTML.match(/<td[\s\S]*?<\/td>/g) || [];
  if (esRepo) {       // v26 agrega la columna «Material» (2.ª de cada fila de 9): se quita para comparar el resto celda por celda
    const por = 9; if (celdas.length % por) throw new Error('tabla de ariete del repo con ' + celdas.length + ' celdas');
    celdas = celdas.filter((_, i) => i % por !== 1);
  }
  out.ariete = celdas.join('|');
  // pipeCalc suelto (nivel 3): una fila por (arco, ΔH)
  const pipe = esRepo ? 'pipeCalc(dH, a, fluid)' : 'pipeCalc(dH, a)';
  out.pipe = JSON.parse(evaluar(ctx, `JSON.stringify(state.arcs.filter(a => a.type === 'pipe' || a.type === 'check' || a.type === 'valve').map(a =>
    [0.3, -0.3, 7.5, -22, 140].map(dH => { try { const r = ${pipe}; return [r.Q, r.Re]; } catch (e) { return null; } })))`));
  return out;
}

let comparaciones = 0, difExactas = 0, difSolver = 0, lentas = 0;
let ambos = 0, comparadas = 0, noTurbulentas = 0, soloRepo = 0, soloV25 = 0, ninguna = 0, otroEquilibrio = 0, fallasSolver = 0, contraflujo = 0;
let pipeComparados = 0, pipeDistintos = 0, peorH = 0, peorQ = 0;
const t0 = Date.now();
function avisar(titulo, semilla, a, b) {
  console.log(titulo + ' en red semilla ' + semilla);
  if (typeof a === 'string' && typeof b === 'string') {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log('  v25 : …' + a.slice(Math.max(0, i - 60), i + 80)); console.log('  repo: …' + b.slice(Math.max(0, i - 60), i + 80));
  } else { console.log('  v25 : ' + a); console.log('  repo: ' + b); }
}
for (let s = 1; s <= N; s++) {
  const red = normalizar(generar(s));
  const domV = crearDom({}), domR = crearDom({});
  const ctxV = nuevoContextoV25(domV), ctxR = nuevoContextoRepo(domR);
  // nivel 2: solver
  let v25, rep;
  try { v25 = resolver(ctxV, domV, red, false); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') { lentas++; continue; } throw e; }
  try { rep = resolver(ctxR, domR, red, true); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') { rep = { ok: false, msg: 'tiempo agotado' }; } else throw e; }
  const bombaInversaV25 = v25.ok && red.arcs.some(a => a.type === 'pump' && v25.Q[a.id] < -1e-6);
  if (v25.ok && !rep.ok && bombaInversaV25 && /^Caudal inverso/.test(rep.msg)) contraflujo++;   // v25 daba por válida una solución con la bomba al revés; ahora es un error explícito (ver README)
  else if (v25.ok && !rep.ok) { soloV25++; fallasSolver++; avisar('El motor nuevo NO resuelve lo que resolvía v25 (' + rep.msg + ')', s, 'convergió', rep.msg); }
  else if (!v25.ok && rep.ok) soloRepo++;
  else if (!v25.ok && !rep.ok) ninguna++;
  else {
    ambos++;
    const retenciones = red.arcs.some(a => a.type === 'check' || (a.type === 'valve' && a.valveType === 'check'));
    const noTurb = red.arcs.some(a => (a.type === 'pipe' || a.type === 'check' || a.type === 'valve') &&
      ((Math.abs(v25.Q[a.id]) > 1e-9 && v25.Re[a.id] < RE_TURB) || (Math.abs(rep.Q[a.id]) > 1e-9 && rep.Re[a.id] < RE_TURB)));
    if (noTurb) noTurbulentas++;
    else {
      const escala = Math.max(1, ...Object.values(rep.Q).map(Math.abs));
      let dH = 0, dQ = 0;
      for (const id of Object.keys(rep.H)) dH = Math.max(dH, Math.abs(rep.H[id] - v25.H[id]));
      for (const a of red.arcs) {
        const bloqueada = (a.type === 'check' || (a.type === 'valve' && a.valveType === 'check')) && rep.Q[a.id] === 0;   // v25 informaba el caudal inverso que habría sin retención
        if (!bloqueada) dQ = Math.max(dQ, Math.abs(rep.Q[a.id] - v25.Q[a.id]) / escala);
      }
      if (dH > LIM_H || dQ > LIM_Q || !Number.isFinite(dH + dQ)) {
        if (retenciones) otroEquilibrio++;        // con retenciones puede haber más de un equilibrio válido: se cuenta, no se descarta en silencio
        else { difSolver++; avisar('DIFERENCIA del solver (carga ' + dH.toExponential(2) + ' m, caudal relativo ' + dQ.toExponential(2) + ')', s, JSON.stringify(v25.Q), JSON.stringify(rep.Q)); }
      } else { comparadas++; peorH = Math.max(peorH, dH); peorQ = Math.max(peorQ, dQ); }
    }
  }
  // niveles 1 y 3
  const dv = crearDom({}), dr = crearDom({});
  const pv = pasosExactos(ctxV, dv, red, false), pr = pasosExactos(ctxR, dr, red, true);
  for (const k of ['sueltas', 'agua', 'ariete']) {
    comparaciones++;
    if (pv[k] !== pr[k]) { difExactas++; if (difExactas <= 5) avisar('DIFERENCIA en «' + k + '»', s, pv[k], pr[k]); }
  }
  pv.pipe.forEach((filas, i) => filas.forEach((a, j) => {
    const b = pr.pipe[i][j];
    if (!a || !b || !(a[1] >= RE_TURB && b[1] >= RE_TURB)) return;      // solo flujo turbulento en las dos versiones
    pipeComparados++;
    if (Math.abs(a[0] - b[0]) > 1e-6 * Math.abs(a[0]) + 1e-9) { pipeDistintos++; if (pipeDistintos <= 5) avisar('DIFERENCIA en pipeCalc (arco ' + i + ', ΔH ' + j + ')', s, String(a[0]), String(b[0])); }
  }));
}
console.log('\nRedes: ' + N + ' (' + lentas + ' descartadas por tardar más de ' + LIMITE_MS + ' ms en el original)');
console.log('Nivel 1 · comparaciones exactas (K, bombas, agua, tabla de ariete): ' + comparaciones + '  ·  diferencias: ' + difExactas);
console.log('Nivel 2 · solver con tolerancia ' + TOL + ' en las dos versiones:');
console.log('   resueltas por las dos: ' + ambos + '  →  comparadas ' + comparadas + ' (peor dif. de carga ' + peorH.toExponential(2) + ' m, de caudal relativa ' + peorQ.toExponential(2) + '), con tramos Re < ' + RE_TURB + ' (ley de fricción nueva, no comparable) ' + noTurbulentas + ', con otro equilibrio válido (retenciones) ' + otroEquilibrio);
console.log('   solo el motor nuevo resuelve: ' + soloRepo + '  ·  solo v25 resuelve: ' + soloV25 + '  ·  ninguno: ' + ninguna + '  ·  v25 «resolvía» con la bomba a contraflujo y ahora es un error explícito: ' + contraflujo);
console.log('   diferencias del solver fuera de tolerancia: ' + difSolver + '  ·  fallos por no resolver lo que resolvía v25: ' + fallasSolver);
console.log('Nivel 3 · pipeCalc() turbulento: ' + pipeComparados + ' comparaciones, ' + pipeDistintos + ' distintas');
console.log('Total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
if (comparadas < 20) { console.log('FALLA: muy pocas redes comparables (' + comparadas + '); la prueba no demuestra nada.'); process.exit(1); }
process.exit(difExactas || difSolver || pipeDistintos || fallasSolver ? 1 : 0);
