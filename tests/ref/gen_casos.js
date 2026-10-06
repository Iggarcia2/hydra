// tests/ref/gen_casos.js
'use strict';
/* Genera redes (a mano y pseudoaleatorias con semilla fija) y las resuelve con el motor JS; guarda red + resultado en casos.json
   para que ref.py las resuelva con una implementación independiente (Python + scipy) y compare. */
const fs = require('fs'), path = require('path');
const { crear, evaluar } = require('../lib/cargar.js');
const { prng } = require('../lib/generador.js');

const ctx = crear(['nucleo', 'js/estado.js']);
const R = c => evaluar(ctx, c);
const rnd = prng(20261001);
const u = (a, b) => a + (b - a) * rnd();
const ent = (a, b) => Math.floor(u(a, b + 1));
const elegir = l => l[ent(0, l.length - 1)];
const red2 = x => +x.toFixed(2);

const AGUA = T => R(`getWaterProps(${T})`);
const casos = [];
function agregar(nombre, codigo, fluido) {
  // `codigo` arma {nodes, arcs} dentro del contexto del motor con las mismas fábricas que usa la aplicación (mkNode/mkArc)
  const r = R('(() => {' + codigo + '})()');
  const fl = { rho: fluido[0], nu: fluido[1] };
  ctx.__r = { nodes: r.nodes, arcs: r.arcs, fluid: fl }; ctx.__o = { tol: 1e-10, maxIter: 300 };
  let s; try { s = evaluar(ctx, 'solveNetwork(__r, __o)', 4000); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return; throw e; }
  if (!s.ok) { casos.push({ nombre, omitido: s.msg }); return; }
  const red = JSON.parse(JSON.stringify({ nodes: r.nodes, arcs: r.arcs, fluid: fl }));
  const H = {}, Q = {}, Re = {};
  for (const n of r.nodes) H[n.id] = s.nodeRes[n.id].H;
  for (const a of r.arcs) { Q[a.id] = s.arcRes[a.id].Q; Re[a.id] = s.arcRes[a.id].Re; }
  casos.push({ nombre, red, js: { H, Q, Re } });
}

// ── Casos a mano ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const AG20 = AGUA(20);
agregar('serie de dos tuberías', `const A=mkNode('tank',0,0,{cota:30}), J=mkNode('junction',0,0,{}), B=mkNode('tank',0,0,{cota:10});
  return {nodes:[A,J,B], arcs:[mkArc('pipe',A.id,J.id,{D_mm:150,L_m:200}), mkArc('pipe',J.id,B.id,{D_mm:100,L_m:80})]};`, AG20);
agregar('red de ejemplo de la aplicación (bomba, ramas en paralelo)', `const Ts=mkNode('tank',0,0,{cota:0,p_bar:0.5}), J1=mkNode('junction',0,0,{}), J2=mkNode('junction',0,0,{cota:5}), J3=mkNode('junction',0,0,{cota:2}), Te=mkNode('tank',0,0,{cota:5});
  const bm=mkArc('pump',Ts.id,J1.id,{pumpCurve:[{Q:0,H:30},{Q:50,H:28},{Q:100,H:24},{Q:150,H:18},{Q:200,H:10},{Q:220,H:0}]});
  return {nodes:[Ts,J1,J2,J3,Te], arcs:[bm, mkArc('pipe',J1.id,J2.id,{D_mm:150,L_m:120}), mkArc('pipe',J1.id,J3.id,{D_mm:100,L_m:80}), mkArc('pipe',J2.id,Te.id,{D_mm:150,L_m:30}), mkArc('pipe',J3.id,Te.id,{D_mm:100,L_m:30})]};`, AG20);
