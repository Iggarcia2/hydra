// js/nucleo/curva_sistema.js
'use strict';
/* Curva del sistema por bomba: resuelve la red a caudal fijo y barre caudales con paso adaptativo. */

const TOL_CURVA = 1e-6;

function nodosLibresConectados(red) {
  const usados = new Set();
  for (const a of red.arcs) { usados.add(a.fromId); usados.add(a.toId); }
  return red.nodes.filter(n => n.type === 'junction' && usados.has(n.id));
}

function systemHeadAt(red, pumpArc, Qm3h, x0) {
  const nodes = red.nodes, arcs = red.arcs, fluid = red.fluid;
  const fixedNodes  = nodes.filter(n => n.type === 'tank');
  const freeNodes   = nodosLibresConectados(red);
  const nonPumpArcs = arcs.filter(a => a.type !== 'pump');
  const otherPumps  = arcs.filter(a => a.type === 'pump' && a.id !== pumpArc.id);
  if (!freeNodes.length || !fixedNodes.length) return { H: null, x: null };

  const freeIdx = {}; freeNodes.forEach((n, i) => { freeIdx[n.id] = i; });
  const NF = freeNodes.length;
  const Hfixed = {};
  fixedNodes.forEach(n => { Hfixed[n.id] = tankFixedHead(n, fluid); });
  const getH2 = (nId, xv) => Hfixed[nId] !== undefined ? Hfixed[nId] : xv[freeIdx[nId]];
  const avgFixed = fixedNodes.reduce((s, n) => s + Hfixed[n.id], 0) / fixedNodes.length;

  let x;
  if (x0 && x0.length === NF) {
    x = x0.slice();
  } else {
    const initH = {};
    fixedNodes.forEach(n => { initH[n.id] = Hfixed[n.id]; });
    const adj = {};
    nodes.forEach(n => { adj[n.id] = []; });
    arcs.forEach(a => { adj[a.fromId]?.push(a.toId); adj[a.toId]?.push(a.fromId); });
    let queue = fixedNodes.map(n => n.id);
    const visited = new Set(queue);
    while (queue.length) {
      const next = [];
      for (const id of queue) {
        for (const nb of (adj[id] || [])) {
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
  const Qfixed_ms = Qm3h / 3600;
  const otherPumpQ = {}; otherPumps.forEach(p => { otherPumpQ[p.id] = p.Q != null ? p.Q / 3600 : 0; });

  function buildF(xv) {
    const F = new Array(NF).fill(0);
    const J = Array.from({ length: NF }, () => new Array(NF).fill(0));
    const circ = new Array(NF).fill(0);
    for (let i = 0; i < NF; i++) {
      const node = freeNodes[i];
      const Hi = xv[i];
      F[i] = -(node.demand || 0) / 3600;
      circ[i] = Math.abs(node.demand || 0) / 3600;
      for (const arc of nonPumpArcs) {
        let dH = 0, fromIdx = -1, toIdx = -1, connected = false;
        if (arc.fromId === node.id) { const Hj = getH2(arc.toId, xv); dH = Hi - Hj; connected = true; toIdx = freeIdx[arc.toId]; }
        else if (arc.toId === node.id) { const Hj = getH2(arc.fromId, xv); dH = Hj - Hi; connected = true; fromIdx = freeIdx[arc.fromId]; }
        if (!connected) continue;
        let Q_ms = 0, cond = 0;
        if (arc.type === 'pipe' || arc.type === 'check' || arc.type === 'valve') {
          ({ Q_ms, cond } = caudalTramo(arc, dH, fluid));
        } else if (arc.type === 'equip') {
          ({ Q_ms, cond } = caudalEquipo(arc, dH, fluid));
        }
        circ[i] += Math.abs(Q_ms);
        if (arc.fromId === node.id) { F[i] -= Q_ms; J[i][i] -= cond; if (toIdx >= 0 && toIdx < NF) J[i][toIdx] += cond; }
        else                        { F[i] += Q_ms; J[i][i] -= cond; if (fromIdx >= 0 && fromIdx < NF) J[i][fromIdx] += cond; }
      }
      if (pumpArc.fromId === node.id) { F[i] -= Qfixed_ms; circ[i] += Math.abs(Qfixed_ms); }
      else if (pumpArc.toId === node.id) { F[i] += Qfixed_ms; circ[i] += Math.abs(Qfixed_ms); }
      for (const p of otherPumps) {
        const Qp = otherPumpQ[p.id];
        if (p.fromId === node.id) { F[i] -= Qp; circ[i] += Math.abs(Qp); }
        else if (p.toId === node.id) { F[i] += Qp; circ[i] += Math.abs(Qp); }
      }
    }
    return { F, J, circ };
  }

  let converged = false;
  for (let iter = 0; iter < 100; iter++) {
    const { F, J, circ } = buildF(x);
    const res0 = Math.sqrt(F.reduce((s, v) => s + v * v, 0));
    if (errorContinuidad(F, circ, NF) < TOL_CURVA) { converged = true; break; }
    const dx = gaussSolve(J, F.map(v => -v));
    if (!dx) return { H: null, x: null };
    const dmax = dx.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const lamBase = dmax > 12 ? 12 / dmax : 1.0;
    let xTry = x, resTry = res0, errTry = Infinity;
    for (let bt = 0; bt < 12; bt++) {
      const lam = lamBase * Math.pow(0.5, bt);
      const xCand = x.slice();
      for (let i = 0; i < NF; i++) xCand[i] += lam * dx[i];
      const { F: Fcand, circ: circCand } = buildF(xCand);
      const resCand = Math.sqrt(Fcand.reduce((s, v) => s + v * v, 0));
      if (resCand < resTry || bt === 0) { xTry = xCand; resTry = resCand; errTry = errorContinuidad(Fcand, circCand, NF); }
      if (resCand <= LS_MEJORA * res0) break;
    }
    x = xTry;
    if (errTry < TOL_CURVA) { converged = true; break; }
  }
  if (!converged) return { H: null, x: null };

  const H = {};
  freeNodes.forEach((n, i) => { H[n.id] = x[i]; });
  fixedNodes.forEach(n => { H[n.id] = Hfixed[n.id]; });
  const Hfrom = H[pumpArc.fromId], Hto = H[pumpArc.toId];
  if (Hfrom === undefined || Hto === undefined) return { H: null, x: null };
  return { H: Hto - Hfrom, x };
}

function computeSystemCurve(red, pumpArc, nPts = 14) {
  const pMode = pumpArc.pumpMode || 'curve';
  const nP_ = pumpArc.nPumps || 1;
  const Qanchor0 = pumpArc.Q != null ? Math.abs(pumpArc.Q) : null;
  let Qmax;
  if (pMode === 'curve') {
    const effPts = effectivePumpCurve(pumpArc, red.fluid);
    if (!effPts || effPts.length < 2) return [];
    Qmax = Math.max(effPts[effPts.length - 1].Q * nP_ * 1.15, 1);
  } else {
    const ref = Qanchor0 ?? (pMode === 'fixedQ' ? (pumpArc.fixedQ_m3h || 100) : 100);
    Qmax = Math.max(ref * 1.8, 10);
  }
  const step0 = Qmax / nPts;

  const freeNodes = nodosLibresConectados(red);
  const Qanchor = Qanchor0;
  const anchorX0 = (Qanchor != null && freeNodes.length && freeNodes.every(n => n.H != null))
    ? freeNodes.map(n => n.H) : null;

  function marchTo(qFrom, qTarget, xFrom) {
    const out = [];
    let x = xFrom, q = qFrom, step = step0;
    const dir = qTarget > qFrom ? 1 : (qTarget < qFrom ? -1 : 0);
    if (dir === 0 || !x) return out;
    const minStep = step0 / 4096;
    let guard = 0;
    while ((dir > 0 && q < qTarget - 1e-9) || (dir < 0 && q > qTarget + 1e-9)) {
      if (++guard > 5000) break;
      let qNext = q + dir * step;
      if ((dir > 0 && qNext > qTarget) || (dir < 0 && qNext < qTarget)) qNext = qTarget;
      const r = systemHeadAt(red, pumpArc, qNext, x);
      if (r.H !== null && Number.isFinite(r.H)) {
        q = qNext; x = r.x;
        out.push({ Q: q, H: r.H });
        step = Math.min(step * 1.6, step0);
      } else {
        step /= 2;
        if (step < minStep) break;
      }
    }
    return out;
  }

  let raw = [], xAnchor = null;
  if (anchorX0) {
    const r0 = systemHeadAt(red, pumpArc, Qanchor, anchorX0);
    if (r0.H !== null && Number.isFinite(r0.H)) { raw.push({ Q: Qanchor, H: r0.H }); xAnchor = r0.x; }
  }
  if (xAnchor) {
    raw = raw.concat(marchTo(Qanchor, Qmax, xAnchor));
    raw = raw.concat(marchTo(Qanchor, 0, xAnchor));
  } else {
    const r0 = systemHeadAt(red, pumpArc, 0, null);
    if (r0.H !== null && Number.isFinite(r0.H)) {
      raw.push({ Q: 0, H: r0.H });
      raw = raw.concat(marchTo(0, Qmax, r0.x));
    }
  }

  raw.sort((a, b) => a.Q - b.Q);
  if (raw.length < 2) return raw;

  const qLo = raw[0].Q, qHi = raw[raw.length - 1].Q;
  const out = [];
  for (let i = 0; i <= nPts; i++) {
    const qTarget = qLo + (qHi - qLo) * i / nPts;
    let best = raw[0], bestDist = Infinity;
    for (const p of raw) { const d = Math.abs(p.Q - qTarget); if (d < bestDist) { bestDist = d; best = p; } }
    if (!out.length || best.Q !== out[out.length - 1].Q) out.push(best);
  }
  return out;
}
