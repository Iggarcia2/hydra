// tests/equivalencia/motor.js
'use strict';
/* Prueba de equivalencia del MOTOR DE CÁLCULO contra la versión original de un solo archivo (versiones/hydra_v25.html).
   Para cada red aleatoria (semilla fija) corre el mismo caso en dos contextos de Node:
     · «v25»: el texto original del HTML, tal cual, con un `document` de mentira que solo sirve la tolerancia y las iteraciones;
     · «repo»: los archivos de js/ (datos + nucleo + estado + calculo + resultados), sin `document` salvo el mismo de mentira para la capa de pantalla.
   y compara, de forma exacta (cada número, incluidos NaN, Infinity y -0): resultado del solver, nodos y arcos después de aplicar resultados,
   estado del cartel, curvas del sistema, tabla de ariete, y funciones sueltas (pipeCalc, K de accesorios, bombas, agua).
   Usá:  node tests/equivalencia/motor.js [cantidad_de_redes]      (por defecto 400) */
const fs = require('fs'), path = require('path');
const { RAIZ, crear, contexto, ejecutar, evaluar } = require('../lib/cargar.js');
const { generar, prng } = require('../lib/generador.js');

const N = Math.max(1, parseInt(process.argv[2], 10) || 150);
const LIMITE_MS = 2000;   // una red que tarda más que esto en el original se descarta (se cuenta aparte): el objetivo es comparar, no medir

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

function nuevoContextoV25(dom) {
  const ctx = contexto({ document: dom });
  evaluar(ctx, "let _sysCurveCache = {}; function renderNetwork(){} function renderResults(){} function renderSidebarLists(){}");
  evaluar(ctx, ORIGINAL);
  evaluar(ctx, CANON);
  return ctx;
}
function nuevoContextoRepo(dom) {
  const ctx = crear(['nucleo', 'js/estado.js', 'js/ui/calculo.js', 'js/ui/resultados.js'], { document: dom });
  evaluar(ctx, "let _sysCurveCache = {}; function renderNetwork(){} function renderResults(){} function renderSidebarLists(){}");
  evaluar(ctx, CANON);
  return ctx;
}

