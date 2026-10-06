// tests/unit/test_nucleo.js
'use strict';
/* Pruebas del motor de cálculo (js/datos + js/nucleo) cargado SIN pantalla: cada archivo corre en un contexto vacío, así que si alguno
   tocara el DOM o una variable global del estado, la carga fallaría con ReferenceError.
   Las referencias son independientes del código probado: fórmulas cerradas (Hagen-Poiseuille, Joukowsky), una resolución de Colebrook por
   bisección escrita acá, y planteos de equilibrio resueltos por bisección. Los casos con datos inválidos fijan el comportamiento esperado. */
const { crear, evaluar, contexto, ejecutar, leer, rutas } = require('../lib/cargar.js');
const { generar } = require('../lib/generador.js');
const { seccion, prueba, cierto, igual, igualJSON, cercano, lanza, correr } = require('../lib/mini.js');

const ctx = crear(['nucleo', 'js/estado.js']);          // estado.js solo aporta mkNode/mkArc (fábricas con los valores por defecto reales)
const R = codigo => evaluar(ctx, codigo);
const G = 9.81;

// ── Referencias independientes ─────────────────────────────────────────────────────────────────────────────────────────────────
function colebrookRef(Re, eD) {           // 1/√f = −2·log10(ε/(3,7·D) + 2,51/(Re·√f)) resuelta por bisección en f
  if (Re < 1) return 0.02;
  if (Re < 2300) return 64 / Re;           // el motor usa Hagen-Poiseuille por debajo de 2300 (igual que el original)
  const F = f => 1 / Math.sqrt(f) + 2 * Math.log10(eD / 3.7 + 2.51 / (Re * Math.sqrt(f)));
  let lo = 0.005, hi = 0.2;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (F(lo) * F(m) <= 0) ? hi = m : lo = m; }
  return (lo + hi) / 2;
}
function hfRef(Qm3h, D_mm, L_m, eps_mm, K, nu) {   // pérdida de carga [m] de un tramo (Darcy-Weisbach + K)
  const D = D_mm / 1000, A = Math.PI * D * D / 4, V = Math.abs(Qm3h) / 3600 / A, Re = V * D / nu;
  if (V === 0) return 0;
  const f = colebrookRef(Re, eps_mm / 1000 / D);
  return (f * L_m / D + K) * V * V / (2 * G);
}
function biseccion(F, lo, hi) { for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (F(lo) * F(m) <= 0) ? hi = m : lo = m; } return (lo + hi) / 2; }
const NU = 1.004e-6, RHO = 998.2;

// ── Red de prueba en el contexto del motor ────────────────────────────────────────────────────────────────────────────────────
function red(codigo) { ctx.__r = R('(() => {' + codigo + '})()'); return ctx.__r; }
function resolver(r, opc) { ctx.__r = r; ctx.__o = opc || { tol: 1e-9, maxIter: 200 }; return R('solveNetwork(__r, __o)'); }
const FL = 'const fl = {rho: 998.2, nu: 1.004e-6};';

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
seccion('Independencia del motor (sin pantalla)');
prueba('js/datos y js/nucleo cargan en un contexto vacío (sin document, window ni state)', () => {
  const lista = rutas(['nucleo']);
  cierto(lista.length >= 15, 'se esperaban todos los módulos del motor, hay ' + lista.length);
  const vacio = contexto();
  ejecutar(vacio, lista, leer(lista));               // lanza ReferenceError si algún archivo toca el DOM o el estado global
  igual(evaluar(vacio, "typeof document + typeof window + typeof state + typeof fluid"), 'undefinedundefinedundefinedundefined');
});
prueba('el motor no deja variables globales de pantalla escondidas (solo funciones y constantes del cálculo)', () => {
  const lista = rutas(['nucleo']);
  const textos = leer(lista);
  for (const r of lista) cierto(!/\bdocument\b|\bwindow\b|\blocalStorage\b|\bstate\./.test(textos[r].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), r + ' nombra document/window/localStorage/state');
});

