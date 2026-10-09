// js/nucleo/curva_sistema.js
'use strict';
/* Curva del sistema por bomba: resuelve la red a caudal fijo y barre caudales con paso adaptativo. */

// ══════════════════════════════════════════════════════════════════════════════
// [v14] CURVA DEL SISTEMA — para la memoria de cálculo en PDF
// ══════════════════════════════════════════════════════════════════════════════
// Dado un caudal fijo en una bomba, resuelve el resto de la red (sin la ecuación propia
// de esa bomba) y devuelve la carga H que la red exige entre sus dos nodos para mover ese
// caudal. Reutiliza pipeCalc/gaussSolve — no toca solveNetwork().
// x0 (opcional) es una semilla de cabezas para continuar desde el punto anterior del barrido.
// [repo] red = {nodes, arcs, fluid:{rho, nu}} (antes leía state y fluid globales)
// [v26] Tolerancia relativa de la curva del sistema (antes: |F| < 1e-4 m³/s absoluto, que en redes de caudal chico dejaba pasar errores de 10–20 %).
const TOL_CURVA = 1e-6;
// [v26] Nodos libres con al menos un arco. Un nodo suelto (recién agregado, sin conectar) no interviene en el equilibrio y dejaba una fila nula
// en el Jacobiano: con la tolerancia absoluta de v25 el barrido arrancaba ya «convergido» en el punto de operación y no se notaba, con la relativa sí.
function nodosLibresConectados(red) {
  const usados = new Set();
  for (const a of red.arcs) { usados.add(a.fromId); usados.add(a.toId); }
  return red.nodes.filter(n => n.type==='junction' && usados.has(n.id));
}
function systemHeadAt(red, pumpArc, Qm3h, x0) {
  const nodes = red.nodes, arcs = red.arcs, fluid = red.fluid;
  const fixedNodes  = nodes.filter(n=>n.type==='tank');
  const freeNodes   = nodosLibresConectados(red);
  const nonPumpArcs = arcs.filter(a=>a.type!=='pump');
  const otherPumps  = arcs.filter(a=>a.type==='pump' && a.id!==pumpArc.id);
  if (!freeNodes.length || !fixedNodes.length) return {H:null, x:null};

  const freeIdx = {}; freeNodes.forEach((n,i)=>{ freeIdx[n.id]=i; });
  const NF = freeNodes.length;
  const Hfixed = {};
  fixedNodes.forEach(n=>{ Hfixed[n.id] = n.cota+(n.p_bar??0)*1e5/(fluid.rho*G); });
  const getH2 = (nId, xv) => Hfixed[nId] !== undefined ? Hfixed[nId] : xv[freeIdx[nId]];
  const avgFixed = fixedNodes.reduce((s,n)=>s+Hfixed[n.id],0)/fixedNodes.length;

  let x;
  if (x0 && x0.length===NF) {
    x = x0.slice();
  } else {
    // BFS desde nodos fijos (mismo criterio que solveNetwork): evita dH=0 en TODOS los
    // arcos libre-libre en la iteración 0, lo que dejaría filas nulas en el Jacobiano
    // (matriz singular) cuando dos nodos vecinos arrancan con la misma cabeza.
    const initH = {};
    fixedNodes.forEach(n=>{ initH[n.id] = Hfixed[n.id]; });
    const adj = {};
    nodes.forEach(n=>{ adj[n.id]=[]; });
    arcs.forEach(a=>{ adj[a.fromId]?.push(a.toId); adj[a.toId]?.push(a.fromId); });
    let queue = fixedNodes.map(n=>n.id);
    const visited = new Set(queue);
    while (queue.length) {
      const next = [];
      for (const id of queue) {
        for (const nb of (adj[id]||[])) {
          if (!visited.has(nb)) {
            visited.add(nb);
            initH[nb] = initH[id] - 0.5;
            next.push(nb);
          }
        }
      }
      queue = next;
    }
    x = freeNodes.map(n => initH[n.id] ?? avgFixed);
  }
  const Qfixed_ms = Qm3h/3600;
  const otherPumpQ = {}; otherPumps.forEach(p=>{ otherPumpQ[p.id] = p.Q!=null ? p.Q/3600 : 0; });

  function buildF(xv) {
    const F = new Array(NF).fill(0);
    const J = Array.from({length:NF}, () => new Array(NF).fill(0));
    const circ = new Array(NF).fill(0);   // [v26] caudal que circula por cada nodo (m³/s), para el criterio de convergencia relativo
    for (let i=0; i<NF; i++) {
      const node = freeNodes[i];
      const Hi = xv[i];
      F[i] = -node.demand/3600;
      circ[i] = Math.abs(node.demand)/3600;
      for (const arc of nonPumpArcs) {
        let dH=0, fromIdx=-1, toIdx=-1, connected=false;
        if (arc.fromId===node.id) { const Hj=getH2(arc.toId,xv); dH=Hi-Hj; connected=true; toIdx=freeIdx[arc.toId]; }
        else if (arc.toId===node.id) { const Hj=getH2(arc.fromId,xv); dH=Hj-Hi; connected=true; fromIdx=freeIdx[arc.fromId]; }
        if (!connected) continue;
        let Q_ms=0, cond=0;
        if (arc.type==='pipe' || arc.type==='check' || arc.type==='valve') {
          ({Q_ms, cond} = caudalTramo(arc, dH, fluid));   // [v26] misma regla que solveNetwork (retención, prv = tubería abierta)
        } else if (arc.type==='equip') {
          const dpH = Math.max(arc.dp_bar*1e5/(fluid.rho*G), 1e-6);
          const effDH = dH - dpH;
          const _D=(arc.D_mm||200)/1000, _A=Math.PI*_D*_D/4, Q_REF=_A*2.0;
          Q_ms = effDH > 0 ? Q_REF*Math.sqrt(effDH/dpH) : 0;
          // [v20] Misma conductancia continua que en attemptSolve (ver comentario allá) — evita
          // el salto discontinuo que hacía oscilar el barrido de la curva del sistema cerca del
          // quiebre del modelo de Equipo, sin cambiar el residuo (Q_ms) ni el punto de equilibrio.
          const effDHforCond = Math.max(effDH, 0.02*dpH);
          cond = (Q_REF*Math.sqrt(effDHforCond/dpH)) / (2*effDHforCond);
        }
        circ[i] += Math.abs(Q_ms);
        if (arc.fromId===node.id) { F[i]-=Q_ms; J[i][i]-=cond; if (toIdx>=0&&toIdx<NF) J[i][toIdx]+=cond; }
        else                      { F[i]+=Q_ms; J[i][i]-=cond; if (fromIdx>=0&&fromIdx<NF) J[i][fromIdx]+=cond; }
      }
      // Bomba en análisis: caudal fijo (no es incógnita en este barrido)
      if (pumpArc.fromId===node.id) { F[i] -= Qfixed_ms; circ[i] += Math.abs(Qfixed_ms); }
      else if (pumpArc.toId===node.id) { F[i] += Qfixed_ms; circ[i] += Math.abs(Qfixed_ms); }
      // Otras bombas de la red (si hay): se fijan en su último caudal ya resuelto
      for (const p of otherPumps) {
        const Qp = otherPumpQ[p.id];
        if (p.fromId===node.id) { F[i] -= Qp; circ[i] += Math.abs(Qp); }
        else if (p.toId===node.id) { F[i] += Qp; circ[i] += Math.abs(Qp); }
      }
    }
    return {F, J, circ};
  }

  let converged = false;
  for (let iter=0; iter<100; iter++) {
    const {F, J, circ} = buildF(x);
    const res0 = Math.sqrt(F.reduce((s,v)=>s+v*v,0));
    if (errorContinuidad(F, circ, NF) < TOL_CURVA) { converged = true; break; }
    const dx = gaussSolve(J, F.map(v=>-v));
    if (!dx) return {H:null, x:null};
    const dmax = dx.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
    const lamBase = dmax>12 ? 12/dmax : 1.0;
    // [v20] Mismo retroceso de línea (line search) que en attemptSolve — sin esto, el barrido
    // de la curva del sistema podía quedar oscilando sin asentarse cerca del quiebre del
    // modelo de Equipo, dejando huecos en el gráfico. En el caso de siempre (paso completo ya
    // mejora el residuo) esto no cambia nada — se acepta en el primer intento, igual que antes.
    let xTry = x, resTry = res0, errTry = Infinity;
    for (let bt=0; bt<12; bt++) {
      const lam = lamBase * Math.pow(0.5, bt);
      const xCand = x.slice();
      for (let i=0; i<NF; i++) xCand[i] += lam*dx[i];
      const { F: Fcand, circ: circCand } = buildF(xCand);
      const resCand = Math.sqrt(Fcand.reduce((s,v)=>s+v*v,0));
      if (resCand < resTry || bt === 0) { xTry = xCand; resTry = resCand; errTry = errorContinuidad(Fcand, circCand, NF); }
      if (resCand <= LS_MEJORA*res0) break;
    }
    x = xTry;
    if (errTry < TOL_CURVA) { converged = true; break; }
  }
  if (!converged) return {H:null, x:null};

  const H = {};
  freeNodes.forEach((n,i)=>{ H[n.id]=x[i]; });
  fixedNodes.forEach(n=>{ H[n.id]=Hfixed[n.id]; });
  const Hfrom = H[pumpArc.fromId], Hto = H[pumpArc.toId];
  if (Hfrom===undefined || Hto===undefined) return {H:null, x:null};
  return { H: Hto - Hfrom, x };
}

