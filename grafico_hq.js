// js/ui/grafico_hq.js
'use strict';
/* Gráfico H-Q con curva del sistema (canvas) y redibujado al cambiar el tamaño del panel. */

// ── H-Q chart with system curve ──
// ── Chart tab state ──
let _chartTab = 'all';
// [v18] Cache de la curva de sistema por bomba (id de arco → puntos), poblada una vez por cada
// solve exitoso en runSolver() — computeSystemCurve() resuelve la red varias veces por bomba,
// así que no conviene recalcularla en cada redibujado de renderHQChart() (redimensionar la
// ventana, cambiar de pestaña, etc.). Se vuelve a poblar entera en cada solve; se vacía si falla.
let _sysCurveCache = {};

function renderHQChart() {
  const canvas = document.getElementById('hq-chart');
  if (!canvas) return;
  const pumpArcs = state.arcs.filter(a => a.type === 'pump');

  // ── Build tab bar ──
  const tabBar = document.getElementById('chart-tabs-bar');
  if (tabBar) {
    if (_chartTab !== 'all' && !pumpArcs.find(a => String(a.id) === _chartTab)) _chartTab = 'all';
    tabBar.innerHTML = '';
    const mkTab = (id, label, active) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'chart-tab-btn' + (active ? ' active' : '');
      btn.onclick = () => { _chartTab = id; renderHQChart(); };
      tabBar.appendChild(btn);
    };
    mkTab('all', 'Todas', _chartTab === 'all');
    pumpArcs.forEach(a => mkTab(String(a.id), a.label || ('B' + a.id), _chartTab === String(a.id)));
  }

  const ctx = canvas.getContext('2d');
  const W = canvas.width  = canvas.offsetWidth  || 380;
  const H = canvas.height = canvas.offsetHeight || 160;
  ctx.clearRect(0, 0, W, H);

  if (pumpArcs.length === 0) {
    ctx.fillStyle = '#52525b'; ctx.font = '11px IBM Plex Mono'; ctx.textAlign = 'center';
    ctx.fillText('Agregá una bomba para ver la curva H-Q', W/2, H/2); return;
  }

  // [v18] Se muestran los tres modos de bomba — ya no se filtra por tener curva de catálogo.
  // La curva de sistema (misma función rigurosa que usa el PDF, cacheada en runSolver) se puede
  // graficar para cualquier bomba, tenga o no curva propia.
  const pumpsToShow = _chartTab === 'all'
    ? pumpArcs
    : pumpArcs.filter(a => String(a.id) === _chartTab);

  const plotData = pumpsToShow.map(pump => {
    const nP = pump.nPumps || 1;
    const mode = pump.pumpMode || 'curve';
    const ownCurve = mode === 'curve' && pump.pumpCurve && pump.pumpCurve.length >= 2
      ? [...pump.pumpCurve].sort((a,b) => a.Q - b.Q).map(p => ({Q: p.Q * nP, H: p.H}))
      : null;
    const sysCurve = (_sysCurveCache[pump.id] || []).filter(p => Number.isFinite(p.H));
    const qop = pump.Q  != null ? Math.abs(pump.Q) : null;
    const hop = pump.hf != null ? pump.hf : null;
    return {pump, mode, ownCurve, sysCurve, qop, hop};
  });

  const anyPlottable = plotData.some(d =>
    (d.ownCurve && d.ownCurve.length >= 2) || d.sysCurve.length >= 2 || (d.qop != null && d.hop != null));
  if (!anyPlottable) {
    ctx.fillStyle = '#52525b'; ctx.font = '11px IBM Plex Mono'; ctx.textAlign = 'center';
    ctx.fillText('Calculá la red para ver la curva del sistema', W/2, H/2); return;
  }

  // Compute global axis ranges from all visible pumps
  let maxQ = 0, maxH = 0, maxPwr = 0;
  plotData.forEach(({pump, ownCurve, sysCurve, qop, hop}) => {
    const nP = pump.nPumps || 1;
    if (ownCurve && ownCurve.length) {
      maxQ = Math.max(maxQ, ownCurve[ownCurve.length-1].Q);
      maxH = Math.max(maxH, ...ownCurve.map(p => p.H));
    }
    if (sysCurve.length) {
      maxQ = Math.max(maxQ, ...sysCurve.map(p => p.Q));
      maxH = Math.max(maxH, ...sysCurve.map(p => p.H));
    }
    if (qop != null) maxQ = Math.max(maxQ, qop);
    if (hop != null) maxH = Math.max(maxH, hop);
    if (pump.powerCurve && pump.powerCurve.length >= 2)
      maxPwr = Math.max(maxPwr, ...pump.powerCurve.map(p => p.P * nP));
  });
  if (maxQ <= 0) maxQ = 1;
  if (maxH <= 0) maxH = 1;
  maxQ *= 1.1; maxH *= 1.25;
  const hasPwr = pumpsToShow.length === 1 && maxPwr > 0;
  maxPwr = hasPwr ? maxPwr * 1.2 : 0;

  const pad = {l:38, r: hasPwr ? 44 : 16, t:16, b:28};
  const px = q => pad.l + (q / maxQ) * (W - pad.l - pad.r);
  const py = h => pad.t + (1 - h / maxH) * (H - pad.t - pad.b);

  // Grid
  ctx.strokeStyle = '#27272a'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + i * (H - pad.t - pad.b) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#52525b'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'right';
    ctx.fillText((maxH * (1 - i/4)).toFixed(0), pad.l - 3, y + 3);
  }
  for (let i = 0; i <= 4; i++) {
    const x = pad.l + i * (W - pad.l - pad.r) / 4;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    ctx.fillStyle = '#52525b'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'center';
    ctx.fillText((maxQ * i/4).toFixed(0), x, H - pad.b + 12);
  }

  // Q_required vertical line
  if ((fluid.q_required || 0) > 0) {
    const xqr = px(fluid.q_required);
    if (xqr >= pad.l && xqr <= W - pad.r) {
      ctx.strokeStyle = '#f87171'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(xqr, pad.t); ctx.lineTo(xqr, H - pad.b); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f87171'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'left';
      ctx.fillText('Q req: ' + fluid.q_required + ' m³/h', Math.min(xqr+3, W-pad.r-90), pad.t+12);
    }
  }

  const PUMP_COLORS = ['#a78bfa','#34d399','#60a5fa','#f472b6','#fb923c','#facc15','#38bdf8'];

  // Draw each pump
  plotData.forEach(({pump, ownCurve, sysCurve, qop, hop}, idx) => {
    const color = PUMP_COLORS[idx % PUMP_COLORS.length];

    // [v18] Curva de sistema real (numérica, la misma que arma el PDF) — antes acá se dibujaba
    // una aproximación analítica; ahora es la curva de verdad, para los tres modos de bomba.
    if (sysCurve.length >= 2) {
      ctx.strokeStyle = color + '55'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]); ctx.beginPath();
      let started = false;
      sysCurve.forEach(p => {
        const yc = py(Math.max(p.H, 0));
        started ? ctx.lineTo(px(p.Q), yc) : ctx.moveTo(px(p.Q), yc);
        started = true;
      });
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Curva propia de catálogo — solo existe en modo curva
    if (ownCurve && ownCurve.length) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.beginPath();
      ownCurve.forEach((p, i) => i===0 ? ctx.moveTo(px(p.Q), py(p.H)) : ctx.lineTo(px(p.Q), py(p.H)));
      ctx.stroke();
    }

    // [v18] Punto de operación / cruce — en modo curva es la intersección con la curva de
    // catálogo; en caudal fijo o presión fija es el único resultado (no hay curva propia para
    // cruzar), así que queda como punto marcado sobre la curva de sistema.
    if (qop != null && hop != null) {
      const pxop = px(qop), pyop = py(hop);
      ctx.beginPath(); ctx.arc(pxop, pyop, 7, 0, 2*Math.PI);
      ctx.fillStyle = color + '33'; ctx.fill();
      ctx.beginPath(); ctx.arc(pxop, pyop, 4, 0, 2*Math.PI);
      ctx.fillStyle = ownCurve ? color : '#e2e8f0'; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#0b0c10'; ctx.stroke();
      // Valores del punto, visibles cuando se está mirando una sola bomba (pestaña de esa
      // bomba) — en caudal fijo/presión fija es el dato principal que pidió ver el usuario.
      if (pumpsToShow.length === 1) {
        const lx2 = pxop + 10, ly2 = pyop - 6;
        ctx.fillStyle = color; ctx.font = 'bold 10px IBM Plex Mono'; ctx.textAlign = 'left';
        ctx.fillText(qop.toFixed(1) + ' m³/h', lx2, ly2);
        ctx.fillStyle = '#a1a1aa'; ctx.font = '9px IBM Plex Mono';
        ctx.fillText(hop.toFixed(2) + ' m', lx2, ly2 + 11);
      }
    }
  });

  // P-Q overlay (single pump only) — sin cambios, independiente del modo de la bomba
  if (pumpsToShow.length === 1 && hasPwr) {
    const pump = pumpsToShow[0];
    const nP = pump.nPumps || 1;
    const pCurve = [...pump.powerCurve].sort((a,b) => a.Q - b.Q);
    const scp = pCurve.map(p => ({Q: p.Q * nP, P: p.P * nP}));
    const pp2 = v => pad.t + (1 - v / maxPwr) * (H - pad.t - pad.b);
    ctx.fillStyle = 'rgba(245,158,11,0.45)'; ctx.font = '8px IBM Plex Mono'; ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const pv = maxPwr * (1 - i/3);
      ctx.fillText(pv.toFixed(0) + 'kW', W - pad.r + 2, pp2(pv) + 3);
    }
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([3,2]); ctx.beginPath();
    scp.forEach((p, i) => i===0 ? ctx.moveTo(px(p.Q), pp2(p.P)) : ctx.lineTo(px(p.Q), pp2(p.P)));
    ctx.stroke(); ctx.setLineDash([]);
    if (pump.P_eje != null) {
      const qop2 = Math.abs(pump.Q||0) * nP;
      ctx.beginPath(); ctx.arc(px(qop2), pp2(pump.P_eje), 4, 0, 2*Math.PI);
      ctx.fillStyle = '#f59e0b'; ctx.fill();
    }
    const lxp = W - pad.r - 2;
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([3,2]); ctx.beginPath();
    ctx.moveTo(lxp-35, pad.t+30); ctx.lineTo(lxp-5, pad.t+30); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'right'; ctx.font = '9px IBM Plex Mono';
    ctx.fillText('P [kW]', lxp, pad.t+33);
  }

  // Legend
  if (pumpsToShow.length > 1) {
    let legY = pad.t + 6;
    pumpsToShow.forEach((pump, idx) => {
      const color = PUMP_COLORS[idx % PUMP_COLORS.length];
      const lx = W - pad.r - 2;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath();
      ctx.moveTo(lx-30, legY); ctx.lineTo(lx-5, legY); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'right';
      ctx.fillText(pump.label || ('B'+pump.id), lx, legY + 3);
      legY += 13;
    });
  } else if (pumpsToShow.length === 1) {
    const {mode, ownCurve, sysCurve, qop} = plotData[0];
    const color = PUMP_COLORS[0];
    const lx = W - pad.r - 2;
    let legY = pad.t + 6;
    if (ownCurve && ownCurve.length) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath();
      ctx.moveTo(lx-35, legY); ctx.lineTo(lx-5, legY); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'right';
      ctx.fillText('Bomba', lx, legY + 3);
      legY += 12;
    }
    if (sysCurve.length >= 2) {
      ctx.strokeStyle = color + '55'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]); ctx.beginPath();
      ctx.moveTo(lx-35, legY); ctx.lineTo(lx-5, legY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color + 'aa'; ctx.textAlign = 'right';
      ctx.fillText('Sistema', lx, legY + 3);
      legY += 12;
    }
    if (qop != null) {
      ctx.beginPath(); ctx.arc(lx-20, legY+1, 3, 0, 2*Math.PI);
      ctx.fillStyle = ownCurve ? color : '#e2e8f0'; ctx.fill();
      ctx.fillStyle = '#a1a1aa'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'right';
      ctx.fillText(mode === 'curve' ? 'Cruce' : 'Resultado', lx, legY + 4);
    }
  }

  // Axes
  ctx.fillStyle = '#52525b'; ctx.font = '9px IBM Plex Mono'; ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.fillText('Q [m³/h]', W/2, H - 2);
  ctx.save(); ctx.translate(11, H/2); ctx.rotate(-Math.PI/2); ctx.fillText('H [m]', 0, 0); ctx.restore();
}

// ── ResizeObserver: redraw H-Q chart when panel size changes ──
(function(){
  const chartPane = document.getElementById('rpane-chart');
  if (!chartPane || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    if (chartPane.classList.contains('active')) renderHQChart();
  }).observe(chartPane);
})();