seccion('Utilidades');
prueba('esc() escapa los cinco caracteres peligrosos y tolera null/undefined/números', () => {
  igual(R(`esc('<img src=x onerror="alert(1)">&\\'')`), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  igual(R('esc(null)'), ''); igual(R('esc(undefined)'), ''); igual(R('esc(0)'), '0'); igual(R('esc(12.5)'), '12.5');
});
prueba('parseLocaleFloat(): coma, punto, miles en ambos formatos, vacíos y basura', () => {
  const casos = [['150,5', 150.5], ['150.5', 150.5], ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['  7 ', 7], ['-3,5', -3.5], ['1e3', 1000], ['0', 0], ['12abc', 12]];
  for (const [e, v] of casos) igual(R(`parseLocaleFloat(${JSON.stringify(e)})`), v, JSON.stringify(e));
  for (const e of ['', '   ', 'abc', 'Infinity', '-Infinity', 'NaN', '--']) igual(R(`parseLocaleFloat(${JSON.stringify(e)})`), NaN, JSON.stringify(e));
  igual(R('parseLocaleFloat(null)'), NaN); igual(R('parseLocaleFloat(undefined)'), NaN);
});
prueba('fmtK(): número con 2 decimales y texto legible para K infinito', () => {
  igual(R('fmtK(1.234)'), '1.23'); igual(R('fmtK(0)'), '0.00'); igual(R('fmtK(Infinity)'), '∞ (cerrada)');
});

seccion('Propiedades del agua');
prueba('getWaterProps(): valores de la tabla, interpolación lineal y topes', () => {
  igualJSON(R('getWaterProps(20)'), [998.2, 1.004e-6]);
  const m = R('getWaterProps(22.5)');                       // punto medio entre 20 y 25 °C
  cercano(m[0], (998.2 + 997.0) / 2, 1e-12); cercano(m[1], (1.004e-6 + 0.893e-6) / 2, 1e-12);
  igualJSON(R('getWaterProps(-10)'), [999.9, 1.518e-6]); igualJSON(R('getWaterProps(200)'), [965.3, 0.326e-6]);
  igualJSON(R('getWaterProps(5)'), [999.9, 1.518e-6]); igualJSON(R('getWaterProps(90)'), [965.3, 0.326e-6]);
});
prueba('getWaterProps(): la densidad baja y la viscosidad baja al subir la temperatura (monótono)', () => {
  let prev = R('getWaterProps(5)');
  for (let T = 6; T <= 90; T++) { const w = R(`getWaterProps(${T})`); cierto(w[0] <= prev[0] && w[1] <= prev[1], 'no monótono en ' + T + ' °C'); prev = w; }
});
prueba('getWaterProps(): temperatura no numérica → error claro (antes devolvía undefined)', () => {
  for (const t of ['NaN', 'Infinity', 'undefined', "'abc'"]) lanza(() => R(`getWaterProps(${t})`), /temperatura/, t);
});

seccion('Fricción y caudal de un tramo');
prueba('colebrook(): laminar 64/Re, valor mínimo para Re<1 y coincidencia con una resolución independiente', () => {
  igual(R('colebrook(0.5, 0.001)'), 0.02); igual(R('colebrook(1000, 0.001)'), 0.064); igual(R('colebrook(2299, 0)'), 64 / 2299);
  for (const Re of [2300, 4000, 1e4, 1e5, 1e6, 1e7]) for (const eD of [0, 1e-5, 1e-3, 0.01, 0.05])
    cercano(R(`colebrook(${Re}, ${eD})`), colebrookRef(Re, eD), 1e-7, `Re=${Re} e/D=${eD}`);
});
prueba('colebrook(): valor de manual (Re=1e5, e/D=0,001 → f≈0,0222) y Blasius para tubo liso', () => {
  cercano(R('colebrook(1e5, 0.001)'), 0.0222, 0.01);
  cercano(R('colebrook(1e5, 0)'), 0.3164 / Math.pow(1e5, 0.25), 0.03);   // Blasius es aproximado: ±3 %
});
prueba('pipeCalc(): flujo laminar contra Hagen-Poiseuille (Q = π·g·D⁴·ΔH / (128·ν·L))', () => {
  const arc = R(`mkArc('pipe',1,2,{D_mm:20,L_m:10,eps_mm:0.046})`); ctx.__a = arc;
  const c = R('pipeCalc(0.5, __a, {rho:900, nu:1e-4})');
  const Qh = Math.PI * G * Math.pow(0.02, 4) * 0.5 / (128 * 1e-4 * 10) * 3600;
  cercano(c.Q, Qh, 5e-3, 'caudal laminar');          // el cálculo itera 12 veces: en régimen muy laminar queda a ~0,14 % de la solución cerrada
  igual(c.regime, 'Laminar'); cierto(c.Re < 2300);
});
prueba('pipeCalc(): turbulento cierra la ecuación de Darcy-Weisbach (ΔH = f·L/D·V²/2g + K·V²/2g)', () => {
  for (const [D, L, eps, dH] of [[100, 100, 0.046, 10], [300, 500, 0.15, 3], [50, 20, 0.0015, 25], [200, 1000, 0.26, 40]]) {
    ctx.__a = R(`mkArc('pipe',1,2,{D_mm:${D},L_m:${L},eps_mm:${eps},customK:3.5})`);
    const c = R(`pipeCalc(${dH}, __a, {rho:998.2, nu:${NU}})`);
    cercano(hfRef(c.Q, D, L, eps, 3.5, NU), dH, 1e-6, `D=${D} L=${L}`);
    igual(c.regime, 'Turbulento');
  }
});
prueba('pipeCalc(): invierte el signo con la pendiente y devuelve cero sin pendiente', () => {
  ctx.__a = R(`mkArc('pipe',1,2,{D_mm:100,L_m:50})`);
  const a = R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`), b = R(`pipeCalc(-5, __a, {rho:998.2, nu:${NU}})`), z = R(`pipeCalc(0, __a, {rho:998.2, nu:${NU}})`);
  cierto(a.Q > 0); igual(b.Q, -a.Q); igual(z.Q, 0);
});
prueba('pipeCalc(): la rugosidad y el sarro aumentan la pérdida (menos caudal)', () => {
  ctx.__a = R(`mkArc('pipe',1,2,{D_mm:100,L_m:100,eps_mm:0.046})`); ctx.__b = R(`mkArc('pipe',1,2,{D_mm:100,L_m:100,eps_mm:0.046,fouling_mm:0.5})`);
  cierto(R(`pipeCalc(5, __b, {rho:998.2, nu:${NU}})`).Q < R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`).Q);
});
prueba('pipeCalc(): válvula cerrada, diámetro 0, longitud negativa y sin resistencia bloquean el tramo', () => {
  const cerrada = R(`mkArc('valve',1,2,{valveType:'gate',open_pct:0})`); ctx.__a = cerrada;
  const c = R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`); igual(c.Q, 0); igual(c.regime, 'Cerrada');
  for (const extra of ['D_mm:0', 'L_m:-5', 'D_mm:-10']) { ctx.__a = R(`mkArc('pipe',1,2,{${extra}})`); igual(R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`).Q, 0, extra); }
  ctx.__a = R(`mkArc('pipe',1,2,{L_m:0})`); igual(R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`).Q, 0, 'L=0 sin accesorios');
  ctx.__a = R(`mkArc('check',1,2,{type:'valve',valveType:'check'})`);   // retención sola: piso mínimo de K, no singular
  ctx.__a.type = 'valve'; ctx.__a.valveType = 'check';
  cierto(R(`pipeCalc(5, __a, {rho:998.2, nu:${NU}})`).Q > 0, 'una válvula de retención sola tiene que dejar pasar caudal');
});
prueba('pipeCalc(): sin fluido o con viscosidad inválida lanza un error claro; dH no finito da caudal 0', () => {
  ctx.__a = R(`mkArc('pipe',1,2,{})`);
  for (const f of ['undefined', 'null', '{rho:998}', '{rho:998, nu:0}', '{rho:998, nu:-1e-6}', '{rho:998, nu:NaN}']) lanza(() => R(`pipeCalc(5, __a, ${f})`), /fluido|viscosidad/, f);
  for (const d of ['NaN', 'Infinity', '-Infinity']) igual(R(`pipeCalc(${d}, __a, {rho:998.2, nu:${NU}})`).Q, 0, d);
});

seccion('Accesorios y válvulas');
prueba('valveKAtPct(): puntos tabulados, interpolación log-lineal, extrapolación y cierre', () => {
  igual(R(`valveKAtPct('gate', 100)`), 0.2); igual(R(`valveKAtPct('gate', 50)`), 17); igual(R(`valveKAtPct('globe', 100)`), 10); cercano(R(`valveKAtPct('ball', 10)`), 400, 1e-12);
  cercano(R(`valveKAtPct('gate', 62.5)`), Math.sqrt(2 * 17), 1e-12, 'media geométrica entre 75 % y 50 %');
  igual(R(`valveKAtPct('gate', 0)`), Infinity); igual(R(`valveKAtPct('gate', -5)`), Infinity);
  igual(R(`valveKAtPct('gate', 150)`), 0.2); igual(R(`valveKAtPct('gate', NaN)`), 0.2, 'NaN se toma como 100 %');
  igual(R(`valveKAtPct('inexistente', 50)`), 0);
  cierto(R(`valveKAtPct('gate', 5)`) > 900, 'por debajo de 10 % extrapola hacia arriba');
  for (const c of ['gate', 'ball', 'butterfly', 'globe']) { let prev = 0; for (let p = 100; p >= 5; p -= 5) { const k = R(`valveKAtPct('${c}', ${p})`); cierto(k >= prev, c + ' no monótona en ' + p + ' %'); prev = k; } }
});
prueba('fittingsK() y arcTotalK(): suma de cantidades × K, curva de apertura, K adicional y válvula cerrada', () => {
  ctx.__a = R(`mkArc('pipe',1,2,{fitQty:[2,0,1,0,0,0,0,0,0,0,0,0,0,0], customK:1.5})`);
  cercano(R('fittingsK(__a)'), 2 * 0.9 + 0.4, 1e-12); cercano(R('arcTotalK(__a)'), 2 * 0.9 + 0.4 + 1.5, 1e-12);
  ctx.__a = R(`mkArc('pipe',1,2,{fitQty:[0,0,0,0,0,1,0,0,0,0,0,0,0,0], fitOpen:[100,100,100,100,100,50,100,100,100,100,100,100,100,100]})`);
  igual(R('fittingsK(__a)'), 17, 'compuerta al 50 %');
  ctx.__a.fitOpen[5] = 0; igual(R('fittingsK(__a)'), Infinity); igual(R('arcTotalK(__a)'), Infinity);
  ctx.__a = R(`mkArc('valve',1,2,{valveType:'globe', open_pct:50, customK:1})`); ctx.__a.type = 'valve';
  cercano(R('arcTotalK(__a)'), 45 + 1, 1e-12, 'válvula dedicada: K de la curva + K adicional');
});
prueba('arcAccessoryRows(): una fila por accesorio con cantidad y una más para la válvula dedicada', () => {
  ctx.__a = R(`mkArc('valve',1,2,{valveType:'ball', open_pct:75, fitQty:[1,0,0,0,0,0,2,0,0,0,0,0,0,0]})`); ctx.__a.type = 'valve';
  const filas = R('arcAccessoryRows(__a)');
  igual(filas.length, 3); igual(filas[0].accesorio, 'Codo 90° estándar'); igual(filas[1].tipo, 'Esfera'); igual(filas[2].accesorio, 'Elemento válvula'); igual(filas[2].apertura, 75);
});

seccion('Bombas');
prueba('pumpHead(): interpola, extrapola con tope y devuelve 50 m si la curva es insuficiente', () => {
  ctx.__a = R(`mkArc('pump',1,2,{pumpCurve:[{Q:200,H:10},{Q:0,H:40},{Q:100,H:30}]})`);   // desordenada a propósito
  igual(R('pumpHead(0, __a)'), 40); cercano(R('pumpHead(50, __a)'), 35, 1e-12); cercano(R('pumpHead(150, __a)'), 20, 1e-12); igual(R('pumpHead(200, __a)'), 10);
  igual(R('pumpHead(-50, __a)'), 35, 'usa el valor absoluto del caudal');
  igual(R('pumpHead(1000, __a)'), -12, 'extrapolación tope −30 % de la carga a caudal cero');
  cercano(R('pumpHead(210, __a)'), 10 - 0.2 * 10, 1e-12, 'extrapolación lineal antes del tope');
  ctx.__b = R(`mkArc('pump',1,2,{pumpCurve:[{Q:0,H:40}]})`); igual(R('pumpHead(10, __b)'), 50);
});
prueba('pumpHeadDeriv(), pumpMaxQ() y pumpPower()', () => {
  ctx.__a = R(`mkArc('pump',1,2,{nPumps:2, pumpCurve:[{Q:0,H:40},{Q:100,H:30},{Q:200,H:10}], powerCurve:[{Q:0,P:5},{Q:200,P:15}]})`);
  cercano(R('pumpHeadDeriv(50, __a)'), -0.1, 1e-9); cercano(R('pumpHeadDeriv(150, __a)'), -0.2, 1e-9);
  igual(R('pumpMaxQ(__a)'), 400, 'dos bombas en paralelo');
  cercano(R('pumpPower(100, __a)'), 10, 1e-12); igual(R('pumpPower(0, __a)'), 5); cercano(R('pumpPower(300, __a)'), 20, 1e-12);
  ctx.__b = R(`mkArc('pump',1,2,{powerCurve:[]})`); igual(R('pumpPower(10, __b)'), null);
});

seccion('Álgebra');
prueba('gaussSolve(): sistema conocido, pivoteo y matriz singular o no finita', () => {
  igualJSON(R('gaussSolve([[2,1,-1],[-3,-1,2],[-2,1,2]], [8,-11,-3])').map(x => +x.toFixed(10)), [2, 3, -1]);
  igualJSON(R('gaussSolve([[0,1],[1,0]], [3,4])'), [4, 3]);
  igual(R('gaussSolve([[1,2],[2,4]], [1,2])'), null); igual(R('gaussSolve([[NaN,1],[1,1]], [1,1])'), null);
  igualJSON(R('gaussSolve([[4]], [8])'), [2]);
});

seccion('Golpe de ariete (Joukowsky)');
function ariete(D, e, rho, V0, L) {   // referencia cerrada
  const K = 2.1e9, E = 200e9, a = Math.sqrt(K / rho) / Math.sqrt(1 + K * D / (E * e));
  return { a, Tc: 2 * L / a, dP: rho * a * V0 };
}
prueba('calcArieteTramo(): celeridad, tiempo crítico y sobrepresión contra la fórmula cerrada', () => {
  ctx.__a = R(`mkArc('pipe',1,2,{D_mm:200,L_m:300,wall_mm:6})`); ctx.__a.V = 2.5;
  const t = R(`calcArieteTramo(__a, {rho:998.2, nu:${NU}}, 4)`), ref = ariete(0.2, 0.006, 998.2, 2.5, 300);
  cercano(t.a, ref.a, 1e-12); cercano(t.Tc, ref.Tc, 1e-12); cercano(t.dP, ref.dP, 1e-12);
  cercano(t.dH, ref.dP / (998.2 * 9.81), 1e-12); cercano(t.P_max_bar, 4 + ref.dP / 1e5, 1e-12);
});
prueba('calcArieteTramo(): clasificación de riesgo por umbrales de sobrepresión y velocidad nula', () => {
  const nivel = V => { ctx.__a = R(`mkArc('pipe',1,2,{D_mm:200,L_m:100,wall_mm:6})`); ctx.__a.V = V; return R(`calcArieteTramo(__a, {rho:998.2, nu:${NU}}, 0)`).risk; };
  igual(nivel(0), '🟢 Bajo'); igual(nivel(0.2), '🟢 Bajo'); igual(nivel(0.5), '🟡 Medio'); igual(nivel(1.0), '🔴 Alto'); igual(nivel(-1.0), '🔴 Alto', 'el sentido del flujo no importa');
  ctx.__a = R(`mkArc('pipe',1,2,{})`); ctx.__a.V = null; igual(R(`calcArieteTramo(__a, {rho:998.2, nu:${NU}}, 0)`).dP, 0, 'sin resultado de velocidad');
});
prueba('HALLAZGO conocido: el módulo de Young se busca con una clave que no existe y todo material usa el del acero', () => {
  // Se conserva el comportamiento del original (ver README, «Hallazgos»). Si algún día se corrige, este test falla a propósito: actualizarlo.
  const a = eps => { ctx.__a = R(`mkArc('pipe',1,2,{D_mm:200,L_m:100,wall_mm:10,eps_mm:${eps}})`); ctx.__a.V = 1; return R(`calcArieteTramo(__a, {rho:998.2, nu:${NU}}, 0)`).a; };
  const ref = ariete(0.2, 0.01, 998.2, 1, 100).a;
  cercano(a(0.046), ref, 1e-12, 'acero carbono'); cercano(a(0.0015), ref, 1e-12, 'PVC/HDPE/cobre usan el módulo del acero'); cercano(a(0.26), ref, 1e-12, 'fundición');
});
prueba('pipeWallThickness(): espesor indicado, 6 % del diámetro y mínimo de 5 mm', () => {
  igual(R('pipeWallThickness({wall_mm: 8})'), 0.008); cercano(R('pipeWallThickness({D_mm: 200})'), 0.012, 1e-12);
  igual(R('pipeWallThickness({D_mm: 40})'), 0.005); igual(R('pipeWallThickness({wall_mm: 0, D_mm: 40})'), 0.005);
});

seccion('Solver: soluciones de referencia');
prueba('dos tramos en serie entre tanques: caudal y carga intermedia contra bisección independiente', () => {
  for (const [D1, L1, D2, L2] of [[100, 100, 100, 100], [150, 200, 100, 80], [80, 50, 200, 400]]) {
    const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
      const p1=mkArc('pipe',A.id,J.id,{D_mm:${D1},L_m:${L1}}), p2=mkArc('pipe',J.id,B.id,{D_mm:${D2},L_m:${L2}}); return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`);
    const s = resolver(r);
    cierto(s.ok, s.msg);
    const Qref = biseccion(Q => hfRef(Q, D1, L1, 0.046, 0, NU) + hfRef(Q, D2, L2, 0.046, 0, NU) - 20, 0, 5000);
    const Q1 = s.arcRes[r.arcs[0].id].Q, Q2 = s.arcRes[r.arcs[1].id].Q;
    cercano(Q1, Qref, 1e-5, `Q (${D1}/${L1} + ${D2}/${L2})`); cercano(Q2, Q1, 1e-6, 'continuidad en el nodo');
    cercano(s.nodeRes[r.nodes[1].id].H, 30 - hfRef(Qref, D1, L1, 0.046, 0, NU), 1e-5, 'carga en el nodo J');
  }
});
prueba('demanda en el nodo intermedio: el caudal que entra menos el que sale es la demanda', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:40}), J=mkNode('junction',0,0,{label:'J',demand:25}), B=mkNode('tank',0,0,{label:'B',cota:5});
    const p1=mkArc('pipe',A.id,J.id,{D_mm:150,L_m:300}), p2=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:200}); return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  cercano(s.arcRes[r.arcs[0].id].Q - s.arcRes[r.arcs[1].id].Q, 25, 1e-6, 'balance de masa');
  const H = s.nodeRes[r.nodes[1].id].H;
  cercano(hfRef(s.arcRes[r.arcs[0].id].Q, 150, 300, 0.046, 0, NU), 40 - H, 1e-5, 'energía en el primer tramo');
  cercano(hfRef(s.arcRes[r.arcs[1].id].Q, 100, 200, 0.046, 0, NU), H - 5, 1e-5, 'energía en el segundo tramo');
});
prueba('dos tuberías iguales en paralelo reparten el caudal por mitades', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:20}), J1=mkNode('junction',0,0,{label:'J1'}), J2=mkNode('junction',0,0,{label:'J2'}), B=mkNode('tank',0,0,{label:'B',cota:0});
    const p0=mkArc('pipe',A.id,J1.id,{D_mm:200,L_m:50}), pa=mkArc('pipe',J1.id,J2.id,{D_mm:100,L_m:100}), pb=mkArc('pipe',J1.id,J2.id,{D_mm:100,L_m:100}), p3=mkArc('pipe',J2.id,B.id,{D_mm:200,L_m:50});
    return {nodes:[A,J1,J2,B],arcs:[p0,pa,pb,p3],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  const Qa = s.arcRes[r.arcs[1].id].Q, Qb = s.arcRes[r.arcs[2].id].Q;
  cercano(Qa, Qb, 1e-7); cercano(Qa + Qb, s.arcRes[r.arcs[0].id].Q, 1e-7);
});
prueba('bomba por curva y tubería a un tanque alto: punto de operación contra bisección independiente', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:0}), J=mkNode('junction',0,0,{label:'J',cota:0}), B=mkNode('tank',0,0,{label:'B',cota:15});
    const bm=mkArc('pump',A.id,J.id,{pumpCurve:[{Q:0,H:40},{Q:100,H:36},{Q:200,H:28},{Q:300,H:15},{Q:400,H:0}]}), p=mkArc('pipe',J.id,B.id,{D_mm:150,L_m:200,fitQty:[3,0,0,0,0,0,0,0,0,0,0,0,0,0]});
    return {nodes:[A,J,B],arcs:[bm,p],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  const bm = r.arcs[0]; ctx.__a = bm;
  const Qref = biseccion(Q => R(`pumpHead(${Q}, __a)`) - (15 + hfRef(Q, 150, 200, 0.046, 3 * 0.9, NU)), 0, 399);
  cercano(s.arcRes[bm.id].Q, Qref, 1e-5, 'caudal de operación');
  cercano(s.arcRes[bm.id].hf, R(`pumpHead(${Qref}, __a)`), 1e-5, 'carga que da la bomba');
  cercano(s.arcRes[bm.id].P_hid, RHO * G * (Qref / 3600) * R(`pumpHead(${Qref}, __a)`) / 1000, 1e-4, 'potencia hidráulica [kW]');
});
prueba('dos bombas iguales en paralelo (nPumps=2) entregan el doble de caudal a igual carga', () => {
  const mk = n => red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:0}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    const bm=mkArc('pump',A.id,J.id,{nPumps:${n}, pumpCurve:[{Q:0,H:40},{Q:100,H:36},{Q:200,H:28},{Q:300,H:15},{Q:400,H:0}]}), p=mkArc('pipe',J.id,B.id,{D_mm:300,L_m:20});
    return {nodes:[A,J,B],arcs:[bm,p],fluid:fl};`);
  const r1 = mk(1), r2 = mk(2), s1 = resolver(r1), s2 = resolver(r2);
  cierto(s1.ok && s2.ok); cierto(s2.arcRes[r2.arcs[0].id].Q > s1.arcRes[r1.arcs[0].id].Q * 1.2, 'más caudal con dos bombas');
  ctx.__a = r2.arcs[0];
  cercano(s2.arcRes[r2.arcs[0].id].hf, R(`pumpHead(${s2.arcRes[r2.arcs[0].id].Q / 2}, __a)`), 1e-5, 'cada bomba trabaja con la mitad del caudal');
});
prueba('bomba de caudal fijo: la carga que aporta es el desnivel más las pérdidas', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:0}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:12});
    const bm=mkArc('pump',A.id,J.id,{pumpMode:'fixedQ', fixedQ_m3h:60}), p=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:150});
    return {nodes:[A,J,B],arcs:[bm,p],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  cercano(s.arcRes[r.arcs[0].id].Q, 60, 1e-9); cercano(s.arcRes[r.arcs[0].id].hf, 12 + hfRef(60, 100, 150, 0.046, 0, NU), 1e-5);
});
prueba('bomba de presión fija: la carga a la descarga es la pedida y el caudal sale de la tubería', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:0}), J=mkNode('junction',0,0,{label:'J',cota:2}), B=mkNode('tank',0,0,{label:'B',cota:10});
    const bm=mkArc('pump',A.id,J.id,{pumpMode:'fixedP', fixedP_bar:3}), p=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:150});
    return {nodes:[A,J,B],arcs:[bm,p],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  const HJ = 2 + 3 * 1e5 / (RHO * G);
  cercano(s.nodeRes[r.nodes[1].id].H, HJ, 1e-6, 'carga en la descarga');
  cercano(hfRef(s.arcRes[r.arcs[1].id].Q, 100, 150, 0.046, 0, NU), HJ - 10, 1e-5, 'energía en la tubería');
});
prueba('tanque presurizado: la presión de trabajo suma carga (H = cota + P/ρg)', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:0,p_bar:2}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:0,p_bar:0});
    const p1=mkArc('pipe',A.id,J.id,{D_mm:100,L_m:50}), p2=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:50}); return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  cercano(s.nodeRes[r.nodes[0].id].H, 2 * 1e5 / (RHO * G), 1e-12); cercano(s.nodeRes[r.nodes[1].id].H, 1e5 / (RHO * G), 1e-6);
  cercano(s.nodeRes[r.nodes[1].id].P, 1, 1e-5, 'presión en el nodo medio [bar]');
});
prueba('equipo con pérdida fija (dp_bar): el caudal pasa y el salto de carga es el pedido', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:20}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:0});
    const e=mkArc('equip',A.id,J.id,{dp_bar:0.5}), p=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:50}); return {nodes:[A,J,B],arcs:[e,p],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  const Q = s.arcRes[r.arcs[1].id].Q; cierto(Q > 0); cercano(s.arcRes[r.arcs[0].id].Q, Q, 1e-6);
});
prueba('la viscosidad y la densidad del fluido se usan: más viscoso → menos caudal', () => {
  const caudal = nu => { const r = red(`const fl={rho:998.2,nu:${nu}}; const A=mkNode('tank',0,0,{label:'A',cota:10}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:0});
    const p1=mkArc('pipe',A.id,J.id,{D_mm:50,L_m:100}), p2=mkArc('pipe',J.id,B.id,{D_mm:50,L_m:100}); return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`); const s = resolver(r); cierto(s.ok, s.msg); return s.arcRes[r.arcs[0].id].Q; };
  const a = caudal(1e-6), b = caudal(1e-5), c = caudal(2e-5);
  cierto(a > b && b > c, a + ' > ' + b + ' > ' + c);
});
prueba('HALLAZGO conocido: un fluido muy viscoso (≈100 cSt) en régimen laminar no converge, y el solver lo dice', () => {
  // El Jacobiano usa la conductancia del régimen turbulento (Q/2ΔH); en laminar la pendiente real es Q/ΔH y Newton oscila. Se conserva el
  // comportamiento del original (ver README, «Hallazgos»). Si algún día se corrige, este test falla a propósito: actualizarlo.
  const r = red(`const fl={rho:998.2,nu:1e-4}; const A=mkNode('tank',0,0,{label:'A',cota:10}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:0});
    return {nodes:[A,J,B],arcs:[mkArc('pipe',A.id,J.id,{D_mm:50,L_m:100}), mkArc('pipe',J.id,B.id,{D_mm:50,L_m:100})],fluid:fl};`);
  const s = resolver(r, { tol: 1e-4, maxIter: 200 });
  igual(s.ok, false); cierto(/No convergió/.test(s.msg), s.msg);
});

seccion('Solver: entradas inválidas y casos límite');
prueba('red vacía, sin nodos libres o sin tanques: error claro, sin lanzar', () => {
  let s = resolver(red(`return {nodes:[], arcs:[], fluid:{rho:998.2, nu:${NU}}};`)); igual(s.ok, false); cierto(/Sin nodos libres/.test(s.msg), s.msg);
  s = resolver(red(`const A=mkNode('tank',0,0,{}), B=mkNode('tank',0,0,{}); return {nodes:[A,B], arcs:[mkArc('pipe',A.id,B.id,{})], fluid:{rho:998.2, nu:${NU}}};`)); igual(s.ok, false); cierto(/Sin nodos libres/.test(s.msg));
  s = resolver(red(`const J=mkNode('junction',0,0,{}); return {nodes:[J], arcs:[], fluid:{rho:998.2, nu:${NU}}};`)); igual(s.ok, false); cierto(/Sin reservorios/.test(s.msg), s.msg);
});
prueba('estructura o fluido mal formados: lanza con mensaje claro', () => {
  for (const x of ['undefined', 'null', '{}', '{nodes:[], arcs:[]}', '{nodes:{}, arcs:[], fluid:{rho:1,nu:1}}']) lanza(() => R(`solveNetwork(${x}, {})`), /solveNetwork/, x);
  for (const f of ['{rho:0, nu:1e-6}', '{rho:998, nu:0}', '{rho:NaN, nu:1e-6}', '{rho:998, nu:Infinity}', '{rho:-1, nu:1e-6}'])
    lanza(() => R(`solveNetwork({nodes:[], arcs:[], fluid:${f}}, {})`), /densidad|viscosidad/, f);
});
prueba('datos numéricos rotos (NaN, ±Infinity) se rechazan con un mensaje que nombra el campo (antes: «Convergió»)', () => {
  const base = campo => red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    const p1=mkArc('pipe',A.id,J.id,{label:'T1',D_mm:100,L_m:100}), p2=mkArc('pipe',J.id,B.id,{label:'T2',D_mm:100,L_m:100}); ${campo}; return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`);
  const casos = [['p1.D_mm = NaN', /D_mm del arco «T1»/], ['p2.L_m = Infinity', /L_m del arco «T2»/], ['p1.eps_mm = NaN', /eps_mm/], ['p1.customK = -Infinity', /customK/], ['p1.fitQty[3] = NaN', /fitQty/],
    ['p1.fitOpen[5] = Infinity', /fitOpen/], ['A.cota = NaN', /cota del nodo «A»/], ['J.demand = NaN', /demand del nodo «J»/], ['B.p_bar = Infinity', /p_bar/], ['p1.D_mm = "abc"', /D_mm/]];
  for (const [codigo, patron] of casos) { const s = resolver(base(codigo)); igual(s.ok, false, codigo); cierto(patron.test(s.msg), codigo + ' → ' + s.msg); }
  const bomba = pc => red(`${FL} const A=mkNode('tank',0,0,{label:'A'}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:5});
    const bm=mkArc('pump',A.id,J.id,{label:'BM'}); ${pc}; return {nodes:[A,J,B],arcs:[bm,mkArc('pipe',J.id,B.id,{})],fluid:fl};`);
  for (const pc of ['bm.pumpCurve[1].H = NaN', 'bm.pumpCurve[0] = null', 'bm.pumpCurve[2] = {Q: 10}', 'bm.powerCurve = [{Q:0,P:NaN}]']) {
    const s = resolver(bomba(pc)); igual(s.ok, false, pc); cierto(/bomba «BM»/.test(s.msg), pc + ' → ' + s.msg);
  }
});
prueba('datos válidos con valores como texto numérico no se rechazan (se coaccionan igual que antes)', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    const p1=mkArc('pipe',A.id,J.id,{D_mm:'100',L_m:'100'}), p2=mkArc('pipe',J.id,B.id,{D_mm:100,L_m:100}); return {nodes:[A,J,B],arcs:[p1,p2],fluid:fl};`);
  cierto(resolver(r).ok);
});
prueba('tolerancia e iteraciones: valor no numérico o cero cae al valor por defecto', () => {
  const r = () => red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    return {nodes:[A,J,B],arcs:[mkArc('pipe',A.id,J.id,{}), mkArc('pipe',J.id,B.id,{})],fluid:fl};`);
  for (const opc of [{ tol: 'abc', maxIter: 'x' }, { tol: '', maxIter: '' }, { tol: 0, maxIter: 0 }, undefined, {}]) cierto(resolver(r(), opc || undefined).ok || opc === undefined, JSON.stringify(opc));
  cierto(resolver(r(), { tol: '1e-6', maxIter: '50' }).ok, 'textos numéricos válidos');
});
prueba('sin convergencia: devuelve ok=false con el residuo y no deja números sin sentido en la red', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J',demand:1e6}), B=mkNode('tank',0,0,{label:'B',cota:10});
    return {nodes:[A,J,B],arcs:[mkArc('pipe',A.id,J.id,{D_mm:25,L_m:5000}), mkArc('pipe',J.id,B.id,{D_mm:25,L_m:5000})],fluid:fl};`);
  const s = resolver(r, { tol: 1e-9, maxIter: 30 });
  igual(s.ok, false); cierto(/No convergió|singular/.test(s.msg), s.msg);
});
prueba('válvula cerrada que aísla un nodo libre: no hay resultados falsos (sistema singular o sin convergencia)', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    const v=mkArc('valve',A.id,J.id,{valveType:'gate', open_pct:0}), p=mkArc('pipe',J.id,B.id,{}); return {nodes:[A,J,B],arcs:[v,p],fluid:fl};`);
  const s = resolver(r);
  if (s.ok) igual(s.arcRes[r.arcs[0].id].Q, 0, 'si resuelve, el tramo cerrado no pasa caudal');
  else cierto(/singular|No convergió/.test(s.msg), s.msg);
});