// Traza la curva del sistema para una bomba, entre 0 y ~1.15x su caudal máximo de curva.
// [v15] Se ancla en el punto de operación YA resuelto por la red (cabezas reales, converge
// de manera trivial) y desde ahí avanza hacia ambos lados con PASO ADAPTATIVO (no un paso fijo):
// intenta el paso "nominal" (Qmax/nPts) y, si ese punto no converge, lo reduce a la mitad y
// reintenta desde el último punto bueno — recuperando el paso de a poco cuando vuelve a
// converger. Esto hizo falta porque una red real del usuario con válvulas bastante
// estranguladas (accesorio en ~46-47% de apertura) resultó muchísimo más rígida de lo que un
// paso fijo puede asumir: ahí el paso "seguro" era de apenas ~0.2 m³/h sobre un rango total de
// más de 150 m³/h — con paso fijo, ni anclando en el punto de operación se podía avanzar ni un
// solo paso. Con paso adaptativo se cubre igual el rango completo (se probó contra esa red real:
// antes 0 puntos usables, ahora 15 puntos parejos y monótonos, en bien menos de un segundo).
function computeSystemCurve(red, pumpArc, nPts=14) {
  // [v18] Esta función no necesita la curva de la bomba en ningún momento — solo necesita
  // saber dónde está esa bomba en la red: barre caudal por ahí y resuelve el resto. Antes se
  // cortaba en seco para 'fixedQ' porque su único uso era junto a la curva de bomba en el
  // gráfico; ahora se calcula siempre, para los tres modos (curva, caudal fijo, presión fija).
  const pMode = pumpArc.pumpMode || 'curve';
  const nP_ = pumpArc.nPumps||1;
  const Qanchor0 = pumpArc.Q!=null ? Math.abs(pumpArc.Q) : null;
  let Qmax;
  if (pMode === 'curve') {
    if (!pumpArc.pumpCurve || pumpArc.pumpCurve.length<2) return [];
    const pts = [...pumpArc.pumpCurve].sort((a,b)=>a.Q-b.Q);
    Qmax = Math.max(pts[pts.length-1].Q * nP_ * 1.15, 1);
  } else {
    // Sin curva de catálogo: se arma un rango de barrido alrededor del caudal ya resuelto (o
    // un valor de referencia razonable si todavía no se calculó nada en esta bomba).
    const ref = Qanchor0 ?? (pMode==='fixedQ' ? (pumpArc.fixedQ_m3h||100) : 100);
    Qmax = Math.max(ref * 1.8, 10);
  }
  const step0 = Qmax / nPts;

  const freeNodes = nodosLibresConectados(red);
  const Qanchor = Qanchor0;
  const anchorX0 = (Qanchor!=null && freeNodes.length && freeNodes.every(n=>n.H!=null))
    ? freeNodes.map(n=>n.H) : null;

  // Avanza desde (qFrom,xFrom) hasta qTarget probando el paso "nominal" step0; si un paso no
  // converge lo reduce a la mitad (hasta un piso) y reintenta desde el último punto bueno; si
  // vuelve a converger, recupera el paso de a poco. Devuelve todos los puntos intermedios que
  // convergieron (se resamplean parejos más abajo, no hace falta graficar cada micro-paso).
  function marchTo(qFrom, qTarget, xFrom) {
    const out = [];
    let x = xFrom, q = qFrom, step = step0;
    const dir = qTarget > qFrom ? 1 : (qTarget < qFrom ? -1 : 0);
    if (dir === 0 || !x) return out;
    const minStep = step0 / 4096;
    let guard = 0;
    while ((dir>0 && q < qTarget - 1e-9) || (dir<0 && q > qTarget + 1e-9)) {
      if (++guard > 5000) break; // resguardo: nunca debería hacer falta tantos pasos
      let qNext = q + dir*step;
      if ((dir>0 && qNext > qTarget) || (dir<0 && qNext < qTarget)) qNext = qTarget;
      const r = systemHeadAt(red, pumpArc, qNext, x);
      if (r.H !== null && Number.isFinite(r.H)) {
        q = qNext; x = r.x;
        out.push({Q:q, H:r.H});
        step = Math.min(step*1.6, step0);
      } else {
        step /= 2;
        if (step < minStep) break; // este tramo quedó fuera de alcance; no seguimos a ciegas
      }
    }
    return out;
  }

  let raw = [];
  let xAnchor = null;
  if (anchorX0) {
    const r0 = systemHeadAt(red, pumpArc, Qanchor, anchorX0);
    if (r0.H!==null && Number.isFinite(r0.H)) { raw.push({Q:Qanchor, H:r0.H}); xAnchor = r0.x; }
  }

  if (xAnchor) {
    raw = raw.concat(marchTo(Qanchor, Qmax, xAnchor));
    raw = raw.concat(marchTo(Qanchor, 0, xAnchor));
  } else {
    // Sin punto de operación disponible (bomba aún no resuelta): arranca en Q=0 con la
    // semilla BFS que systemHeadAt() usa como respaldo, y avanza igual de a pasos adaptativos.
    const r0 = systemHeadAt(red, pumpArc, 0, null);
    if (r0.H!==null && Number.isFinite(r0.H)) {
      raw.push({Q:0, H:r0.H});
      raw = raw.concat(marchTo(0, Qmax, r0.x));
    }
  }

  raw.sort((a,b)=>a.Q-b.Q);
  if (raw.length < 2) return raw;

  // Resamplea a nPts+1 puntos parejos para el gráfico (la marcha adaptativa puede haber
  // necesitado muchos más micro-pasos internos de los que hace falta graficar).
  const qLo = raw[0].Q, qHi = raw[raw.length-1].Q;
  const out = [];
  for (let i=0; i<=nPts; i++) {
    const qTarget = qLo + (qHi-qLo)*i/nPts;
    let best = raw[0], bestDist = Infinity;
    for (const p of raw) { const d = Math.abs(p.Q-qTarget); if (d<bestDist) { bestDist=d; best=p; } }
    if (!out.length || best.Q !== out[out.length-1].Q) out.push(best);
  }
  return out;
}
