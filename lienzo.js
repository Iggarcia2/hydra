// js/ui/lienzo.js
'use strict';
/* Lienzo SVG: zoom, desplazamiento, vista isométrica, dibujo de la red, selección, arrastre y atajos de teclado. */

// ══════════════════════════════════════════════════════════════════════════════
// CANVAS — SVG rendering + interaction
// ══════════════════════════════════════════════════════════════════════════════
const svg = document.getElementById('net-svg');
const root = document.getElementById('canvas-root');
const canvasArea = document.getElementById('canvas-area');

// ── Coordinate transforms ──
function svgPt(e) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - state.pan.x) / state.zoom,
    y: (e.clientY - rect.top  - state.pan.y) / state.zoom
  };
}
function applyTransform() {
  root.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
}

// ── Zoom ──
function zoomBy(factor, cx, cy) {
  const rect = svg.getBoundingClientRect();
  cx = cx ?? rect.width/2; cy = cy ?? rect.height/2;
  const wx = (cx - state.pan.x)/state.zoom;
  const wy = (cy - state.pan.y)/state.zoom;
  state.zoom = Math.max(0.05, Math.min(20, state.zoom*factor));
  state.pan.x = cx - wx*state.zoom;
  state.pan.y = cy - wy*state.zoom;
  applyTransform();
}
function zoomFit() {
  if (state.nodes.length === 0) { state.pan={x:0,y:0}; state.zoom=1; applyTransform(); return; }
  
  let xs, ys;
  if (window.isIsoView) {
    let cx = state.nodes.reduce((s,n)=>s+n.x,0)/state.nodes.length;
    let cy = state.nodes.reduce((s,n)=>s+n.y,0)/state.nodes.length;
    const cosI = Math.cos(Math.PI/6), sinI = Math.sin(Math.PI/6);
    xs = state.nodes.map(n => cx + (n.x - cx - (n.y - cy)) * cosI);
    ys = state.nodes.map(n => cy + (n.x - cx + (n.y - cy)) * sinI - (n.cota||0) * 8);
  } else {
    xs = state.nodes.map(n=>n.x);
    ys = state.nodes.map(n=>n.y);
  }

  const minX=Math.min(...xs)-60, minY=Math.min(...ys)-60;
  const maxX=Math.max(...xs)+60, maxY=Math.max(...ys)+60;
  const rect = svg.getBoundingClientRect();
  const zx = rect.width/(maxX-minX), zy = rect.height/(maxY-minY);
  state.zoom = Math.max(0.05, Math.min(10, Math.min(zx,zy)*0.9));
  state.pan.x = rect.width/2  - (minX+maxX)/2*state.zoom;
  state.pan.y = rect.height/2 - (minY+maxY)/2*state.zoom;
  applyTransform();
}

svg.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(e.deltaY<0?1.12:0.89, e.clientX-svg.getBoundingClientRect().left, e.clientY-svg.getBoundingClientRect().top);
}, {passive:false});

// ── Colors by result ──
function arcColor(arc) {
  const by = document.getElementById('color-by').value;
  if (by==='type') return ARC_COLORS[arc.type] || '#64748b';
  if (!arc.V && arc.V!==0) return '#3f3f46';
  if (by==='velocity') {
    const v = arc.V||0;
    if (v>3) return '#f87171';
    if (v>2) return '#f59e0b';
    if (v>0.5) return '#2dd4bf';
    return '#64748b';
  }
  if (by==='headloss') {
    const h = Math.abs(arc.hf||0);
    if (h>5) return '#f87171'; if (h>2) return '#f59e0b'; return '#2dd4bf';
  }
  if (by==='flow') {
    const q = Math.abs(arc.Q||0);
    if (q>500) return '#f87171'; if (q>200) return '#f59e0b';
    if (q>50) return '#2dd4bf'; return '#64748b';
  }
  return ARC_COLORS[arc.type];
}
function nodeColor(node) {
  if (!node.H && node.H!==0) return NODE_COLORS[node.type]||'#60a5fa';
  return NODE_COLORS[node.type]||'#60a5fa';
}