// Una sola secuencia de pasos que se aplica a ambos lados; cada paso devuelve un texto canónico para comparar.
function pasos(ctx, dom, red, esRepo) {
  const out = {};
  const setup = `
    state.nodes = ${JSON.stringify(red.nodes)}; state.arcs = ${JSON.stringify(red.arcs)}; state.results = null;
    ${red.fluid.type === 'water'
      ? `[fluid.rho, fluid.nu] = getWaterProps(${red.fluid.temp});`
      : `fluid.rho = ${red.fluid.rho}; fluid.nu = ${red.fluid.nu};`}
    fluid.q_required = ${red.fluid.q_required}; fluid.customName = ${JSON.stringify(red.fluid.customName)};
    _sysCurveCache = {};`;
  evaluar(ctx, setup);
  dom.els['solver-tol'] = { value: red.opc.tol }; dom.els['solver-maxiter'] = { value: red.opc.maxIter };
  const solve = esRepo ? 'solveNetwork(redActual(), leerOpcionesSolver())' : 'solveNetwork()';
  const sistema = esRepo ? 'computeSystemCurve(redActual(), a)' : 'computeSystemCurve(a)';
  const cabeza = esRepo ? 'systemHeadAt(redActual(), a, 80, null)' : 'systemHeadAt(a, 80, null)';
  const pipe = esRepo ? 'pipeCalc(dH, a, fluid)' : 'pipeCalc(dH, a)';

  const t0 = Date.now();
  let r1;
  try { r1 = evaluar(ctx, `canon(${solve})`, LIMITE_MS); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw e; r1 = 'ERROR ' + e.constructor.name + ': ' + e.message; }
  out.solve_directo = r1;
  evaluar(ctx, `_runSolverHeavy()`, LIMITE_MS);
  out.estado1 = evaluar(ctx, 'canon([state, fluid, _sysCurveCache])');
  out.cartel1 = evaluar(ctx, `canon(document.getElementById('solver-status'))`);
  // segundo cálculo en caliente (arranca con las cabezas y caudales ya resueltos) con las demandas cambiadas
  evaluar(ctx, `for (const n of state.nodes) if (n.type==='junction') n.demand = n.demand*1.3+2;`);
  evaluar(ctx, `_runSolverHeavy()`, LIMITE_MS);
  out.estado2 = evaluar(ctx, 'canon([state, fluid, _sysCurveCache])');
  out.cartel2 = evaluar(ctx, `canon(document.getElementById('solver-status'))`);
  // funciones sueltas sobre los arcos de la red
  out.sueltas = evaluar(ctx, `canon(state.arcs.map(a => {
    const dH = [0, 1e-13, 0.3, -0.3, 7.5, -22, 140][a.id % 7];
    const r = {};
    try { r.pipe = ${pipe}; } catch (e) { r.pipe = 'ERROR ' + e.message; }
    r.K = arcTotalK(a); r.fK = fittingsK(a); r.acc = arcAccessoryRows(a);
    if (a.type === 'pump') { r.h = [0, 20, 80, 500].map(q => pumpHead(q, a)); r.dh = pumpHeadDeriv(120, a); r.p = [0, 60, 900].map(q => pumpPower(q, a)); r.qmax = pumpMaxQ(a); r.sys = ${sistema}; r.cab = ${cabeza}; }
    return r;
  }))`);
  // tabla de golpe de ariete (se arma con el contenedor de mentira)
  evaluar(ctx, `state.results = { ok: true };`);
  dom.els['ariete-content'] = { innerHTML: '' };
  evaluar(ctx, 'calcAriete()');
  out.ariete = dom.els['ariete-content'].innerHTML;
  out.ms = Date.now() - t0;
  return out;
}

const rngAgua = prng(12345);
let comparaciones = 0, diferencias = 0, convergieron = 0, noConvergieron = 0, errores = 0, tarda = 0, lentas = 0;
const t0 = Date.now();
for (let s = 1; s <= N; s++) {
  const red = generar(s);
  const domV = crearDom({}), domR = crearDom({});
  let v25;
  try { v25 = pasos(nuevoContextoV25(domV), domV, red, false); }
  catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') { lentas++; continue; } throw e; }
  const rep = pasos(nuevoContextoRepo(domR), domR, red, true);
  for (const k of Object.keys(v25)) {
    if (k === 'ms') continue;
    comparaciones++;
    if (v25[k] !== rep[k]) {
      diferencias++;
      if (diferencias <= 5) {
        console.log('DIFERENCIA en red semilla ' + s + ', paso «' + k + '»');
        let i = 0; while (i < v25[k].length && v25[k][i] === rep[k][i]) i++;
        console.log('  v25 : …' + v25[k].slice(Math.max(0, i - 60), i + 80));
        console.log('  repo: …' + rep[k].slice(Math.max(0, i - 60), i + 80));
      }
    }
  }
  if (/"ok":Tn?/.test(v25.solve_directo) || v25.solve_directo.includes('"ok":T')) convergieron++; else if (v25.solve_directo.startsWith('ERROR')) errores++; else noConvergieron++;
  tarda = Math.max(tarda, v25.ms);
}
console.log('\nRedes: ' + N + ' (' + lentas + ' descartadas por tardar más de ' + LIMITE_MS + ' ms en el original)  ·  comparaciones exactas: ' + comparaciones + '  ·  diferencias: ' + diferencias);
console.log('Resultado del solver directo en v25 → convergió: ' + convergieron + ', no convergió/singular: ' + noConvergieron + ', error controlado: ' + errores + '  ·  caso más lento: ' + tarda + ' ms  ·  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
if (!convergieron) { console.log('FALLA: ninguna red convergió; la prueba no demuestra nada.'); process.exit(1); }
process.exit(diferencias ? 1 : 0);
