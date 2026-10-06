// js/io/proyecto.js
'use strict';
/* Datos del proyecto, guardar y cargar el archivo JSON de la red. */

function openProjectModal(forPdf=false) {
  _pdfPendingAfterMeta = forPdf;
  document.getElementById('proj-name').value     = projectMeta.name;
  document.getElementById('proj-rev').value      = projectMeta.rev;
  document.getElementById('proj-client').value   = projectMeta.client;
  document.getElementById('proj-engineer').value = projectMeta.engineer;
  document.getElementById('proj-notes').value    = projectMeta.notes;
  const titleEl = document.getElementById('modal-project-title');
  const saveBtn = document.getElementById('modal-project-save-btn');
  if (titleEl) titleEl.textContent = forPdf ? '🗒 Confirmá los datos antes de generar el PDF' : '🗒 Datos del Proyecto';
  if (saveBtn) saveBtn.textContent = forPdf ? 'Generar PDF' : 'Guardar';
  document.getElementById('modal-project').classList.add('open');
}

// [v14] Cancelar: si se abrió desde PDF, no exporta nada.
function cancelProjectModal() {
  _pdfPendingAfterMeta = false;
  document.getElementById('modal-project').classList.remove('open');
}

function saveProjectMeta() {
  projectMeta.name     = document.getElementById('proj-name').value     || 'Red Hidráulica';
  projectMeta.rev      = document.getElementById('proj-rev').value      || 'Rev. 0';
  projectMeta.client   = document.getElementById('proj-client').value;
  projectMeta.engineer = document.getElementById('proj-engineer').value;
  projectMeta.notes    = document.getElementById('proj-notes').value;
  document.getElementById('modal-project').classList.remove('open');
  // [v14] si la apertura vino del botón PDF, ahora sí generamos y descargamos el PDF
  if (_pdfPendingAfterMeta) { _pdfPendingAfterMeta = false; exportPDF(); }
}

// ── Save project (fix fluid references) ──
function saveProject() {
  const name = prompt('Nombre del proyecto:','red_hidraulica') || 'red_hidraulica';
  const data = {
    version: 1, name,
    savedAt: new Date().toISOString(),
    fluid: {
      rho: fluid.rho, nu: fluid.nu, q_required: fluid.q_required||0,
      type: document.getElementById('fluid-type')?.value || 'water', // [v16]
      temp: +document.getElementById('fluid-temp')?.value || 20,      // [v16]
      customName: fluid.customName || '',                             // [v16]
    },
    projectMeta: {...projectMeta},
    nodes: state.nodes,
    arcs:  state.arcs,
    nextId: _nextId,
  };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[^a-z0-9_\-]/gi,'_').slice(0,100) + '.json';   // [repo] nombre de archivo acotado
  a.click();
}

// ── Load project (HTML passes file input element) ──
function loadProject(inputEl) {
  const file = inputEl?.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data === null || typeof data !== 'object' || !Array.isArray(data.nodes) || !Array.isArray(data.arcs)) throw new Error('Formato inválido');   // [repo] antes bastaba que existieran
      // Backward compat: convert legacy reservoir nodes
      data.arcs.forEach(a=>{ if(a && a.type==='pump' && !a.powerCurve) a.powerCurve=[]; });   // [repo] el `a &&` deja que sanitizeArc dé el mensaje claro si el elemento no es un objeto
      data.nodes.forEach(n=>{ if(n && n.type==='reservoir'){ n.type='tank'; n.p_bar=n.p_bar??(n.head!=null?+(n.head*fluid.rho*9.81/1e5).toFixed(3):0); n.cota=n.cota??0; delete n.head; } });
      // [repo] Todo se valida ANTES de tocar el estado: si el archivo es inválido, la red que había queda como estaba (antes se reemplazaban los nodos y recién después se revisaban los arcos).
      const nodosNuevos = data.nodes.map(sanitizeNode), arcosNuevos = data.arcs.map(sanitizeArc);
      validarModelo(nodosNuevos, arcosNuevos);
      state.nodes = nodosNuevos;
      state.arcs  = arcosNuevos;
      // [repo] Solo los cinco campos conocidos y solo si son texto (antes se copiaba cualquier clave del archivo)
      if (data.projectMeta && typeof data.projectMeta === 'object')
        for (const k of ['name','rev','client','engineer','notes']) if (typeof data.projectMeta[k] === 'string') projectMeta[k] = data.projectMeta[k];
      if (data.fluid) {
        // [repo] Validación de tipos: solo números positivos (antes bastaba cualquier valor «verdadero», p. ej. un texto o un número negativo)
        const pos = (v, def) => (Number.isFinite(+v) && +v > 0) ? +v : def;
        fluid.rho = pos(data.fluid.rho, 998.2); fluid.nu = pos(data.fluid.nu, 1.004e-6); fluid.q_required = pos(data.fluid.q_required, 0);
        fluid.customName = typeof data.fluid.customName === 'string' ? data.fluid.customName : ''; // [v16] [repo] solo texto
        const qrEl=document.getElementById('q-required'); if(qrEl) qrEl.value=fluid.q_required;
        // [v16] Si el archivo ya guarda el tipo de fluido (proyectos guardados desde la v16), se
        // sincroniza todo el panel de Fluido (tipo, temperatura, ρ, ν, nombre) con lo cargado —
        // antes quedaba en sus valores por defecto y, si se tocaba cualquier control del panel
        // después de cargar, onFluidChange() pisaba lo recién cargado con lo que había en el
        // formulario. Proyectos guardados antes de la v16 no traen "type": se deja el panel como
        // estaba (mismo comportamiento que hasta la v15) para no arriesgar una inferencia
        // equivocada que pise un ρ/ν personalizado real.
        if (data.fluid.type === 'water' || data.fluid.type === 'custom') {   // [repo] antes cualquier valor «verdadero»
          const typeEl=document.getElementById('fluid-type'), tempEl=document.getElementById('fluid-temp'),
                rhoEl=document.getElementById('fluid-rho'), nuEl=document.getElementById('fluid-nu'),
                nameEl=document.getElementById('fluid-name');
          if (typeEl) typeEl.value = data.fluid.type;
          if (tempEl && data.fluid.temp!=null) tempEl.value = data.fluid.temp;
          if (rhoEl) rhoEl.value = fluid.rho;
          if (nuEl) nuEl.value = +(fluid.nu*1e6).toFixed(4);
          if (nameEl) nameEl.value = fluid.customName;
          onFluidChange();
        }
      }
      // [repo] nextId nunca puede quedar por debajo del mayor id existente (evitaría ids repetidos)
      const maxId = Math.max(0,...state.nodes.map(n=>n.id),...state.arcs.map(a=>a.id));
      _nextId = (Number.isInteger(data.nextId) && data.nextId > maxId) ? data.nextId : maxId + 1;
      clearSelection();
      renderNetwork(); renderSidebarLists(); renderProps(); renderResults();
      zoomFit();
      setSolverStatus('idle','Proyecto cargado — ' + (data.name||''));
    } catch(err) { alert('Error al cargar: '+err.message); }
    inputEl.value = '';
  };
  reader.readAsText(file);
}
