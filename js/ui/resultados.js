// js/ui/resultados.js
'use strict';
/* Resultados en pantalla: indicadores, tablas de nodos y arcos, lista de materiales y golpe de ariete. */

// ── renderResults (orchestrates all result sub-renderers) ──
function renderResults() {
  renderKPIs();
  renderNodeTable();
  renderArcTable();
  renderBOM();
  calcAriete();
  // Only render chart if that pane is active
  if (document.getElementById('rpane-chart')?.classList.contains('active')) renderHQChart();
}

// ── KPI strip (HTML has individual kpi-* IDs) ──
function renderKPIs() {
  if (!state.results) {
    ['kpi-status','kpi-nodes','kpi-arcs','kpi-qtot','kpi-hmin','kpi-hmax','kpi-vmax'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.textContent='—';
    });
    const st = document.getElementById('kpi-status'); if(st) st.textContent='Sin calcular';
    return;
  }
  const { ok, iterations } = state.results;
  const pumpArcs = state.arcs.filter(a=>a.type==='pump'&&a.Q!==null);
  const totalQ = pumpArcs.reduce((s,a)=>s+Math.abs(a.Q||0),0);
  const maxV   = state.arcs.reduce((m,a)=>Math.max(m,a.V||0),0);
  const Hs     = state.nodes.map(n=>n.H).filter(h=>h!==null&&h!==undefined);
  const minH   = Hs.length ? Math.min(...Hs) : null;
  const maxH   = Hs.length ? Math.max(...Hs) : null;

  const set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('kpi-status',   ok ? `✓ ${iterations} iter` : '✗ No conv.');
  set('kpi-nodes',    state.nodes.length);
  set('kpi-arcs',     state.arcs.length);
  set('kpi-qtot',     totalQ > 0 ? totalQ.toFixed(1) : '—');
  set('kpi-hmin',     minH !== null ? minH.toFixed(1) : '—');
  set('kpi-hmax',     maxH !== null ? maxH.toFixed(1) : '—');
  set('kpi-vmax',     maxV > 0 ? maxV.toFixed(2) : '—');

  // Color status KPI
  const strip = document.getElementById('kpi-strip');
  if (strip) {
    strip.querySelectorAll('.kpi').forEach((el,i)=>{
      if (i===0) { el.className = 'kpi ' + (ok?'ok':'bad'); }
    });
  }
  const sub = document.getElementById('kpi-qtot-sub'); if(sub) sub.textContent = 'm³/h';
  const hsub = document.getElementById('kpi-hmin-sub'); if(hsub) hsub.textContent = 'm';

  // Q_required pass/fail
  const qreqBox = document.getElementById('q-req-check');
  if (qreqBox) {
    const qreq = fluid.q_required || 0;
    const pump0 = state.arcs.find(a=>a.type==='pump'&&a.Q!==null);
    const qSys  = pump0 ? Math.abs(pump0.Q||0)*(pump0.nPumps||1) : totalQ;
    if (qreq > 0 && ok && qSys > 0) {
      const meets = qSys >= qreq, margin = qSys - qreq;
      qreqBox.style.display = '';
      const bc = meets?'#4ade80':'#f87171';
      qreqBox.innerHTML = '<div style="padding:7px 12px;border-radius:4px;font-size:11px;font-weight:600;'
        +'border:1px solid '+bc+';background:'+(meets?'rgba(74,222,128,.1)':'rgba(248,113,113,.1)')+';'
        +'color:'+bc+';display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
        +'<span>'+(meets?'✓ CUMPLE':'✗ NO CUMPLE')+'</span>'
        +'<span style="font-weight:400;color:#e4e4e7">Q op: <b>'+qSys.toFixed(1)+'</b> m³/h</span>'
        +'<span style="font-weight:400;color:#e4e4e7">Q req: <b>'+qreq.toFixed(1)+'</b> m³/h</span>'
        +'<span>'+(margin>=0?'+':'')+margin.toFixed(1)+' m³/h</span>'
        +'</div>';
    } else { qreqBox.style.display='none'; }
  }
}

