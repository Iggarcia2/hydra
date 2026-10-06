// js/ui/paneles.js
'use strict';
/* Pestañas, listas laterales y panel de resultados redimensionable. */

// ── Sidebar panes (HTML uses id="pane-*", active = CSS class) ──
function showSBPane(name) {
  document.querySelectorAll('.sb-pane').forEach(p => {
    const active = p.id === 'pane-' + name;
    p.classList.toggle('active', active);
  });
  document.querySelectorAll('.sb-tab').forEach(t => {
    const onclick = t.getAttribute('onclick') || '';
    const m = onclick.match(/'(\w+)'/);
    if (m) t.classList.toggle('active', m[1] === name);
  });
}

// ── Results panes (HTML uses id="rpane-*") ──
function showResPane(name) {
  document.querySelectorAll('.res-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'rpane-' + name);
  });
  document.querySelectorAll('.res-tab').forEach(t => {
    const onclick = t.getAttribute('onclick') || '';
    const m = onclick.match(/'([^']+)'/);
    if (m) t.classList.toggle('active', m[1] === name);
  });
  if (name === 'chart') setTimeout(renderHQChart, 50);
}

// ── Sidebar lists (HTML uses id="nodes-list" / "arcs-list") ──
function renderSidebarLists() {
  const nl = document.getElementById('nodes-list');
  const al = document.getElementById('arcs-list');
  if (nl) nl.innerHTML = state.nodes.length === 0
    ? '<div class="empty-msg">Sin nodos.</div>'
    : state.nodes.map(n => `
      <div class="node-item${state.selectedId===n.id?' selected':''}"
           onclick="selectElement(${n.id});renderNetwork();renderProps();showSBPane('props')">
        <div class="el-icon" style="background:${NODE_COLORS[n.type]||'#60a5fa'}22;color:${NODE_COLORS[n.type]||'#60a5fa'}">⬤</div>
        <div class="el-info"><div class="el-label">${esc(n.label)}</div><div class="el-sub">${esc(n.type)}</div></div>
        <div class="el-result">${n.H!==null&&n.H!==undefined?(+n.H).toFixed(1)+' m':''}</div>
      </div>`).join('');
  if (al) al.innerHTML = state.arcs.length === 0
    ? '<div class="empty-msg">Sin arcos.</div>'
    : state.arcs.map(a => {
        const from=findNode(a.fromId),to=findNode(a.toId);
        return `
        <div class="arc-item${state.selectedId===a.id?' selected':''}"
             onclick="selectElement(${a.id});renderNetwork();renderProps();showSBPane('props')">
          <div class="el-icon" style="background:${ARC_COLORS[a.type]||'#64748b'}22;color:${ARC_COLORS[a.type]||'#64748b'}">${a.type==='pump'?'⟳':a.type==='valve'?'⊘':a.type==='equip'?'▦':'—'}</div>
          <div class="el-info"><div class="el-label">${esc(a.label)}</div><div class="el-sub">${esc(from?.label||'?')}→${esc(to?.label||'?')}</div></div>
          <div class="el-result">${a.Q!==null&&a.Q!==undefined?(+a.Q).toFixed(1)+' m³/h':''}</div>
        </div>`; }).join('');
}

// ── Resizable results panel ──
(function() {
  const handle = document.getElementById('results-resize');
  const layout = document.getElementById('main-layout');
  const area   = document.getElementById('results-area');
  if (!handle || !layout) return;
  let dragging = false, startY = 0, startH = 0;
  handle.style.cssText = 'height:4px;background:var(--border);cursor:row-resize;' +
    'grid-column:2/3;grid-row:2/3;position:absolute;top:0;left:0;right:0;z-index:50;transition:background .12s;';
  handle.addEventListener('mouseenter', ()=>handle.style.background='var(--teal)');
  handle.addEventListener('mouseleave', ()=>{ if(!dragging) handle.style.background=''; });
  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startH = area.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startY - e.clientY;  // drag up = bigger panel
    const newH = Math.max(120, Math.min(window.innerHeight*0.7, startH + delta));
    document.documentElement.style.setProperty('--results-h', newH+'px');
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    handle.style.background = '';
  });
  // Place handle between canvas and results
  const resultsArea = document.getElementById('results-area');
  if (resultsArea) resultsArea.parentNode.insertBefore(handle, resultsArea);
})();