prueba('HALLAZGO conocido: una válvula de retención (elemento «valve») contra la corriente se bloquea al resolver pero informa un caudal inverso', () => {
  // En el cálculo la retención no deja pasar flujo inverso (Q=0), pero al armar los resultados solo el tipo «check» antiguo se recorta a cero.
  // Se conserva el comportamiento del original (ver README, «Hallazgos»). Si algún día se corrige, este test falla a propósito: actualizarlo.
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:50});
    const p=mkArc('pipe',A.id,J.id,{D_mm:100,L_m:50}), v=mkArc('valve',J.id,B.id,{valveType:'check', D_mm:100}); return {nodes:[A,J,B],arcs:[p,v],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg);
  cercano(s.arcRes[r.arcs[0].id].Q, 0, 1, 'la tubería no mueve agua', 1e-6);
  cierto(s.arcRes[r.arcs[1].id].Q < -1, 'la válvula informa un caudal inverso de ' + s.arcRes[r.arcs[1].id].Q + ' m³/h');
  const t = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:50});
    const p=mkArc('pipe',A.id,J.id,{D_mm:100,L_m:50}), v=mkArc('check',J.id,B.id,{D_mm:100}); return {nodes:[A,J,B],arcs:[p,v],fluid:fl};`);
  const u = resolver(t); cierto(u.ok, u.msg); igual(u.arcRes[t.arcs[1].id].Q, 0, 'el tipo «check» antiguo sí informa cero');
});

seccion('Resultados sobre el modelo');
prueba('aplicarResultados() copia lo calculado; limpiarResultados() lo borra por completo', () => {
  const r = red(`${FL} const A=mkNode('tank',0,0,{label:'A',cota:30}), J=mkNode('junction',0,0,{label:'J'}), B=mkNode('tank',0,0,{label:'B',cota:10});
    return {nodes:[A,J,B],arcs:[mkArc('pipe',A.id,J.id,{}), mkArc('pipe',J.id,B.id,{})],fluid:fl};`);
  const s = resolver(r); cierto(s.ok); ctx.__s = s; R('aplicarResultados(__r.nodes, __r.arcs, __s)');
  cierto(r.nodes.every(n => Number.isFinite(n.H) && Number.isFinite(n.P))); cierto(r.arcs.every(a => Number.isFinite(a.Q) && Number.isFinite(a.V) && Number.isFinite(a.hf) && typeof a.regime === 'string'));
  R('limpiarResultados(__r.nodes, __r.arcs)');
  cierto(r.nodes.every(n => n.H === null && n.P === null)); cierto(r.arcs.every(a => a.Q === null && a.V === null && a.Re === null && a.f === null && a.hf === null && a.regime === null && a.P_hid === null && a.P_eje === null));
});
prueba('advertenciasRolTanque(): avisa solo cuando el sentido del flujo contradice el rol declarado', () => {
  const t = (rol, Q) => { ctx.__n = [R(`({id:1, type:'tank', label:'TQ', role:${JSON.stringify(rol)}})`)]; ctx.__x = [R(`({id:9, fromId:2, toId:1, Q:${Q}})`)]; return R('advertenciasRolTanque(__n, __x)'); };
  igual(t('sink', 50).length, 0); igual(t('source', -50).length, 0); igual(t(null, 50).length, 0); igual(t('', -50).length, 0);
  igual(t('sink', -50).length, 1); igual(t('source', 50).length, 1); igual(t('sink', -0.005).length, 0, 'bajo el umbral de 0,01 m³/h');
  cierto(/TQ.*RECIBE.*entrega 50\.0/.test(t('sink', -50)[0]), t('sink', -50)[0]);
});

seccion('Curva del sistema');
prueba('la curva del sistema pasa por el punto de operación que calcula el solver (dos caminos de cálculo distintos)', () => {
  const r = red(`${FL} const Ts=mkNode('tank',0,0,{label:'TS',cota:0,p_bar:0.5}), J1=mkNode('junction',0,0,{label:'J1'}), J2=mkNode('junction',0,0,{label:'J2',cota:5}), J3=mkNode('junction',0,0,{label:'J3',cota:2}), Te=mkNode('tank',0,0,{label:'TD',cota:5});
    const bm=mkArc('pump',Ts.id,J1.id,{pumpCurve:[{Q:0,H:30},{Q:50,H:28},{Q:100,H:24},{Q:150,H:18},{Q:200,H:10},{Q:220,H:0}]});
    return {nodes:[Ts,J1,J2,J3,Te],arcs:[bm, mkArc('pipe',J1.id,J2.id,{D_mm:150,L_m:120}), mkArc('pipe',J1.id,J3.id,{D_mm:100,L_m:80}), mkArc('pipe',J2.id,Te.id,{D_mm:150,L_m:30}), mkArc('pipe',J3.id,Te.id,{D_mm:100,L_m:30})],fluid:fl};`);
  const s = resolver(r); cierto(s.ok, s.msg); ctx.__s = s; R('aplicarResultados(__r.nodes, __r.arcs, __s)');
  const bm = r.arcs[0], Qop = s.arcRes[bm.id].Q; ctx.__a = bm;
  const h = R(`systemHeadAt(__r, __a, ${Qop}, null)`);
  cercano(h.H, s.arcRes[bm.id].hf, 3e-3, 'carga que exige la red en Qop = carga que da la bomba');   // cada camino tiene su propia tolerancia: coinciden a ~0,1 %
  const curva = R('computeSystemCurve(__r, __a)');
  cierto(curva.length >= 10, 'puntos de la curva'); cierto(curva.every(p => Number.isFinite(p.Q)), 'caudales finitos');
  const buenos = curva.filter(p => Number.isFinite(p.H)); for (let i = 1; i < buenos.length; i++) cierto(buenos[i].H >= buenos[i - 1].H - 1e-6, 'la carga exigida crece con el caudal');
});
prueba('systemHeadAt(): sin nodos libres o sin tanques devuelve H nulo', () => {
  const r = red(`const A=mkNode('tank',0,0,{}), B=mkNode('tank',0,0,{}); const bm=mkArc('pump',A.id,B.id,{}); return {nodes:[A,B],arcs:[bm],fluid:{rho:998.2,nu:${NU}}};`); ctx.__a = r.arcs[0];
  igual(R('systemHeadAt(__r, __a, 50, null)').H, null);
});

seccion('Validación de archivos importados (modelo)');
prueba('sanitizeNode(): datos válidos pasan y los tipos se normalizan', () => {
  const n = R(`sanitizeNode({id: 3, type: 'tank', label: 7, cota: '12,5x', demand: null, p_bar: '2', x: '10', y: 5})`);
  igual(n.id, 3); igual(n.label, '7'); igual(n.cota, 0, 'texto no numérico → 0'); igual(n.demand, 0); igual(n.p_bar, 2); igual(n.x, 10); igual(n.y, 5);
});
prueba('sanitizeNode(): ids, tipos y estructura hostiles se rechazan con un error claro', () => {
  for (const x of ['null', '[]', '"texto"', '5', "{id:'1', type:'tank'}", '{id:1.5, type:"tank"}', "{id:'1);alert(1)//', type:'tank'}", "{id:1, type:'x\"><img src=x onerror=alert(1)>'}", '{id:1}', '{id:1, type:"reservoir"}'])
    lanza(() => R(`sanitizeNode(${x})`), /nodo/, x);
});
prueba('sanitizeArc(): normaliza números, longitudes de arreglos, curvas y rangos', () => {
  const a = R(`sanitizeArc({id:1, fromId:2, toId:3, type:'pump', label:{x:1}, D_mm:'-5', L_m:'abc', eps_mm:'0,5', fitQty:[1], fitOpen:'no', pumpCurve:[{Q:'0',H:'30'}, null, {Q:'x',H:5}], powerCurve:[{Q:1,P:'z'}], pumpMode:'raro', nPumps:'3', open_pct:150, regime:{a:1}})`);
  igual(a.label, '[object Object]'); igual(a.D_mm, 200); igual(a.L_m, 100); igual(a.eps_mm, 0.046, '«0,5» con coma no es un número de JSON válido → por defecto');
  igual(a.fitQty.length, 14); igual(a.fitOpen.length, 14); igual(a.fitOpen[0], 100); igual(a.pumpMode, 'curve'); igual(a.nPumps, 3); igual(a.regime, '[object Object]');
  igualJSON(a.pumpCurve, [{ Q: 0, H: 30 }, { Q: 0, H: 0 }, { Q: 0, H: 5 }]); igualJSON(a.powerCurve, [{ Q: 1, P: 0 }]);
  igual(R(`sanitizeArc({id:1, fromId:2, toId:3, type:'valve', open_pct:150}).open_pct`), 100); igual(R(`sanitizeArc({id:1, fromId:2, toId:3, type:'valve', open_pct:-4}).open_pct`), 0);
  igual(R(`sanitizeArc({id:1, fromId:2, toId:3, type:'valve', open_pct:'abc'}).open_pct`), 100);
  igual(R(`sanitizeArc({id:1, fromId:2, toId:3, type:'pump'}).pumpCurve.length`), 2, 'bomba sin curva: curva por defecto');
});
prueba('sanitizeArc(): ids, tipos y estructura hostiles se rechazan', () => {
  for (const x of ['null', '[]', "{id:1, fromId:2, toId:'3', type:'pipe'}", "{id:1, fromId:2, toId:3, type:'pipe\"onclick=\"x'}", "{id:'a', fromId:2, toId:3, type:'pipe'}", '{id:1, fromId:2, toId:3}', '{id:1, fromId:NaN, toId:3, type:"pipe"}'])
    lanza(() => R(`sanitizeArc(${x})`), /arco/, x);
});
prueba('sanitizeArc(): una clave __proto__ del archivo no contamina los prototipos', () => {
  const a = R(`sanitizeArc(JSON.parse('{"id":1,"fromId":2,"toId":3,"type":"pipe","__proto__":{"contaminado":true},"constructor":{"prototype":{"contaminado":true}}}'))`);
  ctx.__a = a; igual(R('({}).contaminado'), undefined); igual(a.contaminado, undefined); igual(R('Object.getPrototypeOf(__a) === Object.prototype'), true, 'el prototipo sigue siendo Object.prototype');
});

prueba('validarModelo(): ids repetidos entre nodos y arcos, y arcos unidos a nodos inexistentes, se rechazan', () => {
  const ok = (n, a) => { ctx.__n = R(`(${n})`); ctx.__x = R(`(${a})`); R('validarModelo(__n, __x)'); };
  const N = "[{id:1,type:'tank'},{id:2,type:'junction'}]";
  ok(N, "[{id:3,fromId:1,toId:2,label:'A'}]");
  lanza(() => ok("[{id:1},{id:1}]", '[]'), /repite el id 1/, 'dos nodos con el mismo id');
  lanza(() => ok(N, "[{id:2,fromId:1,toId:2,label:'A'}]"), /repite el id 2/, 'un arco con el id de un nodo');
  lanza(() => ok(N, "[{id:3,fromId:1,toId:9,label:'T7'}]"), /«T7».*no existe/, 'arco hacia un nodo que no existe');
  lanza(() => ok(N, "[{id:3,fromId:1,toId:2,label:'A'},{id:3,fromId:2,toId:1,label:'B'}]"), /repite el id 3/, 'dos arcos con el mismo id');
});

seccion('Propiedad general: redes aleatorias que convergen cumplen continuidad y finitud');
prueba('40 redes aleatorias (semilla fija): balance de masa en cada nodo libre y ningún número no finito en los resultados', () => {
  let resueltas = 0, probadas = 0, peorBalance = 0;
  for (let semilla = 1; semilla <= 40; semilla++) {
    const caso = generar(semilla * 7919);
    const fluido = caso.fluid.type === 'water' ? R(`getWaterProps(${caso.fluid.temp})`) : [caso.fluid.rho, caso.fluid.nu];
    ctx.__r = R('JSON.parse(' + JSON.stringify(JSON.stringify({ nodes: caso.nodes, arcs: caso.arcs, fluid: { rho: fluido[0], nu: fluido[1] } })) + ')');
    ctx.__o = { tol: 1e-6, maxIter: 80 };
    let s; try { s = evaluar(ctx, 'solveNetwork(__r, __o)', 1500); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') continue; throw e; }
    probadas++;
    if (!s.ok) continue;
    resueltas++;
    for (const n of ctx.__r.nodes) {
      cierto(Number.isFinite(s.nodeRes[n.id].H) && Number.isFinite(s.nodeRes[n.id].P), 'H/P no finito en el nodo ' + n.label + ' (semilla ' + semilla + ')');
      if (n.type !== 'junction') continue;
      let neto = -n.demand;
      for (const a of ctx.__r.arcs) {
        let q = s.arcRes[a.id].Q;
        if (a.type === 'valve' && a.valveType === 'check') q = Math.max(q, 0);   // hallazgo conocido (arriba): el solver bloquea el flujo inverso pero lo informa; se cuenta como lo resolvió
        if (a.toId === n.id) neto += q; if (a.fromId === n.id) neto -= q;
      }
      peorBalance = Math.max(peorBalance, Math.abs(neto)); cierto(Math.abs(neto) < 0.05, 'balance de masa ' + neto + ' m³/h en ' + n.label + ' (semilla ' + semilla + ')');
    }
    for (const a of ctx.__r.arcs) { const r = s.arcRes[a.id]; cierto(Number.isFinite(r.Q) && Number.isFinite(r.V) && Number.isFinite(r.hf), 'resultado no finito en el arco ' + a.label + ' (semilla ' + semilla + ')'); }
  }
  cierto(resueltas >= 5, 'se esperaban al menos 5 redes resueltas y hubo ' + resueltas + ' de ' + probadas);
  console.log('      (' + resueltas + ' de ' + probadas + ' redes resueltas · peor desbalance ' + peorBalance.toExponential(2) + ' m³/h)');
});

correr('Pruebas del motor de cálculo').then(ok => process.exit(ok ? 0 : 1));