agregar('bomba de caudal fijo con accesorios y válvula de globo al 60 %', `const A=mkNode('tank',0,0,{cota:2}), J=mkNode('junction',0,0,{cota:4}), K=mkNode('junction',0,0,{demand:20}), B=mkNode('tank',0,0,{cota:25,p_bar:0.3});
  const bm=mkArc('pump',A.id,J.id,{pumpMode:'fixedQ',fixedQ_m3h:90});
  const t1=mkArc('pipe',J.id,K.id,{D_mm:100,L_m:150,fitQty:[4,0,0,1,0,0,0,0,1,0,0,0,0,0], fitOpen:[100,100,100,100,100,100,100,100,60,100,100,100,100,100]});
  return {nodes:[A,J,K,B], arcs:[bm,t1,mkArc('pipe',K.id,B.id,{D_mm:80,L_m:60,customK:2.5})]};`, AG20);
agregar('bomba de presión fija', `const A=mkNode('tank',0,0,{cota:0}), J=mkNode('junction',0,0,{cota:3}), K=mkNode('junction',0,0,{demand:15,cota:8}), B=mkNode('tank',0,0,{cota:12});
  return {nodes:[A,J,K,B], arcs:[mkArc('pump',A.id,J.id,{pumpMode:'fixedP',fixedP_bar:4}), mkArc('pipe',J.id,K.id,{D_mm:100,L_m:90}), mkArc('pipe',K.id,B.id,{D_mm:100,L_m:70})]};`, AG20);
agregar('dos bombas en paralelo, válvula mariposa y fluido personalizado (aceite)', `const A=mkNode('tank',0,0,{cota:0}), J=mkNode('junction',0,0,{}), B=mkNode('tank',0,0,{cota:18});
  const bm=mkArc('pump',A.id,J.id,{nPumps:2,pumpCurve:[{Q:0,H:45},{Q:80,H:41},{Q:160,H:32},{Q:240,H:18},{Q:300,H:2}]});
  const v=mkArc('valve',J.id,B.id,{valveType:'butterfly',open_pct:70,D_mm:150});
  return {nodes:[A,J,B], arcs:[bm,v]};`, [870, 8e-6]);
agregar('equipo con pérdida fija entre tanques', `const A=mkNode('tank',0,0,{cota:30}), J=mkNode('junction',0,0,{}), B=mkNode('tank',0,0,{cota:0});
  return {nodes:[A,J,B], arcs:[mkArc('equip',A.id,J.id,{dp_bar:1.2,D_mm:80}), mkArc('pipe',J.id,B.id,{D_mm:100,L_m:120})]};`, AG20);
agregar('anillo con dos tanques y demandas', `const A=mkNode('tank',0,0,{cota:40}), B=mkNode('tank',0,0,{cota:25}), J1=mkNode('junction',0,0,{demand:30}), J2=mkNode('junction',0,0,{demand:20}), J3=mkNode('junction',0,0,{demand:10});
  return {nodes:[A,B,J1,J2,J3], arcs:[mkArc('pipe',A.id,J1.id,{D_mm:200,L_m:300}), mkArc('pipe',J1.id,J2.id,{D_mm:150,L_m:250}), mkArc('pipe',J2.id,B.id,{D_mm:150,L_m:200}), mkArc('pipe',J2.id,J3.id,{D_mm:100,L_m:180}), mkArc('pipe',J3.id,J1.id,{D_mm:100,L_m:220})]};`, AGUA(45));
agregar('retención en el sentido del flujo', `const A=mkNode('tank',0,0,{cota:20}), J=mkNode('junction',0,0,{}), B=mkNode('tank',0,0,{cota:2});
  return {nodes:[A,J,B], arcs:[mkArc('check',A.id,J.id,{D_mm:100,L_m:40}), mkArc('pipe',J.id,B.id,{D_mm:100,L_m:60})]};`, AG20);