// ── Result tables ──
function renderNodeTable() {
  const tbody = document.querySelector('#nodes-res-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.nodes.map(n=>`<tr>
    <td>${n.id}</td><td>${esc(n.label)}</td>
    <td><span class="tag">${esc(n.type)}</span></td>
    <td class="num">${n.cota??0}</td>
    <td class="num ${n.H!==null&&n.H<0?'bad-t':''}">${n.H!==null&&n.H!==undefined?(+n.H).toFixed(2):'-'}</td>
    <td class="num">${n.P!==null&&n.P!==undefined?(+n.P).toFixed(3):'-'}</td>
    <td class="num">${n.demand||0}</td>
  </tr>`).join('');
}

function renderArcTable() {
  const tbody = document.querySelector('#arcs-res-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.arcs.map(a=>{
    const from=findNode(a.fromId),to=findNode(a.toId);
    const vClass = !a.V?'':a.V>3?'bad-t':a.V>2?'warn-t':'ok-t';
    return `<tr>
      <td>${a.id}</td><td>${esc(a.label)}</td>
      <td><span class="tag ${a.type==='pump'?'blue':a.type==='valve'?'red':a.type==='equip'?'amber':''}">${esc(a.type)}</span></td>
      <td>${esc(from?.label||'?')} → ${esc(to?.label||'?')}</td>
      <td class="num">${a.Q!==null&&a.Q!==undefined?(+a.Q).toFixed(1):'-'}</td>
      <td class="num ${vClass}">${a.V!==null&&a.V!==undefined?(+a.V).toFixed(2):'-'}</td>
      <td class="num">${a.hf!==null&&a.hf!==undefined?(+a.hf).toFixed(2):'-'}</td>
      <td class="num">${a.Re!==null&&a.Re!==undefined?Math.round(a.Re):'-'}</td>
      <td><span class="tag">${esc(a.regime||'—')}</span></td>
      <td class="num">${a.type==='pump'&&a.P_hid!=null?a.P_hid.toFixed(2):'-'}</td>
      <td class="num" style="${a.type==='pump'&&a.P_eje!=null?'color:var(--amber)':''}">${a.type==='pump'&&a.P_eje!=null?a.P_eje.toFixed(2):'-'}</td>
    </tr>`;}).join('');
}

function renderBOM() {
  const container = document.getElementById('bom-content');
  if (!container) return;

  const pipeGroups = {};
  const pumpList = [], valveList = [], equipList = [];

  for (const arc of state.arcs) {
    if (arc.type === 'pipe' || arc.type === 'check') {
      const key = `D${arc.D_mm}_e${arc.eps_mm}`;
      if (!pipeGroups[key]) pipeGroups[key] = { D_mm: arc.D_mm, eps_mm: arc.eps_mm, totalL: 0, count: 0 };
      pipeGroups[key].totalL += arc.L_m || 0;
      pipeGroups[key].count++;
    } else if (arc.type === 'pump')  pumpList.push(arc);
    else if (arc.type === 'valve') valveList.push(arc);
    else if (arc.type === 'equip') equipList.push(arc);
  }

  const matName = eps => (MATERIALS.find(m => Math.abs(m.eps - eps) < 1e-5)?.label || `ε=${eps} mm`);
  const dnLabel = D  => (DN_LIST.find(d => d.D && Math.abs(d.D - D) < 0.5)?.label || `${D} mm`);
  const fittingsDetail = arc => {
    if (!arc.fitQty) return '—';
    const parts = arc.fitQty.map((q,i)=>{
      if (q<=0) return null;
      const f = FITTINGS[i];
      const openTag = f.curve ? ` @ ${esc(arc.fitOpen?.[i] ?? 100)}% apert.` : '';
      return `${esc(q)}× ${f.name}${openTag}`;
    }).filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  };

  let html = '';

  // ─ Tuberías
  html += `<div style="margin-bottom:16px">
    <div class="sb-hdr" style="margin-bottom:8px">TUBERÍAS</div>
    <table class="res"><thead><tr>
      <th>Diámetro</th><th>Material</th><th class="num">ε [mm]</th>
      <th class="num">Long. total [m]</th><th class="num">Tramos</th>
    </tr></thead><tbody>`;
  const pipeVals = Object.values(pipeGroups);
  if (!pipeVals.length) {
    html += `<tr><td colspan="5" style="color:var(--faint);text-align:center;padding:12px">Sin tuberías en la red</td></tr>`;
  } else {
    for (const g of pipeVals) {
      html += `<tr><td>${dnLabel(g.D_mm)}</td><td>${matName(g.eps_mm)}</td>
        <td class="num">${g.eps_mm}</td><td class="num">${g.totalL.toFixed(1)}</td><td class="num">${g.count}</td></tr>`;
    }
  }
  html += `</tbody></table></div>`;

  // ─ Accesorios
  const pipesWithFit = state.arcs.filter(a =>
    (a.type==='pipe'||a.type==='check') && a.fitQty && a.fitQty.some(q=>q>0));
  if (pipesWithFit.length) {
    html += `<div style="margin-bottom:16px">
      <div class="sb-hdr" style="margin-bottom:8px">ACCESORIOS</div>
      <table class="res"><thead><tr><th>Tramo</th><th class="num">K total</th><th>Detalle</th></tr></thead><tbody>`;
    for (const a of pipesWithFit) {
      const K = arcTotalK(a);
      html += `<tr><td>${esc(a.label)}</td><td class="num">${fmtK(K)}</td><td style="font-size:10px;max-width:220px">${fittingsDetail(a)}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ─ Bombas
  if (pumpList.length) {
    html += `<div style="margin-bottom:16px">
      <div class="sb-hdr" style="margin-bottom:8px">BOMBAS</div>
      <table class="res"><thead><tr>
        <th>Nombre</th><th class="num">Paralelo</th>
        <th class="num">Q op [m³/h]</th><th class="num">H op [m]</th>
        <th class="num">P hid [kW]</th><th class="num">P eje [kW]</th>
      </tr></thead><tbody>`;
    for (const a of pumpList) {
      const nP = a.nPumps||1;
      const qop = a.Q != null ? Math.abs(a.Q) : null;
      const hop = a.hf!=null ? a.hf : null; // [v17] ya resuelto (curva o caudal fijo), no recalcular
      html += `<tr><td>${esc(a.label)}</td><td class="num">${esc(nP)}</td>
        <td class="num">${qop!=null?qop.toFixed(1):'—'}</td>
        <td class="num">${hop!=null?hop.toFixed(1):'—'}</td>
        <td class="num">${a.P_hid!=null?a.P_hid.toFixed(2):'—'}</td>
        <td class="num">${a.P_eje!=null?a.P_eje.toFixed(2):'—'}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ─ Válvulas
  if (valveList.length) {
    html += `<div style="margin-bottom:16px">
      <div class="sb-hdr" style="margin-bottom:8px">VÁLVULAS</div>
      <table class="res"><thead><tr><th>Nombre</th><th>Tipo</th><th>De → A</th><th class="num">Q [m³/h]</th></tr></thead><tbody>`;
    for (const a of valveList) {
      const fr = findNode(a.fromId), to2 = findNode(a.toId);
      html += `<tr><td>${esc(a.label)}</td><td>${esc(a.valveType||'—')}</td><td>${esc(fr?.label||'?')}→${esc(to2?.label||'?')}</td><td class="num">${a.Q!=null?Math.abs(a.Q).toFixed(1):'—'}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ─ Equipos
  if (equipList.length) {
    html += `<div style="margin-bottom:16px">
      <div class="sb-hdr" style="margin-bottom:8px">EQUIPOS DE PROCESO</div>
      <table class="res"><thead><tr><th>Nombre</th><th class="num">ΔP [bar]</th><th class="num">Q [m³/h]</th><th class="num">V [m/s]</th></tr></thead><tbody>`;
    for (const a of equipList) {
      html += `<tr><td>${esc(a.label)}</td><td class="num">${esc(a.dp_bar)}</td><td class="num">${a.Q!=null?Math.abs(a.Q).toFixed(1):'—'}</td><td class="num">${a.V!=null?a.V.toFixed(2):'—'}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  if (!state.arcs.length) {
    html = `<div class="empty-msg">Agrega elementos a la red para ver la lista de materiales.</div>`;
  }

  container.innerHTML = html;
}

function calcAriete() {
  const container = document.getElementById('ariete-content');
  if (!container) return;

  const pipArcs = state.arcs.filter(a => a.type === 'pipe' || a.type === 'check');
  if (!pipArcs.length) {
    container.innerHTML = `<div class="empty-msg">Agrega tuberías y calculá la red para ver el análisis de ariete.</div>`;
    return;
  }
  if (!state.results?.ok) {
    container.innerHTML = `<div class="empty-msg">Calculá la red primero para obtener velocidades de flujo.</div>`;
    return;
  }

  // [repo] El cálculo de cada tramo vive en js/nucleo/ariete.js; acá solo se arma la tabla.
  const rows = [];
  for (const arc of pipArcs) {
    // Presión de operación en el nodo origen
    const fromNode = findNode(arc.fromId);
    const P_op_bar = fromNode?.P != null ? Math.abs(+fromNode.P) : 0;
    rows.push(calcArieteTramo(arc, fluid, P_op_bar));
  }

  let html = `
  <div style="margin-bottom:10px;padding:8px;background:var(--bg3);border-left:3px solid #f59e0b;border-radius:2px;font-size:10px;color:var(--faint)">
    <b style="color:#f59e0b">⚠ Método Joukowsky</b> — Cierre instantáneo de válvula. Resultado conservador (máxima sobrepresión posible).<br>
    Celeridad calculada con fluido actual (ρ=${fluid.rho.toFixed(0)} kg/m³, K≈${(K_WATER/1e9).toFixed(1)} GPa) y material de la tubería.
  </div>
  <table class="res"><thead><tr>
    <th>Tramo</th><th class="num">V₀ [m/s]</th><th class="num">a [m/s]</th>
    <th class="num">Tc [s]</th><th class="num">ΔP [bar]</th><th class="num">ΔH [m]</th>
    <th class="num">P máx [bar]</th><th>Riesgo</th>
  </tr></thead><tbody>`;

  for (const r of rows) {
    html += `<tr>
      <td>${esc(r.arc.label)}</td>
      <td class="num">${r.V0.toFixed(3)}</td>
      <td class="num">${r.a.toFixed(0)}</td>
      <td class="num">${r.Tc.toFixed(2)}</td>
      <td class="num ${r.dP>10e5?'red':''}"><b>${(r.dP/1e5).toFixed(2)}</b></td>
      <td class="num">${r.dH.toFixed(1)}</td>
      <td class="num">${r.P_max_bar.toFixed(2)}</td>
      <td>${r.risk}</td>
    </tr>`;
  }
  html += `</tbody></table>
  <div style="margin-top:8px;font-size:10px;color:var(--faint)">
    Para tuberías sin espesor de pared definido se usa e ≈ 6% × D (aprox. Sch40/SDR17).
    Podés definir el espesor exacto en las propiedades del tramo (<i>Espesor pared [mm]</i>).
  </div>`;

  container.innerHTML = html;
}