window.isIsoView = false;
function toggleIsoView() {
  window.isIsoView = !window.isIsoView;
  const btn = document.getElementById('btn-iso');
  if (btn) btn.classList.toggle('active', window.isIsoView);
  if (window.isIsoView && (state.mode === 'arc' || state.mode === 'node')) {
    setMode('select');
  }
  renderNetwork();
  setTimeout(zoomFit, 50);
}

// ── Render full network ──
function renderNetwork() {
  root.innerHTML = '';
  const labelArc  = document.getElementById('arc-label').value;
  const labelNode = document.getElementById('node-label').value;

  let cx=0, cy=0;
  if (state.nodes.length) {
    cx = state.nodes.reduce((s,n)=>s+n.x,0)/state.nodes.length;
    cy = state.nodes.reduce((s,n)=>s+n.y,0)/state.nodes.length;
  }
  const isoAng = Math.PI/6, cosI = Math.cos(isoAng), sinI = Math.sin(isoAng);
  
  function p(nx, ny, cota) {
    if (!window.isIsoView) return { x: nx, y: ny, bx: nx, by: ny, z: cota||0 };
    const dx = nx - cx, dy = ny - cy;
    const z = cota || 0;
    const ix = (dx - dy) * cosI;
    const iy = (dx + dy) * sinI;
    return {
      x: cx + ix,
      y: cy + iy - z * 8, // 8px por metro de cota
      bx: cx + ix,
      by: cy + iy,
      z: z
    };
  }

  // Draw arcs first (below nodes)
  for (const arc of state.arcs) {
    const fromN = findNode(arc.fromId), toN = findNode(arc.toId);
    if (!fromN||!toN) continue;
    
    const from = p(fromN.x, fromN.y, fromN.cota);
    const to = p(toN.x, toN.y, toN.cota);
    
    const sel = state.selectedId === arc.id;
    const color = arcColor(arc);
    const mx=(from.x+to.x)/2, my=(from.y+to.y)/2;
    const dx=to.x-from.x, dy=to.y-from.y;
    const len = Math.sqrt(dx*dx+dy*dy) || 0.001;
    const strokeW = sel ? 3.5 : (arc.type==='pump'?3:2.5);
    const marker = arc.type==='pump'?'url(#arrow-violet)':arc.type==='equip'?'url(#arrow-amber)':'url(#arrow-teal)';

    let g = `<g class="arc-el" data-id="${arc.id}" style="cursor:pointer">`;

    if (arc.type === 'pump') {
      const cpx = mx - dy*0.2, cpy = my + dx*0.2;
      g += `<path d="M${from.x},${from.y} Q${cpx},${cpy} ${to.x},${to.y}"
        fill="none" stroke="${color}" stroke-width="${strokeW}" opacity="${sel?.95:.65}"
        marker-end="${marker}"${sel?' filter="url(#glow)"':''}/>`;
      g += `<circle cx="${cpx}" cy="${cpy}" r="11" fill="#0d0d0f" stroke="${color}" stroke-width="1.5" opacity=".85"/>`;
      g += `<text x="${cpx}" y="${cpy+4}" text-anchor="middle" fill="${color}" font-size="11" font-family="IBM Plex Mono" font-weight="600">⟳</text>`;
      const ux=dx/len, uy=dy/len;
      g += `<text x="${from.x+ux*26}" y="${from.y+uy*26-5}" text-anchor="middle" fill="${color}" font-size="8" font-family="IBM Plex Mono" opacity=".55">IN</text>`;
      g += `<text x="${to.x-ux*26}" y="${to.y-uy*26-5}" text-anchor="middle" fill="${color}" font-size="8" font-family="IBM Plex Mono" opacity=".55">OUT</text>`;
    } else if (arc.type === 'equip') {
      g += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
        stroke="${color}" stroke-width="${strokeW}" opacity="${sel?.95:.6}"
        stroke-dasharray="8 3" marker-end="${marker}"${sel?' filter="url(#glow)"':''}/>`;
      g += `<rect x="${mx-12}" y="${my-7}" width="24" height="14" rx="2"
        fill="#0d0d0f" stroke="${color}" stroke-width="1.5" opacity=".9"/>`;
      g += `<text x="${mx}" y="${my+4}" text-anchor="middle" fill="${color}" font-size="9" font-family="IBM Plex Mono">HX</text>`;
    } else if (arc.type === 'valve') {
      g += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
        stroke="${color}" stroke-width="${strokeW}" opacity="${sel?.95:.6}"
        marker-end="url(#arrow-teal)"${sel?' filter="url(#glow)"':''}/>`;
      const nx=dy/len, ny=-dx/len;
      g += `<polygon points="${mx+nx*8},${my+ny*8} ${mx-nx*8},${my-ny*8} ${mx+dx/len*8},${my+dy/len*8}"
        fill="${color}" opacity=".7"/>`;
    } else {
      const flowRev = arc.Q !== null && arc.Q < -0.5;
      const mEnd   = flowRev ? 'none'                 : 'url(#arrow-teal)';
      const mStart = flowRev ? 'url(#arrow-teal-rev)' : 'none';
      const lineColor = flowRev ? '#f59e0b' : color;
      g += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
        stroke="${lineColor}" stroke-width="${strokeW}" opacity="${sel?.95:.65}"
        marker-end="${mEnd}" marker-start="${mStart}"${sel?' filter="url(#glow-sm)"':''}/>`;
    }

    g += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
      stroke="transparent" stroke-width="14"/>`;

    if (sel) g += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
      stroke="${color}" stroke-width="5" opacity=".2"/>`;

    if (labelArc !== 'none' && len > 40) {
      const flowRev2 = arc.Q !== null && arc.Q < -0.5;
      const lblColor = flowRev2 ? '#f59e0b' : color;
      let lbl = arc.label;
      if (labelArc==='Q' && arc.Q!==null) lbl = `${Math.abs(arc.Q||0).toFixed(1)} m³/h`;
      else if (labelArc==='V' && arc.V!==null) lbl = `${(arc.V||0).toFixed(2)} m/s`;
      else if (labelArc==='hf' && arc.hf!==null) lbl = `${Math.abs(arc.hf||0).toFixed(2)} m`;
      else if (labelArc==='name') lbl = arc.label;
      const angle = Math.atan2(dy,dx)*180/Math.PI;
      const flip = Math.abs(angle)>90;
      g += `<text x="${mx}" y="${my-8}" text-anchor="middle" fill="${lblColor}" font-size="9.5"
        font-family="IBM Plex Mono" opacity=".9"
        transform="rotate(${flip?angle+180:angle},${mx},${my})">${esc(lbl)}</text>`;
    }
    g += '</g>';
    root.innerHTML += g;
  }

  if (state.mode==='arc' && state.arcFrom && !window.isIsoView) {
    const fromN = findNode(state.arcFrom);
    if (fromN && state._arcMousePos) {
      root.innerHTML += `<line x1="${fromN.x}" y1="${fromN.y}" x2="${state._arcMousePos.x}" y2="${state._arcMousePos.y}"
        stroke="#2dd4bf" stroke-width="2" stroke-dasharray="6 3" opacity=".6" pointer-events="none"/>`;
    }
  }

  // Draw nodes (sorted by Y in ISO mode for proper z-indexing)
  const renderNodes = [...state.nodes].map(n => ({ n, pt: p(n.x, n.y, n.cota) }));
  if (window.isIsoView) renderNodes.sort((a,b) => a.pt.y - b.pt.y);

  for (const item of renderNodes) {
    const node = item.n;
    const pos = item.pt;
    const sel = state.selectedId === node.id;
    const color = nodeColor(node);
    let g = `<g class="node-el" data-id="${node.id}" style="cursor:pointer">`;
    const R = node.type==='reservoir'?18:node.type==='tank'?16:14;

    // Pilar isométrico
    if (window.isIsoView && pos.z !== 0) {
      g += `<line x1="${pos.bx}" y1="${pos.by}" x2="${pos.x}" y2="${pos.y}" stroke="${color}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.4"/>`;
      // Elipse en la base
      g += `<ellipse cx="${pos.bx}" cy="${pos.by}" rx="4" ry="2" fill="none" stroke="${color}" stroke-width="1" opacity="0.5"/>`;
    }

    if (node.type === 'tank') {
      const lvl = Math.min(1, Math.max(0.15, 0.5+(node.p_bar??0)/4));
      g += `<rect x="${pos.x-R}" y="${pos.y-R}" width="${R*2}" height="${R*2}" rx="3"
        fill="#091a1a" stroke="${color}" stroke-width="${sel?2.5:1.8}"${sel?' filter="url(#glow-sm)"':''}/>`;
      const fillY = pos.y-R + (R*2)*(1-lvl);
      g += `<rect x="${pos.x-R+2}" y="${fillY}" width="${R*2-4}" height="${R*2-(fillY-(pos.y-R))-2}" rx="2"
        fill="${color}" opacity=".18"/>`;
      g += `<line x1="${pos.x-R+2}" y1="${fillY}" x2="${pos.x+R-2}" y2="${fillY}"
        stroke="${color}" stroke-width="1.5" opacity=".5"/>`;
    } else {
      g += `<circle cx="${pos.x}" cy="${pos.y}" r="${R}"
        fill="#0a0f1a" stroke="${color}" stroke-width="${sel?2.5:1.8}"${sel?' filter="url(#glow-sm)"':''}/>`;
      if (node.demand > 0)
        g += `<circle cx="${pos.x}" cy="${pos.y}" r="${R*0.45}" fill="${color}" opacity=".25"/>`;
    }

    const lblMode = document.getElementById('node-label').value;
    let lbl = node.label;
    let sublbl = '';
    if (lblMode==='H' && node.H!==null) lbl = `${(node.H||0).toFixed(1)}m`;
    else if (lblMode==='P' && node.P!==null) lbl = `${(node.P||0).toFixed(2)}bar`;
    else if (lblMode==='both') { lbl=node.label; sublbl=node.H!==null?`${(node.H||0).toFixed(1)}m`:''; }
    g += `<text x="${pos.x}" y="${pos.y-R-5}" text-anchor="middle" fill="${color}"
      font-size="10" font-family="IBM Plex Mono" font-weight="500">${esc(lbl)}</text>`;
    if (sublbl)
      g += `<text x="${pos.x}" y="${pos.y-R-15}" text-anchor="middle" fill="${color}"
        font-size="9" font-family="IBM Plex Mono" opacity=".75">${sublbl}</text>`;

    g += '</g>';
    root.innerHTML += g;
  }

  // Attach event listeners to rendered elements
  root.querySelectorAll('.arc-el').forEach(el => {
    const id = +el.dataset.id;
    el.addEventListener('mousedown', e => e.stopPropagation()); // prevent SVG deselect+redraw before click fires
    el.addEventListener('click', e => { e.stopPropagation(); onArcClick(id); });
  });
  root.querySelectorAll('.node-el').forEach(el => {
    const id = +el.dataset.id;
    el.addEventListener('mousedown', e => { e.stopPropagation(); onNodeMouseDown(e, id); });
    el.addEventListener('click',     e => { e.stopPropagation(); onNodeClick(id); });
  });
}

// ── Mouse interaction ──
let _drag = null, _pan = null;

svg.addEventListener('mousedown', e => {
  if (state.mode === 'pan') {
    _pan = {sx:e.clientX, sy:e.clientY, px:state.pan.x, py:state.pan.y};
    return;
  }
  if (window.isIsoView) return; // Disable drawing new nodes when in 3D
  
  if (state.mode === 'node') {
    const pt = svgPt(e);
    pushUndo();
    const node = mkNode(state.nodeType, pt.x, pt.y);
    state.nodes.push(node);
    selectElement(node.id);
    renderNetwork();
    renderSidebarLists();
    renderProps();
    return;
  }
  if (state.mode === 'select') {
    clearSelection();
    renderNetwork();
    renderProps();
  }
});

svg.addEventListener('mousemove', e => {
  if (_pan) {
    state.pan.x = _pan.px + (e.clientX-_pan.sx);
    state.pan.y = _pan.py + (e.clientY-_pan.sy);
    applyTransform(); return;
  }
  if (_drag) {
    const pt = svgPt(e);
    _drag.node.x = pt.x; _drag.node.y = pt.y;
    renderNetwork(); return;
  }
  if (state.mode==='arc' && state.arcFrom) {
    state._arcMousePos = svgPt(e);
    renderNetwork();
  }
});

svg.addEventListener('mouseup', e => {
  _drag = null; _pan = null;
});

svg.addEventListener('mouseleave', ()=>{_drag=null; _pan=null;});

function onNodeMouseDown(e, id) {
  if (window.isIsoView) return; // disable dragging in 3D
  if (state.mode === 'select') {
    pushUndo();
    _drag = {node: findNode(id)};
  }
}

function onNodeClick(id) {
  if (state.mode === 'arc') {
    if (!state.arcFrom) {
      state.arcFrom = id;
      updateHint('Click en otro nodo para completar el arco · Esc para cancelar');
    } else {
      if (state.arcFrom === id) { state.arcFrom=null; return; }
      pushUndo();
      const arc = mkArc(state.arcType, state.arcFrom, id);
      state.arcs.push(arc);
      state.arcFrom = null;
      state._arcMousePos = null;
      selectElement(arc.id);
      renderNetwork();
      renderSidebarLists();
      renderProps();
      updateHint('Click en nodo origen para nuevo arco');
    }
    return;
  }
  if (state.mode === 'select') {
    selectElement(id);
    renderNetwork();
    renderProps();
    showSBPane('props');
  }
}

function onArcClick(id) {
  if (state.mode !== 'select') return;
  selectElement(id);
  renderNetwork();
  renderProps();
  showSBPane('props');
}

function selectElement(id) {
  state.selectedId = id;
}
function clearSelection() {
  state.selectedId = null;
  state.arcFrom = null;
  state._arcMousePos = null;
}
function deleteSelected() {
  const id = state.selectedId;
  if (!id) return;
  pushUndo();
  state.nodes = state.nodes.filter(n=>n.id!==id);
  state.arcs  = state.arcs.filter(a=>a.id!==id && a.fromId!==id && a.toId!==id);
  clearSelection();
  renderNetwork();
  renderSidebarLists();
  renderProps();
}
function clearNetwork() {
  state.nodes=[]; state.arcs=[]; state.results=null;
  clearSelection(); _nextId=1;
  renderNetwork(); renderSidebarLists(); renderProps(); renderResults();
  setSolverStatus('idle','Sin calcular');
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
  if (e.key==='z'||e.key==='Z') { if(e.ctrlKey||e.metaKey){e.preventDefault();undo();return;} setMode('select'); }
  if ((e.key==='y'||e.key==='Y') && (e.ctrlKey||e.metaKey)) { e.preventDefault(); redo(); return; }
  if (e.key==='s'||e.key==='S') { if(!(e.ctrlKey||e.metaKey)) setMode('select'); }
  if (e.key==='n'||e.key==='N') setMode('node');
  if (e.key==='a'||e.key==='A') setMode('arc');
  if (e.key==='p'||e.key==='P') setMode('pan');
  if (e.key==='Escape') { clearSelection(); setMode('select'); renderNetwork(); renderProps(); }
  if ((e.key==='Delete'||e.key==='Backspace') && state.selectedId) deleteSelected();
  if (e.key==='Enter') runSolver();
  if ((e.key==='='||e.key==='+') && (e.ctrlKey||e.metaKey)){e.preventDefault();zoomBy(1.2);}
  if (e.key==='-' && (e.ctrlKey||e.metaKey)){e.preventDefault();zoomBy(0.83);}
  if (e.key==='0' && (e.ctrlKey||e.metaKey)){e.preventDefault();zoomFit();}
});

function setMode(m) {
  state.mode = m;
  document.querySelectorAll('#mode-btns .tb-btn').forEach(b=>b.classList.remove('active'));
  const el = document.getElementById('mode-'+m);
  if (el) el.classList.add('active');
  svg.className.baseVal = 'mode-'+m;
  if (m!=='arc'){state.arcFrom=null;state._arcMousePos=null;}
  updateHint(m==='node'?'Click para agregar nodo · Esc para cancelar'
            :m==='arc'?'Click en nodo origen'
            :m==='pan'?'Arrastrá para mover la vista'
            :'Click en elemento para seleccionar · Del para eliminar');
  renderNetwork();
}
function setNodeType(t) {
  state.nodeType = t;
  document.querySelectorAll('#node-type-btns .tb-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('nt-'+t)?.classList.add('active');
}
function setArcType(t) {
  state.arcType = t;
  document.querySelectorAll('#arc-type-btns .tb-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('at-'+t)?.classList.add('active');
}
function updateHint(txt) {
  document.getElementById('canvas-hint').textContent = txt;
}