// ── Pseudoaleatorias: cadenas y árboles con distintos materiales, accesorios, válvulas, bombas y fluidos ──────────────────────
const DN = [52.5, 77.9, 102.3, 128.2, 154.1, 202.7, 254.5], EPS = [0.015, 0.046, 0.15, 0.0015, 0.26];
for (let i = 1; i <= 60; i++) {
  const nJ = ent(1, 6), tipoBomba = elegir(['curve', 'curve', 'fixedQ', 'fixedP', null]);
  const fl = rnd() < 0.75 ? AGUA(ent(5, 90)) : [red2(u(750, 1300)), red2(u(0.8, 12)) * 1e-6];
  let codigo = `const A=mkNode('tank',0,0,{cota:${red2(u(0, 15))},p_bar:${red2(u(0, 1))}}); const nodes=[A]; const arcs=[]; const B=mkNode('tank',0,0,{cota:${red2(u(10, 45))},p_bar:${red2(u(0, 1.5))}});`;
  let previo = 'A';
  for (let k = 1; k <= nJ; k++) {
    codigo += `const J${k}=mkNode('junction',0,0,{cota:${red2(u(0, 20))},demand:${rnd() < 0.5 ? 0 : red2(u(2, 25))}}); nodes.push(J${k});`;
    const t = (k === 1 && tipoBomba) ? 'pump' : elegir(['pipe', 'pipe', 'pipe', 'valve', 'check']);
    const D = elegir(DN), L = red2(u(10, 300)), eps = elegir(EPS);
    const fit = '[' + Array.from({ length: 14 }, () => rnd() < 0.2 ? ent(1, 3) : 0).join(',') + ']';
    if (t === 'pump') {
      const H0 = red2(u(30, 70)), Qm = ent(150, 450);
      codigo += `arcs.push(mkArc('pump',${previo}.id,J${k}.id,{pumpMode:'${tipoBomba}',fixedQ_m3h:${red2(u(15, 80))},fixedP_bar:${red2(u(2, 6))},nPumps:${elegir([1, 1, 2])},pumpCurve:[{Q:0,H:${H0}},{Q:${Qm * 0.35},H:${red2(H0 * 0.93)}},{Q:${Qm * 0.7},H:${red2(H0 * 0.7)}},{Q:${Qm},H:${red2(H0 * 0.1)}}]}));`;
    } else if (t === 'valve') {
      codigo += `arcs.push(mkArc('valve',${previo}.id,J${k}.id,{D_mm:${D},valveType:'${elegir(['gate', 'ball', 'butterfly', 'globe', 'check'])}',open_pct:${elegir([100, 100, 80, 60, 40])},fitQty:${fit},customK:${rnd() < 0.3 ? red2(u(0.5, 4)) : 0}}));`;
    } else {
      codigo += `arcs.push(mkArc('${t}',${previo}.id,J${k}.id,{D_mm:${D},L_m:${L},eps_mm:${eps},fitQty:${fit},fitOpen:[${Array.from({ length: 14 }, () => elegir([100, 100, 75, 50])).join(',')}],fouling_mm:${rnd() < 0.2 ? red2(u(0.05, 0.4)) : 0},customK:${rnd() < 0.2 ? red2(u(0.5, 3)) : 0}}));`;
    }
    previo = 'J' + k;
  }
  codigo += `arcs.push(mkArc('pipe',${previo}.id,B.id,{D_mm:${elegir(DN)},L_m:${red2(u(10, 200))},eps_mm:${elegir(EPS)}})); nodes.push(B);`;
  if (nJ >= 2 && rnd() < 0.5) codigo += `arcs.push(mkArc('pipe',J1.id,J${nJ}.id,{D_mm:${elegir(DN)},L_m:${red2(u(40, 300))},eps_mm:0.046}));`;   // lazo extra
  codigo += 'return {nodes, arcs};';
  agregar('aleatoria ' + i, codigo, fl);
}

const buenas = casos.filter(c => c.js).length;
fs.writeFileSync(path.join(__dirname, 'casos.json'), JSON.stringify(casos));
console.log('casos: ' + casos.length + ' (' + buenas + ' resueltos por el motor; ' + (casos.length - buenas) + ' sin convergencia, no se comparan)');
if (buenas < 20) { console.error('Muy pocos casos resueltos: la verificación no demostraría nada'); process.exit(1); }
