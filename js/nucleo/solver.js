// js/nucleo/solver.js
'use strict';
/* Solver global de la red: Newton-Raphson con Jacobiano analítico, búsqueda de línea, continuación adaptativa,
   corrección viscosa ANSI/HI 9.6.7, escala de potencia por densidad, presión estática real (descontando V²/2g), NPSHa y alerta de cavitación. */

const CAUDAL_INVERSO_M3H = 1e-6;

function tankFixedHead(n, fluid) {
  return (n.cota || 0) + (n.level_m || 0) + (n.p_bar ?? 0) * 1e5 / (fluid.rho * G);
}

function solveNetwork(red, opc) {
  if (!red || !Array.isArray(red.nodes) || !Array.isArray(red.arcs) || !red.fluid) throw new Error('solveNetwork: se esperaba {nodes, arcs, fluid}');
  if (!(Number.isFinite(red.fluid.rho) && red.fluid.rho > 0) || !(Number.isFinite(red.fluid.nu) && red.fluid.nu > 0))
    throw new Error('solveNetwork: la densidad y la viscosidad cinemática del fluido deben ser números positivos');
  const nodes = red.nodes;
  const arcs  = red.arcs;
  const fluid = red.fluid;
  const findNode = id => nodes.find(n => n.id === id);
  const TOL     = +(opc && opc.tol) || 1e-4;
  const MAXITER = +(opc && opc.maxIter) || 300;

  const fixedNodes  = nodes.filter(n => n.type === 'tank');
  const freeNodes   = nodes.filter(n => n.type === 'junction');
  const pumpArcs    = arcs.filter(a => a.type === 'pump' && (a.pumpMode || 'curve') !== 'fixedQ');
  const fixedQPumps = arcs.filter(a => a.type === 'pump' && (a.pumpMode || 'curve') === 'fixedQ');
  const nonPumpArcs = arcs.filter(a => a.type !== 'pump');
  const cotaOf = {}; nodes.forEach(n => { cotaOf[n.id] = n.cota || 0; });

  if (freeNodes.length === 0) return { ok: false, msg: 'Sin nodos libres. Agregá al menos un Junction.' };
  if (fixedNodes.length === 0) return { ok: false, msg: 'Sin reservorios. La red necesita al menos una cabeza fija.' };
  const datoMalo = primerDatoNoFinito(nodes, arcs);
  if (datoMalo) return { ok: false, msg: 'Dato no numérico en ' + datoMalo + '. Corregilo y volvé a calcular.' };

  const freeIdx = {}; freeNodes.forEach((n, i) => { freeIdx[n.id] = i; });
  const pumpIdx = {}; pumpArcs.forEach((a, i) => { pumpIdx[a.id] = freeNodes.length + i; });

  const NF = freeNodes.length;
  const NP = pumpArcs.length;
  const N  = NF + NP;

  const Hfixed = {};
  fixedNodes.forEach(n => { Hfixed[n.id] = tankFixedHead(n, fluid); });
  const getH = (nId, x) => Hfixed[nId] !== undefined ? Hfixed[nId] : x[freeIdx[nId]];

  const avgFixed = fixedNodes.reduce((s, n) => s + Hfixed[n.id], 0) / fixedNodes.length;
  const initH = {};
  fixedNodes.forEach(n => { initH[n.id] = Hfixed[n.id]; });
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  arcs.forEach(a => { adj[a.fromId]?.push(a.toId); adj[a.toId]?.push(a.fromId); });
  const queue = fixedNodes.map(n => n.id);
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
    queue.length = 0; queue.push(...next);
  }
  function bfsSeed() {
    const x0 = new Array(N).fill(0);
    freeNodes.forEach((n, i) => { x0[i] = n.H !== null && n.H !== undefined ? n.H : (initH[n.id] ?? avgFixed); });
    pumpArcs.forEach((a, i) => { x0[NF + i] = a.Q !== null && a.Q !== undefined ? a.Q / 3600 : 0.05; });
    return x0;
  }

  function attemptSolve(fqValues, fpTargets, dpOverrides, xSeed) {
    const x = xSeed.slice();
    let iterations = 0, residual = Infinity;

    function buildFJ(xv) {
      const F = new Array(N).fill(0);
      const J = Array.from({ length: N }, () => new Array(N).fill(0));
      const circ = new Array(NF).fill(0);

      for (let i = 0; i < NF; i++) {
        const node = freeNodes[i];
        const Hi = xv[i];
        F[i] = -(node.demand || 0) / 3600;
        circ[i] = Math.abs(node.demand || 0) / 3600;

        for (const arc of nonPumpArcs) {
          let dH = 0, fromIdx = -1, toIdx = -1, arcConnected = false;
          if (arc.fromId === node.id) {
            dH = Hi - getH(arc.toId, xv);
            arcConnected = true; fromIdx = i; toIdx = freeIdx[arc.toId];
          } else if (arc.toId === node.id) {
            dH = getH(arc.fromId, xv) - Hi;
            arcConnected = true; fromIdx = freeIdx[arc.fromId]; toIdx = i;
          }
          if (!arcConnected) continue;

          let Q_ms = 0, cond = 0;
          if (arc.type === 'pipe' || arc.type === 'check' || arc.type === 'valve') {
            ({ Q_ms, cond } = caudalTramo(arc, dH, fluid));
          } else if (arc.type === 'equip') {
            const dpOvr = (dpOverrides && dpOverrides[arc.id] !== undefined) ? dpOverrides[arc.id] : undefined;
            ({ Q_ms, cond } = caudalEquipo(arc, dH, fluid, dpOvr));
          }

          circ[i] += Math.abs(Q_ms);
          if (arc.fromId === node.id) {
            F[i] -= Q_ms;
            J[i][i] -= cond;
            if (toIdx !== undefined && toIdx >= 0 && toIdx < NF) J[i][toIdx] += cond;
          } else {
            F[i] += Q_ms;
            J[i][i] -= cond;
            if (fromIdx !== undefined && fromIdx >= 0 && fromIdx < NF) J[i][fromIdx] += cond;
          }
        }

        for (let p = 0; p < NP; p++) {
          const parc = pumpArcs[p];
          const Qp = xv[NF + p];
          if (parc.fromId === node.id) {
            F[i] -= Qp; J[i][NF + p] = -1; circ[i] += Math.abs(Qp);
          } else if (parc.toId === node.id) {
            F[i] += Qp; J[i][NF + p] =  1; circ[i] += Math.abs(Qp);
          }
        }
        for (const parc of fixedQPumps) {
          const Qfix = (fqValues[parc.id] || 0) / 3600;
          if (parc.fromId === node.id) { F[i] -= Qfix; circ[i] += Math.abs(Qfix); }
          else if (parc.toId === node.id) { F[i] += Qfix; circ[i] += Math.abs(Qfix); }
        }
      }

      for (let p = 0; p < NP; p++) {
        const parc = pumpArcs[p];
        const eq   = NF + p;
        const Qp   = xv[eq];
        const Qp_m3h = Qp * 3600;
        const Hfrom = getH(parc.fromId, xv);
        const Hto   = getH(parc.toId,   xv);
        const nP_   = parc.nPumps || 1;
        if ((parc.pumpMode || 'curve') === 'fixedP') {
          const Htarget = fpTargets[parc.id];
          F[eq] = Hto - Htarget;
          const ti = freeIdx[parc.toId]; if (ti !== undefined) J[eq][ti] = 1;
        } else {
          const Hp = pumpHead(Math.abs(Qp_m3h) / nP_, parc, fluid);
          F[eq] = Hto - Hfrom - Hp;
          const fi = freeIdx[parc.fromId]; if (fi !== undefined) J[eq][fi] = -1;
          const ti = freeIdx[parc.toId];   if (ti !== undefined) J[eq][ti] =  1;
          const dHdQ = pumpHeadDeriv(Math.abs(Qp_m3h) / nP_, parc, fluid) * 3600 / nP_ * (Qp < 0 ? -1 : 1);
          J[eq][eq] = -dHdQ;
        }
      }
      return { F, J, circ };
    }

    const errorDe = (F, circ) => {
      let e = errorContinuidad(F, circ, NF);
      for (let p = NF; p < N; p++) { const r = Math.abs(F[p]); if (!Number.isFinite(r)) return Infinity; if (r > e) e = r; }
      return e;
    };

    for (let iter = 0; iter < MAXITER; iter++) {
      iterations++;
      const { F, J, circ } = buildFJ(x);
      const res0 = Math.sqrt(F.reduce((s, v) => s + v * v, 0));
      if (errorDe(F, circ) < TOL) { residual = res0; return { ok: true, x, iterations, residual }; }

      const dx = gaussSolve(J, F.map(v => -v));
      if (!dx) return { ok: false, singular: true, x, iterations, residual: res0 };

      const _dHmax = NF > 0 ? dx.slice(0, NF).reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0;
      const _dQmax = NP > 0 ? dx.slice(NF).reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0;
      const _lamH  = _dHmax > 12   ? 12 / _dHmax   : 1.0;
      const _lamQ  = _dQmax > 0.02 ? 0.02 / _dQmax : 1.0;
      const lamBase = Math.min(_lamH, _lamQ);

      let xTry = x, resTry = res0, errTry = Infinity;
      for (let bt = 0; bt < 12; bt++) {
        const lam = lamBase * Math.pow(0.5, bt);
        const xCand = x.slice();
        for (let i = 0; i < N; i++) xCand[i] += lam * dx[i];
        const { F: Fcand, circ: circCand } = buildFJ(xCand);
        const resCand = Math.sqrt(Fcand.reduce((s, v) => s + v * v, 0));
        if (resCand < resTry || bt === 0) { xTry = xCand; resTry = resCand; errTry = errorDe(Fcand, circCand); }
        if (resCand <= LS_MEJORA * res0) break;
      }
      for (let i = 0; i < N; i++) x[i] = xTry[i];
      residual = resTry;
      if (errTry < TOL) return { ok: true, x, iterations, residual };
    }
    return { ok: false, x, iterations, residual };
  }

  const fixedPPumps = pumpArcs.filter(a => (a.pumpMode || 'curve') === 'fixedP');
  const targetFQ = {}; fixedQPumps.forEach(a => { targetFQ[a.id] = a.fixedQ_m3h || 0; });
  const targetFP = {}; fixedPPumps.forEach(a => { targetFP[a.id] = (cotaOf[a.toId] || 0) + (a.fixedP_bar || 0) * 1e5 / (fluid.rho * G); });
  const equipArcs = nonPumpArcs.filter(a => a.type === 'equip');
  const targetDP = {}; equipArcs.forEach(a => { targetDP[a.id] = a.dp_bar || 0; });

  let solved = attemptSolve(targetFQ, targetFP, targetDP, bfsSeed());
  if (solved.singular) return { ok: false, msg: 'Sistema singular — verificar topología.' };

  if (!solved.ok && (fixedQPumps.length || fixedPPumps.length || equipArcs.length)) {
    const anchorFQ = {};
    fixedQPumps.forEach(a => { anchorFQ[a.id] = (a.Q != null && Number.isFinite(a.Q)) ? Math.abs(a.Q) : 0; });
    const anchorFP = {};
    fixedPPumps.forEach(a => {
      const toNode = findNode(a.toId);
      anchorFP[a.id] = (toNode && toNode.H != null && Number.isFinite(toNode.H)) ? toNode.H : (Hfixed[a.fromId] ?? avgFixed);
    });

    let anchorStart = attemptSolve(anchorFQ, anchorFP, targetDP, bfsSeed());
    if (!anchorStart.ok) {
      fixedQPumps.forEach(a => { anchorFQ[a.id] = 0; });
      fixedPPumps.forEach(a => { anchorFP[a.id] = Hfixed[a.fromId] ?? avgFixed; });
      anchorStart = attemptSolve(anchorFQ, anchorFP, targetDP, bfsSeed());
    }

    let anchorDP = targetDP, usedEquipAnchor = false;
    if (!anchorStart.ok && equipArcs.length) {
      const fixedHeadsArr = fixedNodes.map(n => Hfixed[n.id]);
      const headSpan = fixedHeadsArr.length ? (Math.max(...fixedHeadsArr) - Math.min(...fixedHeadsArr)) : 0;
      const pumpMaxH = pumpArcs.reduce((mx, a) => {
        const curveMax = (a.pumpCurve && a.pumpCurve.length) ? Math.max(...a.pumpCurve.map(p => p.H)) : 0;
        const fpMax = (a.pumpMode === 'fixedP') ? (a.fixedP_bar || 0) * 1e5 / (fluid.rho * G) : 0;
        return Math.max(mx, curveMax, fpMax);
      }, 0);
      const anchorHeadSafe = (headSpan + pumpMaxH) * 3 + 100;
      const anchorDpBarSafe = anchorHeadSafe * fluid.rho * G / 1e5;
      const anchorDPClosed = {};
      equipArcs.forEach(a => { anchorDPClosed[a.id] = anchorDpBarSafe; });

      anchorStart = attemptSolve(anchorFQ, anchorFP, anchorDPClosed, bfsSeed());
      if (anchorStart.ok) { anchorDP = anchorDPClosed; usedEquipAnchor = true; }
    }

    const hasPumpCont = fixedQPumps.length > 0 || fixedPPumps.length > 0;
    const twoPhase = hasPumpCont && usedEquipAnchor;

    if (anchorStart.ok) {
      let x = anchorStart.x, s = 0, step = 1.0;
      const minStep = 1 / 65536;
      let guard = 0, marched = true;
      let iterTotal = solved.iterations + anchorStart.iterations;
      let lastRes = solved.residual;
      while (s < 1 - 1e-9) {
        if (++guard > 5000) { marched = false; break; }
        const sNext = Math.min(s + step, 1);
        const sEquip = twoPhase ? Math.min(sNext / 0.5, 1)       : sNext;
        const sPump  = twoPhase ? Math.max((sNext - 0.5) / 0.5, 0) : sNext;
        const fq = {}, fp = {}, dp = {};
        fixedQPumps.forEach(a => { fq[a.id] = (anchorFQ[a.id] || 0) + ((targetFQ[a.id] || 0) - (anchorFQ[a.id] || 0)) * sPump; });
        fixedPPumps.forEach(a => { fp[a.id] = anchorFP[a.id] + (targetFP[a.id] - anchorFP[a.id]) * sPump; });
        equipArcs.forEach(a   => { dp[a.id] = anchorDP[a.id] + (targetDP[a.id] - anchorDP[a.id]) * sEquip; });
        const r = attemptSolve(fq, fp, dp, x);
        iterTotal += r.iterations;
        if (r.ok) {
          s = sNext; x = r.x; lastRes = r.residual;
          step = Math.min(step * 1.6, 1.0);
        } else {
          step /= 2;
          if (step < minStep) { marched = false; break; }
        }
      }
      if (marched && s >= 1 - 1e-9) solved = { ok: true, x, iterations: iterTotal, residual: lastRes };
      else solved = { ok: false, x: solved.x, iterations: iterTotal, residual: solved.residual };
    }
  }

  const x = solved.x;
  const converged = solved.ok;
  const iterations = solved.iterations;
  const lastResidual = solved.residual;

  const H = {}, Q = {};
  freeNodes.forEach((n, i) => { H[n.id] = x[i]; });
  fixedNodes.forEach(n => { H[n.id] = Hfixed[n.id]; });
  pumpArcs.forEach((a, i) => { Q[a.id] = x[NF + i] * 3600; });
  fixedQPumps.forEach(a => { Q[a.id] = a.fixedQ_m3h || 0; });

  for (const arc of nonPumpArcs) {
    const Hi = H[arc.fromId], Hj = H[arc.toId];
    if (Hi === undefined || Hj === undefined) { Q[arc.id] = 0; continue; }
    const dH_raw = Hi - Hj;
    if (arc.type === 'equip') {
      Q[arc.id] = caudalEquipo(arc, dH_raw, fluid).Q_m3h;
    } else {
      Q[arc.id] = caudalTramo(arc, dH_raw, fluid).Q_m3h;
    }
  }

  const pvPa = (Number.isFinite(+fluid.pv_pa) && +fluid.pv_pa >= 0) ? +fluid.pv_pa : 2339;
  const patmPa = (typeof P_ATM_PA !== 'undefined') ? P_ATM_PA : 101325;

  // Calculamos resultados de arcos y registramos la velocidad representativa de cañería en cada nodo para la lectura real de manómetro.
  // Un manómetro se instala sobre la tubería que acomete al nodo (pipe / check / valve); solo si un nodo une únicamente equipos/bombas
  // sin cañería propia se recurre como respaldo a la velocidad de boquilla. Si confluyen varias cañerías con flujo, se pondera V² por |Q|.
  const arcRes = {};
  const pipeVhSum = {}, pipeQSum = {}, fallbackVelByNode = {};
  const _addPipeVel = (nid, qAbs, v) => {
    pipeVhSum[nid] = (pipeVhSum[nid] || 0) + qAbs * (v * v / (2 * G));
    pipeQSum[nid]  = (pipeQSum[nid]  || 0) + qAbs;
  };
  for (const arc of arcs) {
    const Hi = H[arc.fromId], Hj = H[arc.toId];
    const Qa = Q[arc.id] || 0;
    const qAbs = Math.abs(Qa);
    let V = 0, Re = 0, f = 0, hf = 0, hf_major = 0, hm_minor = 0, velHead = 0, regime = '—';
    if (arc.type !== 'pump') {
      let dH = Hi - Hj;
      if (arc.type === 'equip') {
        const _D = (arc.D_mm || 200) / 1000, _A = Math.PI * _D * _D / 4;
        V = (qAbs / 3600) / _A;
        velHead = V * V / (2 * G);
        hf = dH; hm_minor = dH; hf_major = 0; regime = 'Equipo';
        arcRes[arc.id] = { Q: Qa, V, Re: 0, f: 0, hf, hf_major, hm_minor, velHead, regime };
        if (qAbs > 1e-9) {
          fallbackVelByNode[arc.fromId] = Math.max(fallbackVelByNode[arc.fromId] || 0, V);
          fallbackVelByNode[arc.toId]   = Math.max(fallbackVelByNode[arc.toId]   || 0, V);
        }
      } else {
        if (esRetencion(arc) && dH < 0) dH = 0;
        const r = pipeCalc(dH, arc, fluid);
        V = r.V; Re = r.Re; f = r.f; hf = r.hf;
        hf_major = r.hf_major; hm_minor = r.hm_minor; velHead = r.velHead; regime = r.regime;
        arcRes[arc.id] = { Q: Qa, V, Re, f, hf, hf_major, hm_minor, velHead, regime };
        if (qAbs > 1e-9) {
          _addPipeVel(arc.fromId, qAbs, V);
          _addPipeVel(arc.toId,   qAbs, V);
        }
      }
    } else {
      const D = arc.D_mm / 1000, A = Math.PI * D * D / 4;
      V = Math.abs(Qa / 3600) / A;
      const nP_pump = arc.nPumps || 1;
      const pMode = arc.pumpMode || 'curve';
      const isFixedQ = pMode === 'fixedQ';
      const isFixedP = pMode === 'fixedP';
      const vf = (!isFixedQ && !isFixedP) ? pumpViscosityFactors(arc, fluid) : { B: 0, C_Q: 1, C_H: 1, C_eta: 1, overLimit: false };
      if (isFixedQ || isFixedP) {
        hf = (Hi !== undefined && Hj !== undefined) ? (Hj - Hi) : null;
        regime = isFixedQ ? 'Bomba (caudal fijo)' : 'Bomba (presión fija)';
      } else {
        hf = pumpHead(Math.abs(Qa) / nP_pump, arc, fluid);
        regime = vf.B > 1 ? `Bomba (ANSI/HI B=${vf.B.toFixed(1)})` : 'Bomba';
      }
      const P_hid_val = hf != null ? fluid.rho * G * (Math.abs(Qa) / 3600) * hf / 1000.0 : null;
      const Pe_val = pumpPower(Math.abs(Qa) / nP_pump, arc, fluid);
      const P_eje_val = Pe_val !== null ? Pe_val * nP_pump : null;
      const effPts = (!isFixedQ && !isFixedP) ? effectivePumpCurve(arc, fluid) : null;
      const runout_flag = !!(effPts && effPts.length && Math.abs(Qa) / nP_pump > effPts[effPts.length - 1].Q);

      // NPSH disponible en la brida de succión: carga absoluta total en la entrada menos altura de presión de vapor
      const zSuc = cotaOf[arc.fromId] || 0;
      const NPSHa = Hi !== undefined ? (Hi - zSuc + (patmPa - pvPa) / (fluid.rho * G)) : null;

      arcRes[arc.id] = {
        Q: Qa, V, Re: 0, f: 0, hf, hf_major: 0, hm_minor: 0, regime,
        P_hid: P_hid_val, P_eje: P_eje_val, NPSHa,
        viscB: vf.B, C_Q: vf.C_Q, C_H: vf.C_H, C_eta: vf.C_eta, viscOverLimit: vf.overLimit,
        runout: runout_flag
      };
    }
  }

  // Presiones nodales: P piezométrica [bar] y P_est estática real de manómetro [bar] (descontando la altura cinética V²/2g de la cañería en el nodo)
  const nodeRes = {};
  const cavNodes = [];
  for (const n of nodes) {
    const hVal = H[n.id];
    if (hVal === undefined) {
      nodeRes[n.id] = { H: undefined, P: null, P_est: null, velHead: 0, cavitation: false };
      continue;
    }
    let vh = 0;
    if (n.type === 'junction') {
      if ((pipeQSum[n.id] || 0) > 1e-9) {
        vh = pipeVhSum[n.id] / pipeQSum[n.id];
      } else {
        const vf = fallbackVelByNode[n.id] || 0;
        vh = vf * vf / (2 * G);
      }
    }
    const P_piezo = (hVal - (n.cota || 0)) * fluid.rho * G / 1e5;
    const P_static = (hVal - (n.cota || 0) - vh) * fluid.rho * G / 1e5;
    const pAbsPa = patmPa + P_static * 1e5;
    const cavitating = n.type === 'junction' && pAbsPa <= pvPa;
    if (cavitating) cavNodes.push(n.label);
    nodeRes[n.id] = { H: hVal, P: P_piezo, P_est: P_static, velHead: vh, cavitation: cavitating };
  }

  const runoutWarnings = pumpArcs
    .filter(a => (a.pumpMode || 'curve') === 'curve' && arcRes[a.id]?.runout)
    .map(a => a.label);
  const viscWarnings = pumpArcs
    .filter(a => (a.pumpMode || 'curve') === 'curve' && arcRes[a.id]?.viscOverLimit)
    .map(a => `${a.label} (B=${arcRes[a.id].viscB.toFixed(1)} ≥ 40: ANSI/HI recomienda desplazamiento positivo)`);
  const npshWarnings = arcs
    .filter(a => a.type === 'pump' && arcRes[a.id]?.NPSHa != null && arcRes[a.id].NPSHa <= 0.5)
    .map(a => `${a.label} (NPSHa=${arcRes[a.id].NPSHa.toFixed(2)} m)`);

  let extraWarn = '';
  if (runoutWarnings.length) extraWarn += ` ⚠️ ${runoutWarnings.join(', ')} en caudal máximo de curva.`;
  if (viscWarnings.length)   extraWarn += ` ⚠️ Viscosidad extrema en ${viscWarnings.join(', ')}.`;
  if (cavNodes.length)       extraWarn += ` ⚠️ Posible cavitación / vacío físico en nodo(s): ${cavNodes.join(', ')}.`;
  if (npshWarnings.length)   extraWarn += ` ⚠️ NPSHa crítico en ${npshWarnings.join(', ')}.`;

  const inversas = converged ? pumpArcs.filter(a => (Q[a.id] || 0) < -CAUDAL_INVERSO_M3H) : [];
  const invMsg = inversas.map(a => `${a.label} (${Q[a.id].toFixed(1)} m³/h)`).join(', ');
  const valido = converged && !inversas.length;

  return {
    ok: valido,
    msg: valido
      ? `Convergió en ${iterations} iteraciones · residuo ${lastResidual.toExponential(2)}${extraWarn}`
      : converged
        ? `Caudal inverso en ${inversas.length > 1 ? 'las bombas' : 'la bomba'} ${invMsg}: la red pide más carga que la que da la bomba (mirá la carga a caudal cero de su curva). Agregá una retención en serie o revisá los datos.`
        : `No convergió en ${iterations} iter. · residuo ${lastResidual.toExponential(2)}`,
    iterations, residual: lastResidual,
    H, Q, nodeRes, arcRes
  };
}
