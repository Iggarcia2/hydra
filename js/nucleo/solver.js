// js/nucleo/solver.js
'use strict';
/* Solver de la red: Newton-Raphson con Jacobiano analítico, búsqueda de línea y continuación adaptativa. Sin DOM ni estado global. */

// [repo] Antes leía state, fluid y los campos de pantalla (tolerancia, iteraciones máx.). Ahora recibe todo por parámetro:
//   red = {nodes, arcs, fluid:{rho, nu}}   opc = {tol, maxIter} (valor no numérico o 0 → 1e-4 y 300, igual que antes)
function solveNetwork(red, opc) {
  if (!red || !Array.isArray(red.nodes) || !Array.isArray(red.arcs) || !red.fluid) throw new Error('solveNetwork: se esperaba {nodes, arcs, fluid}');
  if (!(Number.isFinite(red.fluid.rho) && red.fluid.rho > 0) || !(Number.isFinite(red.fluid.nu) && red.fluid.nu > 0))
    throw new Error('solveNetwork: la densidad y la viscosidad cinemática del fluido deben ser números positivos');
  const nodes = red.nodes;
  const arcs  = red.arcs;
  const fluid = red.fluid;
  const findNode = id => nodes.find(n=>n.id===id);
  const TOL   = +(opc && opc.tol) || 1e-4;
  const MAXITER = +(opc && opc.maxIter) || 300;

  // Classify nodes
  const fixedNodes    = nodes.filter(n=>n.type==='tank');
  const freeNodes     = nodes.filter(n=>n.type==='junction');
  // [v17/v18] Bombas de curva H-Q y de presión fija: su caudal es una incógnita del solver,
  // con una ecuación de energía propia (distinta según el modo, ver más abajo). Bombas de
  // caudal fijo: el caudal es un dato conocido (como una demanda) — no suman incógnita ni
  // ecuación propia; la presión que exigen sale de las cabezas ya resueltas.
  const pumpArcs      = arcs.filter(a=>a.type==='pump' && (a.pumpMode||'curve')!=='fixedQ'); // curve + fixedP
  const fixedQPumps   = arcs.filter(a=>a.type==='pump' && (a.pumpMode||'curve')==='fixedQ');
  const nonPumpArcs   = arcs.filter(a=>a.type!=='pump');
  // [v18] Cota de cada nodo, para convertir la presión fijada en una bomba de modo 'fixedP' a
  // cabeza objetivo en su nodo de salida (misma fórmula que ya usa Hfixed para los tanques).
  const cotaOf = {}; nodes.forEach(n=>{ cotaOf[n.id] = n.cota||0; });

  if (freeNodes.length === 0) {
    return {ok:false, msg:'Sin nodos libres. Agregá al menos un Junction.'};
  }
  if (fixedNodes.length === 0) {
    return {ok:false, msg:'Sin reservorios. La red necesita al menos una cabeza fija.'};
  }
  const datoMalo = primerDatoNoFinito(nodes, arcs);   // [repo] datos rotos → error claro en vez de un «Convergió» falso
  if (datoMalo) return {ok:false, msg:'Dato no numérico en ' + datoMalo + '. Corregilo y volvé a calcular.'};

  // Index maps
  const freeIdx = {};  // nodeId → index in H vector
  freeNodes.forEach((n,i)=>{ freeIdx[n.id]=i; });
  const pumpIdx = {};  // arcId → index offset (after freeNodes)
  pumpArcs.forEach((a,i)=>{ pumpIdx[a.id]=freeNodes.length+i; });

  const NF = freeNodes.length;
  const NP = pumpArcs.length;
  const N  = NF + NP;

  // Fixed head values
  const Hfixed = {};
  fixedNodes.forEach(n=>{ Hfixed[n.id] = n.cota+(n.p_bar??0)*1e5/(fluid.rho*G); });

  // Get current head of node (fixed or unknown from x vector)
  const getH = (nId, x) => {
    if (Hfixed[nId] !== undefined) return Hfixed[nId];
    return x[freeIdx[nId]];
  };

  // Initialize x via BFS from fixed nodes — avoids all-zero dH at iteration 0
  const avgFixed = fixedNodes.reduce((s,n)=>s+(n.cota+(n.p_bar??0)*1e5/(fluid.rho*G)),0)/fixedNodes.length;
  // BFS: assign initial H based on hop distance from nearest fixed node
  const initH = {};
  fixedNodes.forEach(n=>{ initH[n.id] = n.cota+(n.p_bar??0)*1e5/(fluid.rho*G); });
  // Build adjacency
  const adj = {};
  nodes.forEach(n=>{ adj[n.id]=[]});
  arcs.forEach(a=>{ adj[a.fromId]?.push(a.toId); adj[a.toId]?.push(a.fromId); });
  const queue = fixedNodes.map(n=>n.id);
  const visited = new Set(queue);
  while (queue.length) {
    const next = [];
    for (const id of queue) {
      for (const nb of (adj[id]||[])) {
        if (!visited.has(nb)) {
          visited.add(nb);
          // Small gradient per hop so dH != 0 initially
          initH[nb] = initH[id] - 0.5;
          next.push(nb);
        }
      }
    }
    queue.length = 0; queue.push(...next);
  }
  function bfsSeed() {
    const x0 = new Array(N).fill(0);
    freeNodes.forEach((n,i)=>{ x0[i] = n.H !== null ? n.H : (initH[n.id] ?? avgFixed); });
    pumpArcs.forEach((a,i)=>{ x0[NF+i] = a.Q !== null ? a.Q/3600 : 0.05; }); // m³/s
    return x0;
  }

  // [v17/v18/v20] Un intento de Newton-Raphson con caudales fijos (m³/h, por id de bomba de
  // caudal fijo), cabezas objetivo (m, por id de bomba de presión fija) y ΔP efectivo de cada
  // arco Equipo (bar, por id de arco — v20) dados, más una semilla de arranque. Es el mismo
  // bucle de siempre, solo parametrizado en esos valores y la semilla — para poder reutilizarlo
  // en el intento directo (de siempre) y en la continuación adaptativa de más abajo (nueva en
  // v17, generalizada a presión fija en v18 y a Equipo en v20).
  function attemptSolve(fqValues, fpTargets, dpOverrides, xSeed) {
    const x = xSeed.slice();
    let iterations = 0, residual = Infinity;

    // [v20] Arma F (residuo) y J (Jacobiano) para un vector de cabezas/caudales xv dado. Se
    // separó de la iteración principal en una función propia para poder reevaluar SOLO el
    // residuo en un punto de prueba durante el retroceso de línea (line search, más abajo) sin
    // duplicar la física de cada tipo de arco en dos lugares distintos del código — ya hubo un
    // bug real (v20, arco Equipo) causado por dos copias de la misma fórmula que fueron
    // divergiendo con el tiempo; esta función evita repetir ese error.
    function buildFJ(xv) {
      const F = new Array(N).fill(0);
      const J = Array.from({length:N},()=>new Array(N).fill(0));

      // ── (1) Continuity equations for each free node ──
      for (let i=0; i<NF; i++) {
        const node = freeNodes[i];
        const Hi = xv[i];
        F[i] = -node.demand/3600;  // m³/s, demand is a sink (subtract)

        // Contribution from non-pump arcs connected to this node
        for (const arc of nonPumpArcs) {
          let dH = 0, fromIdx = -1, toIdx = -1;
          let arcConnected = false;

          if (arc.fromId === node.id) {
            const Hj = getH(arc.toId, xv);
            dH = Hi - Hj;
            arcConnected = true; fromIdx = i; toIdx = freeIdx[arc.toId];
          } else if (arc.toId === node.id) {
            const Hj = getH(arc.fromId, xv);
            dH = Hj - Hi;  // flow from j→i (positive into node i)
            arcConnected = true; fromIdx = freeIdx[arc.fromId]; toIdx = i;
          }
          if (!arcConnected) continue;

          let Q_ms = 0, cond = 0;  // m³/s, conductance ∂Q/∂dH

          if (arc.type === 'pipe' || arc.type === 'check') {
            // Check valve: only allow positive flow (from→to)
            if (arc.type === 'check' && dH < 0) {
              Q_ms = 0; cond = 0;
            } else {
              const r = pipeCalc(dH, arc, fluid);
              Q_ms = r.Q/3600; cond = r.cond/3600;
            }
          } else if (arc.type === 'equip') {
            // Calibrated model: Q = Q_ref × √(effDH / dpH)
            // Q_ref = π×D²/4 × 2 m/s  (nozzle @ 2 m/s reference velocity, D hidden from UI)
            // [v20] dp_bar efectivo: durante la continuación adaptativa de más abajo, este
            // valor puede venir anclado en un arranque distinto del real (ver dpOverrides) —
            // en el intento directo (sin continuación) coincide siempre con arc.dp_bar.
            const dpBarEff = (dpOverrides && dpOverrides[arc.id] !== undefined) ? dpOverrides[arc.id] : arc.dp_bar;
            const dpH_raw = dpBarEff*1e5/(fluid.rho*G);
            const dpH = Math.max(dpH_raw, 1e-6); // guard against dp_bar=0
            const effDH = dH - dpH;
            const _D = (arc.D_mm||200)/1000, _A = Math.PI*_D*_D/4;
            const Q_REF = _A * 2.0;   // m³/s at V=2 m/s through nozzle
            Q_ms = effDH > 0 ? Q_REF * Math.sqrt(effDH/dpH) : 0;
            // [v20] La pendiente real (conductancia) de este modelo diverge a infinito cuando
            // effDH→0+ (derivada de una raíz cuadrada en su origen), y además la versión
            // original saltaba en seco a cond=1e-6 apenas effDH cruzaba a negativo — ese salto
            // discontinuo (de un valor gigante a uno casi nulo, justo en el punto donde la red
            // suele terminar operando) hace que Newton oscile en un ciclo de 2 iteraciones sin
            // asentarse nunca (una rama lo manda para un lado, la otra lo manda de vuelta). Se
            // evalúa la MISMA fórmula analítica de la conductancia en un effDH nunca menor al 2%
            // de dpH, sin importar el signo real de effDH — queda continua a ambos lados del
            // quiebre. El RESIDUO (Q_ms, arriba) sigue el modelo exacto de siempre sin cambios;
            // esto solo suaviza la dirección de búsqueda de Newton, no la física ni el punto de
            // convergencia.
            const effDHforCond = Math.max(effDH, 0.02*dpH);
            cond = (Q_REF * Math.sqrt(effDHforCond/dpH)) / (2*effDHforCond);
          } else if (arc.type === 'valve') {
            if (arc.valveType === 'check') {
              if (dH < 0) { Q_ms=0; cond=0; }
              else { const r=pipeCalc(dH,arc, fluid); Q_ms=r.Q/3600; cond=r.cond/3600; }
            } else if (arc.valveType === 'prv') {
              // PRV: downstream head fixed at setpoint (handled specially)
              // For now treat as fully open pipe
              const r=pipeCalc(dH,arc, fluid); Q_ms=r.Q/3600; cond=r.cond/3600;
            } else {
              const r=pipeCalc(dH,arc, fluid); Q_ms=r.Q/3600; cond=r.cond/3600;
            }
          }

          // Add to continuity: positive Q means flow into node
          if (arc.fromId === node.id) {
            F[i] -= Q_ms;      // flow leaving
            J[i][i] -= cond;
            if (toIdx !== undefined && toIdx >= 0 && toIdx < NF) J[i][toIdx] += cond;
          } else {
            F[i] += Q_ms;      // flow arriving
            J[i][i] -= cond;
            if (fromIdx !== undefined && fromIdx >= 0 && fromIdx < NF) J[i][fromIdx] += cond;
          }
        }

        // Contribution from pump arcs connected to this node
        for (let p=0; p<NP; p++) {
          const parc = pumpArcs[p];
          const Qp = xv[NF+p];  // m³/s
          if (parc.fromId === node.id) {
            F[i] -= Qp;
            J[i][NF+p] = -1;
          } else if (parc.toId === node.id) {
            F[i] += Qp;
            J[i][NF+p] = 1;
          }
        }
        // [v17] Contribución de bombas en modo "caudal fijo": el caudal es un dato conocido,
        // no una incógnita — solo aporta al lado derecho (F), sin columna en el Jacobiano.
        for (const parc of fixedQPumps) {
          const Qfix = (fqValues[parc.id]||0)/3600; // m³/s
          if (parc.fromId === node.id) F[i] -= Qfix;
          else if (parc.toId === node.id) F[i] += Qfix;
        }
      }

      // ── (2) Pump energy equations ──
      // Modo curva:      H_to - H_from - h_pump(Q_p) = 0   (Q_p incógnita real de la ecuación)
      // [v18] Modo fixedP: H_to - H_objetivo = 0            (no depende de Q_p ni de H_from —
      //   el caudal sale enteramente de cómo reacciona el resto de la red a esa cabeza fija;
      //   H_objetivo = cota del nodo de salida + presión del manómetro, siempre a la salida)
      for (let p=0; p<NP; p++) {
        const parc = pumpArcs[p];
        const eq   = NF + p;
        const Qp   = xv[eq];       // m³/s
        const Qp_m3h = Qp*3600;
        const Hfrom = getH(parc.fromId, xv);
        const Hto   = getH(parc.toId,   xv);
        const nP_   = parc.nPumps||1;
        if ((parc.pumpMode||'curve') === 'fixedP') {
          const Htarget = fpTargets[parc.id]; // [v18] precalculado afuera (constante, no depende de x)
          F[eq] = Hto - Htarget;
          const ti = freeIdx[parc.toId]; if (ti !== undefined) J[eq][ti] = 1;
          // Sin dependencia de H_from ni de Q_p: quedan en 0 (valor inicial de la fila).
        } else {
          const Hp = pumpHead(Math.abs(Qp_m3h)/nP_, parc);
          F[eq] = Hto - Hfrom - Hp;
          const fi = freeIdx[parc.fromId]; if (fi !== undefined) J[eq][fi] = -1;
          const ti = freeIdx[parc.toId];   if (ti !== undefined) J[eq][ti] =  1;
          const dHdQ = pumpHeadDeriv(Math.abs(Qp_m3h)/nP_, parc) * 3600 / nP_;
          J[eq][eq] = -dHdQ;
        }
      }

      return {F, J};
    }

    for (let iter=0; iter<MAXITER; iter++) {
      iterations++;
      const {F, J} = buildFJ(x);
      const res0 = Math.sqrt(F.reduce((s,v)=>s+v*v,0));
      if (res0 < TOL) { residual = res0; return {ok:true, x, iterations, residual}; }

      // ── Solve J·Δx = -F via Gaussian elimination ──
      const dx = gaussSolve(J, F.map(v=>-v));
      if (!dx) return {ok:false, singular:true, x, iterations, residual:res0};

      // Step limiter — separate limits for head [m] and pump flow [m³/s]
      const _dHmax = NF>0 ? dx.slice(0,NF).reduce((m,v)=>Math.max(m,Math.abs(v)),0) : 0;
      const _dQmax = NP>0 ? dx.slice(NF).reduce((m,v)=>Math.max(m,Math.abs(v)),0) : 0;
      const _lamH  = _dHmax > 12   ? 12/_dHmax   : 1.0;
      const _lamQ  = _dQmax > 0.02 ? 0.02/_dQmax : 1.0;
      const lamBase = Math.min(_lamH, _lamQ);

      // [v20] Retroceso de línea (line search / damped Newton): en vez de aceptar a ciegas el
      // paso completo que sugiere la linealización, se prueba primero con el paso completo y,
      // si empeora el residuo, se lo va reduciendo a la mitad hasta encontrar una fracción que
      // sí lo mejore. En el caso de siempre (el paso completo ya mejora el residuo, que es la
      // enorme mayoría de las iteraciones en cualquier red) esto no cambia NADA — se acepta en
      // el primer intento, igual que antes. Solo entra en juego cuando el paso completo
      // empeoraría las cosas, que es exactamente lo que se observó cerca del quiebre no suave
      // del modelo de Equipo: sin esto, Newton quedaba rebotando en un ciclo de 2 iteraciones
      // (un lado corrige de más, el otro corrige de más en sentido contrario) sin bajar nunca
      // del residuo por debajo de la tolerancia, sin importar cuántas iteraciones se le dieran.
      let xTry = x, resTry = res0;
      for (let bt=0; bt<12; bt++) {
        const lam = lamBase * Math.pow(0.5, bt);
        const xCand = x.slice();
        for (let i=0; i<N; i++) xCand[i] += lam*dx[i];
        const { F: Fcand } = buildFJ(xCand);
        const resCand = Math.sqrt(Fcand.reduce((s,v)=>s+v*v,0));
        if (resCand < resTry || bt === 0) { xTry = xCand; resTry = resCand; }
        if (resCand < res0) break;  // esta fracción del paso mejora el residuo — aceptarla
      }
      for (let i=0; i<N; i++) x[i] = xTry[i];
      residual = resTry;
      if (residual < TOL) return {ok:true, x, iterations, residual};
    }
    return {ok:false, x, iterations, residual};
  }
  // [v18] Bombas de presión fija — viven en pumpArcs (caudal incógnita), separadas acá solo
  // para armar sus mapas de continuación sin recorrer pumpArcs entero cada vez.
  const fixedPPumps = pumpArcs.filter(a => (a.pumpMode||'curve') === 'fixedP');

  // [v17/v18] Caudales objetivo (m³/h) y cabezas objetivo (m) de las bombas de caudal
  // fijo/presión fija, por id de arco.
  const targetFQ = {};
  fixedQPumps.forEach(a => { targetFQ[a.id] = a.fixedQ_m3h||0; });
  const targetFP = {};
  fixedPPumps.forEach(a => { targetFP[a.id] = (cotaOf[a.toId]||0) + (a.fixedP_bar||0)*1e5/(fluid.rho*G); });

  // [v20] Arcos Equipo — su ΔP fijo (dp_bar) no es una incógnita del solver (no tienen fila
  // propia en el Jacobiano, igual que un tramo), pero SÍ puede necesitar continuación: el modelo
  // "Q = Q_ref·√(effDH/dpH)" tiene un quiebre no suave en effDH=0 (Q pasa de 0 a una curva raíz
  // cuadrada) y, a diferencia de las bombas, nunca tuvo ningún respaldo si el intento directo no
  // converge — encontrado y reproducido con un archivo real del usuario (cambiar el dp_bar de un
  // Equipo de 2 a 1.5 bar en una red en serie con bomba de presión fija dejaba de converger, y ni
  // siquiera volver a 2 bar servía después, porque un intento fallido borra las cabezas
  // conocidas y el próximo arranque queda en frío).
  const equipArcs = nonPumpArcs.filter(a => a.type === 'equip');
  const targetDP = {};
  equipArcs.forEach(a => { targetDP[a.id] = a.dp_bar||0; });

  // Intento directo — comportamiento de siempre (idéntico si no hay bombas de caudal/presión
  // fija ni arcos Equipo)
  let solved = attemptSolve(targetFQ, targetFP, targetDP, bfsSeed());
  if (solved.singular) return {ok:false, msg:'Sistema singular — verificar topología.'};

  // [v17/v18/v20] Si el intento directo no convergió y hay bombas de caudal fijo, de presión
  // fija y/o arcos Equipo, reintentar por continuación adaptativa (mismo patrón de step-halving
  // que computeSystemCurve, ver v15): anclar en un punto donde la red sí converge y llevar esos
  // valores de a pasos hasta su objetivo, achicando el paso si un intento falla y agrandándolo
  // si viene funcionando. Esto evita que una red localmente rígida (p.ej. válvulas muy
  // estranguladas, o el quiebre no suave del modelo de Equipo) haga fallar la convergencia
  // cuando el dato fijado está lejos del punto de operación conocido — se comprobó que esto le
  // pasa a presión fija exactamente igual que a caudal fijo (misma red rígida, ambos modos
  // fallan por igual lejos del punto ya conocido) y, ahora, también a Equipo, así que los tres
  // llevan el mismo tratamiento.
  if (!solved.ok && (fixedQPumps.length || fixedPPumps.length || equipArcs.length)) {
    // Ancla de arranque: el último valor convergido de cada bomba (si existe) suele ser un
    // punto de partida mucho más realista que un valor "neutro" — en redes muy rígidas se
    // comprobó que ni siquiera un valor neutro (caudal cero, o la cabeza del lado de succión)
    // es alcanzable siempre desde una semilla BFS genérica, así que no hay ancla universalmente
    // segura. Se intenta primero con el último valor conocido y, si no sirve, con el neutro.
    const anchorFQ = {};
    fixedQPumps.forEach(a => { anchorFQ[a.id] = (a.Q!=null && Number.isFinite(a.Q)) ? Math.abs(a.Q) : 0; });
    const anchorFP = {};
    fixedPPumps.forEach(a => {
      const toNode = findNode(a.toId);
      anchorFP[a.id] = (toNode && toNode.H!=null && Number.isFinite(toNode.H)) ? toNode.H : (Hfixed[a.fromId] ?? avgFixed);
    });

    // [v20] Primer intento de ancla: bombas ancladas, Equipo YA en su valor real (targetDP,
    // sin tocar) — es exactamente el ancla de siempre (v17/v18), antes de que existiera este
    // arreglo. Cubre el caso común de que la dificultad sea de las bombas (válvulas
    // estranguladas, saltos grandes de caudal/presión) y el Equipo no tenga nada que ver — no
    // tiene sentido forzarlo cerrado si no hace falta, y se comprobó que hacerlo sin necesidad
    // puede introducir un problema nuevo (un salto de caudal desde cero, con el Equipo recién
    // reabriéndose a mitad de camino, puede exigir un salto interno en la cabeza del propio
    // Equipo que ninguna continuación gradual puede seguir de a pasos chicos).
    let anchorStart = attemptSolve(anchorFQ, anchorFP, targetDP, bfsSeed());
    if (!anchorStart.ok) {
      fixedQPumps.forEach(a => { anchorFQ[a.id] = 0; });
      fixedPPumps.forEach(a => { anchorFP[a.id] = Hfixed[a.fromId] ?? avgFixed; });
      anchorStart = attemptSolve(anchorFQ, anchorFP, targetDP, bfsSeed());
    }

    // [v20] Si ni con las bombas ancladas alcanza, y hay arcos Equipo, recién ahí se prueba
    // TAMBIÉN forzándolos casi cerrados: a diferencia del caudal/presión de una bomba, acá SÍ
    // hay un ancla universalmente segura para el Equipo — un dp_bar bien por encima de
    // cualquier head físicamente alcanzable en esta red fuerza effDH<=0 (arco casi cerrado,
    // Q≈0), un estado siempre resoluble sin importar el resto de la topología (mismo espíritu
    // que cerrar una válvula al 0%). Se calcula en base al head máximo realmente alcanzable en
    // esta red (tanques + curva de bombas), no un número fijo arbitrario, para que sea válido
    // sin importar la escala de presiones del proyecto. Este es el camino que rescata el caso
    // real reportado: una bomba ya bien anclada, pero el Equipo recién cambiado de dp_bar lejos
    // de su punto de operación conocido.
    let anchorDP = targetDP;
    let usedEquipAnchor = false;
    if (!anchorStart.ok && equipArcs.length) {
      const fixedHeadsArr = fixedNodes.map(n => n.cota + (n.p_bar??0)*1e5/(fluid.rho*G));
      const headSpan = fixedHeadsArr.length ? (Math.max(...fixedHeadsArr) - Math.min(...fixedHeadsArr)) : 0;
      const pumpMaxH = pumpArcs.reduce((mx,a) => {
        const curveMax = (a.pumpCurve && a.pumpCurve.length) ? Math.max(...a.pumpCurve.map(p=>p.H)) : 0;
        const fpMax = (a.pumpMode==='fixedP') ? (a.fixedP_bar||0)*1e5/(fluid.rho*G) : 0;
        return Math.max(mx, curveMax, fpMax);
      }, 0);
      const anchorHeadSafe = (headSpan + pumpMaxH) * 3 + 100; // m — margen amplio, no arbitrario
      const anchorDpBarSafe = anchorHeadSafe * fluid.rho * G / 1e5;
      const anchorDPClosed = {};
      equipArcs.forEach(a => { anchorDPClosed[a.id] = anchorDpBarSafe; });

      fixedPPumps.forEach(a => {
        const toNode = findNode(a.toId);
        anchorFP[a.id] = (toNode && toNode.H!=null && Number.isFinite(toNode.H)) ? toNode.H : (Hfixed[a.fromId] ?? avgFixed);
      });
      anchorStart = attemptSolve(anchorFQ, anchorFP, anchorDPClosed, bfsSeed());
      if (!anchorStart.ok) {
        fixedQPumps.forEach(a => { anchorFQ[a.id] = 0; });
        fixedPPumps.forEach(a => { anchorFP[a.id] = Hfixed[a.fromId] ?? avgFixed; });
        anchorStart = attemptSolve(anchorFQ, anchorFP, anchorDPClosed, bfsSeed());
      }
      if (anchorStart.ok) { anchorDP = anchorDPClosed; usedEquipAnchor = true; }
    }

    // [v20] Cuando el Equipo SÍ necesitó anclarse cerrado (usedEquipAnchor) Y además hay
    // bombas de caudal/presión fija marchando, no se pueden avanzar ambos con el mismo
    // parámetro de a poco: forzar caudal a través de un Equipo que todavía está casi cerrado
    // no tiene una solución cercana razonable (la red exige un caudal que, con el Equipo tal
    // cual está en ese punto intermedio, no puede pasar). Se secuencian en dos mitades del
    // mismo barrido: primero se termina de llevar el Equipo hasta su valor real (con las
    // bombas todavía ancladas en su valor seguro, sin exigir caudal — un estado trivial de
    // resolver), y recién entonces se llevan las bombas de a poco hasta su objetivo real, con
    // el Equipo ya en su configuración final (el mismo problema de continuación de bombas ya
    // resuelto en v17/v18). Si el Equipo no necesitó anclarse (el caso más común, dp ya está
    // en su valor real desde el principio) no hace falta partir el barrido en dos.
    const hasPumpCont = fixedQPumps.length > 0 || fixedPPumps.length > 0;
    const twoPhase = hasPumpCont && usedEquipAnchor;

    if (anchorStart.ok) {
      let x = anchorStart.x, s = 0, step = 1.0;
      const minStep = 1/65536;
      let guard = 0, marched = true;
      let iterTotal = solved.iterations + anchorStart.iterations;
      let lastRes = solved.residual;
      while (s < 1 - 1e-9) {
        if (++guard > 5000) { marched = false; break; }
        const sNext = Math.min(s + step, 1);
        const sEquip = twoPhase ? Math.min(sNext/0.5, 1)        : sNext;
        const sPump  = twoPhase ? Math.max((sNext-0.5)/0.5, 0)  : sNext;
        const fq = {};
        fixedQPumps.forEach(a => {
          const a0 = anchorFQ[a.id]||0, a1 = targetFQ[a.id]||0;
          fq[a.id] = a0 + (a1-a0)*sPump;
        });
        const fp = {};
        fixedPPumps.forEach(a => {
          const a0 = anchorFP[a.id], a1 = targetFP[a.id];
          fp[a.id] = a0 + (a1-a0)*sPump;
        });
        const dp = {};
        equipArcs.forEach(a => {
          const a0 = anchorDP[a.id], a1 = targetDP[a.id];
          dp[a.id] = a0 + (a1-a0)*sEquip;
        });
        const r = attemptSolve(fq, fp, dp, x);
        iterTotal += r.iterations;
        if (r.ok) {
          s = sNext; x = r.x; lastRes = r.residual;
          step = Math.min(step*1.6, 1.0);
        } else {
          step /= 2;
          if (step < minStep) { marched = false; break; }
        }
      }
      if (marched && s >= 1 - 1e-9) solved = {ok:true, x, iterations:iterTotal, residual:lastRes};
      else solved = {ok:false, x: solved.x, iterations:iterTotal, residual: solved.residual};
    }
  }

  const x = solved.x;
  let converged = solved.ok;
  let iterations = solved.iterations;
  let lastResidual = solved.residual;

  // Extract results
  const H = {}, Q = {};
  freeNodes.forEach((n,i)=>{ H[n.id] = x[i]; });
  fixedNodes.forEach(n=>{ H[n.id] = n.cota+(n.p_bar??0)*1e5/(fluid.rho*G); });
  pumpArcs.forEach((a,i)=>{ Q[a.id] = x[NF+i]*3600; }); // m³/h
  fixedQPumps.forEach(a => { Q[a.id] = a.fixedQ_m3h||0; }); // [v17] dato del usuario, no incógnita

  // Compute Q for non-pump arcs
  for (const arc of nonPumpArcs) {
    const Hi = H[arc.fromId], Hj = H[arc.toId];
    if (Hi===undefined||Hj===undefined){Q[arc.id]=0;continue;}
    const dH_raw = Hi - Hj;
    if (arc.type==='equip') {
      const dpH_raw2 = arc.dp_bar*1e5/(fluid.rho*G);
      const dpH = Math.max(dpH_raw2, 1e-6);
      const effDH = dH_raw - dpH;
      const _D = (arc.D_mm||200)/1000, _A = Math.PI*_D*_D/4;
      const Q_REF = _A * 2.0;
      Q[arc.id] = effDH > 0 ? Q_REF * Math.sqrt(effDH/dpH) * 3600 : 0;
    } else if (arc.type==='check') {
      Q[arc.id] = dH_raw >= 0 ? pipeCalc(dH_raw, arc, fluid).Q : 0;
    } else {
      Q[arc.id] = pipeCalc(dH_raw, arc, fluid).Q;  // m³/h, signed
    }
  }

  // Compute pressures and arc details
  const nodeRes={}, arcRes={};
  for (const n of nodes) {
    nodeRes[n.id] = {
      H: H[n.id],
      P: H[n.id] !== undefined ? (H[n.id] - n.cota)*fluid.rho*G/1e5 : null
    };
  }
  for (const arc of arcs) {
    const Hi = H[arc.fromId], Hj = H[arc.toId];
    const Qa = Q[arc.id] || 0;
    let V=0, Re=0, f=0, hf=0, regime='—';
    if (arc.type!=='pump') {
      let dH = Hi-Hj;
      let calcArc = arc;
      if (arc.type==='equip') {
        // [v25 FIX] hf debe ser la caida de carga TOTAL entre los nodos del arco (Hi-Hj), la
        // misma convencion que usa cualquier otro tipo de arco (H_to = H_from - hf). Antes esta
        // linea reemplazaba dH por el EXCEDENTE por encima del umbral dp_bar (dH-dpH_eq, el
        // mismo effDH que usa el modelo interno para el caudal) y lo guardaba como hf — el
        // arco mostraba una perdida ~80x menor a la real (caso reportado: dp_bar=2 bar,
        // hf mostraba 0.31 m en vez de los ~26.45 m reales entre los nodos J3 y J4). No afecta
        // el caudal (Q ya se calculaba aparte, correctamente) ni la fisica del solver — es
        // unicamente el valor que se guarda/muestra para ese arco.
        const _D=(arc.D_mm||200)/1000, _A=Math.PI*_D*_D/4;
        V = Math.abs(Qa/3600)/_A;
        Re=0; f=0; hf=dH; regime='Equipo';
        arcRes[arc.id] = {Q:Qa, V, Re, f, hf, regime};
        continue;
      }
      if (arc.type==='check' && dH < 0) dH = 0;
      const r = pipeCalc(dH, calcArc, fluid);
      V=r.V; Re=r.Re; f=r.f; hf=r.hf; regime=r.regime;
    } else {
      const D=arc.D_mm/1000, A=Math.PI*D*D/4;
      V = Math.abs(Qa/3600)/A;
      const nP_pump = arc.nPumps||1;
      const pMode = arc.pumpMode||'curve'; // [v17/v18]
      const isFixedQ = pMode==='fixedQ';
      const isFixedP = pMode==='fixedP'; // [v18]
      if (isFixedQ || isFixedP) {
        // Caudal fijo o presión fija: en ambos modos, uno de los dos (Q o H) es un dato y el
        // otro sale de la red — pero el incremento de presión que la bomba en sí está aportando
        // siempre se puede leer igual, de las cabezas ya resueltas a ambos lados.
        hf = (Hi!==undefined && Hj!==undefined) ? (Hj - Hi) : null;
        regime = isFixedQ ? 'Bomba (caudal fijo)' : 'Bomba (presión fija)';
      } else {
        hf = pumpHead(Math.abs(Qa)/nP_pump, arc);
        regime = 'Bomba';
      }
      // Potencia hidráulica y de eje
      const P_hid_val = hf!=null ? fluid.rho * G * (Math.abs(Qa)/3600) * hf / 1000.0 : null;
      const Pe_val = pumpPower(Math.abs(Qa)/nP_pump, arc);
      const P_eje_val = Pe_val !== null ? Pe_val * nP_pump : null;
      // Runout check (solo aplica a bombas de curva — en caudal fijo/presión fija no hay curva
      // "de fábrica" que se pueda exceder)
      const runout_flag = !isFixedQ && !isFixedP && Math.abs(Qa)/nP_pump > [...arc.pumpCurve].sort((a,b)=>a.Q-b.Q).pop().Q;
      arcRes[arc.id] = {Q:Qa, V, Re, f, hf, regime, P_hid: P_hid_val, P_eje: P_eje_val, runout: runout_flag};
    }
    if (arc.type !== 'pump') arcRes[arc.id] = {Q:Qa, V, Re, f, hf, regime};
  }

  // Warn if any pump is operating beyond its rated max Q (runout) — solo aplica a modo curva
  // ([v18] pumpArcs ahora también incluye bombas de presión fija, que no tienen curva propia).
  const runoutWarnings = pumpArcs
    .filter(a => (a.pumpMode||'curve')==='curve')
    .filter(a => {
      const Qa = Math.abs(Q[a.id]||0);
      const pts = [...a.pumpCurve].sort((p1,p2)=>p1.Q-p2.Q);
      return Qa > pts[pts.length-1].Q * (a.nPumps||1);
    })
    .map(a => a.label);
  const runoutMsg = runoutWarnings.length
    ? ` ⚠️ ${runoutWarnings.join(', ')} en caudal máximo de curva — verificar diseño.`
    : '';

  return {
    ok: converged,
    msg: converged
      ? `Convergió en ${iterations} iteraciones · residuo ${lastResidual.toExponential(2)}${runoutMsg}`
      : `No convergió en ${iterations} iter. · residuo ${lastResidual.toExponential(2)}`,
    iterations, residual: lastResidual,
    H, Q, nodeRes, arcRes
  };
}
