// js/io/catalogo.js
'use strict';
/* Catálogo de bombas guardado en el navegador (localStorage), con importación y exportación en JSON. */

// ── CATÁLOGO DE BOMBAS (localStorage) ────────────────────────────────────────
const CATALOG_KEY = 'hydra_pump_catalog_v1';

function loadCatalog() {
  // [repo] Lo guardado en el navegador es un dato externo: si no es una lista de bombas con fabricante, modelo y curva, se ignora lo que no sirva
  // (antes, un valor guardado como «null» o «{}» rompía la pantalla del catálogo con un error de JavaScript).
  try {
    const v = JSON.parse(localStorage.getItem(CATALOG_KEY) || '[]');
    return Array.isArray(v) ? v.filter(p => p !== null && typeof p === 'object' && typeof p.maker === 'string' && typeof p.model === 'string' && Array.isArray(p.curve)) : [];
  } catch { return []; }
}

function saveCatalog(cat) {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(cat));
}

function openCatalogModal() {
  document.getElementById('cat-search').value = '';
  renderCatalogList();
  document.getElementById('modal-catalog').classList.add('open');
}

function renderCatalogList() {
  const q = (document.getElementById('cat-search')?.value || '').toLowerCase();
  // [repo] Cada fila conserva su posición en el catálogo completo: editar y borrar usan esa posición. Antes usaban la posición dentro de la lista
  // filtrada por la búsqueda, y con un texto escrito en el buscador «✏» y «✕» actuaban sobre otra bomba.
  const cat = loadCatalog().map((p, pos) => ({ p, pos })).filter(({ p }) =>
    !q || p.maker.toLowerCase().includes(q) || p.model.toLowerCase().includes(q)
  );
  const el = document.getElementById('catalog-list');
  if (!cat.length) {
    el.innerHTML = `<div class="empty-msg" style="padding:12px">Sin bombas en el catálogo. Agregá una con "+ Nueva bomba".</div>`;
    return;
  }
  el.innerHTML = cat.map(({ p, pos }) => `
    <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px">
      <div style="flex:1">
        <b style="color:var(--text)">${esc(p.maker)} ${esc(p.model)}</b>
        ${p.notes?`<span style="color:var(--faint)"> — ${esc(p.notes)}</span>`:''}
        <span style="margin-left:8px;background:var(--bg3);padding:1px 5px;border-radius:10px;font-size:9px;color:${p.stock>0?'#4ade80':'#f87171'}">
          Stock: ${esc(p.stock??'N/D')}
        </span>
        <div style="color:var(--faint);font-size:9px;margin-top:2px">${p.curve.length} puntos H-Q${p.powerCurve?.length?`, ${p.powerCurve.length} puntos P-Q`:''}</div>
      </div>
      <button class="tb-btn" style="padding:2px 7px;font-size:10px" onclick="editPumpFromCatalog(${pos})">✏</button>
      <button class="tb-btn red" style="padding:2px 7px;font-size:10px" onclick="deletePumpFromCatalog(${pos})">✕</button>
    </div>
  `).join('');
}

function openAddPumpModal(editIdx) {
  document.getElementById('edit-pump-id').value = editIdx ?? '';
  document.getElementById('add-pump-title').textContent = editIdx != null ? 'Editar Bomba' : 'Nueva Bomba';
  if (editIdx != null) {
    const p = loadCatalog()[editIdx];
    document.getElementById('cat-maker').value = p.maker;
    document.getElementById('cat-model').value = p.model;
    document.getElementById('cat-stock').value = p.stock ?? 1;
    document.getElementById('cat-pump-notes').value = p.notes ?? '';
    document.getElementById('cat-hq').value = p.curve.map(pt=>`${pt.Q}\t${pt.H}`).join('\n');
    document.getElementById('cat-pq').value = (p.powerCurve||[]).map(pt=>`${pt.Q}\t${pt.P}`).join('\n');
  } else {
    ['cat-maker','cat-model','cat-pump-notes','cat-hq','cat-pq'].forEach(id=>{ document.getElementById(id).value=''; });
    document.getElementById('cat-stock').value = 1;
  }
  document.getElementById('modal-add-pump').classList.add('open');
}

function editPumpFromCatalog(idx) { openAddPumpModal(idx); }

function deletePumpFromCatalog(idx) {
  const cat = loadCatalog();
  const p = cat[idx];
  if (!confirm(`¿Eliminar "${p.maker} ${p.model}" del catálogo?`)) return;
  cat.splice(idx, 1);
  saveCatalog(cat);
  renderCatalogList();
}

// [v26.1] Las tablas se leen con parsearTablaCurva (la coma es decimal: en v25 «7,5  60,8» se guardaba como Q=7, H=5 y las filas ilegibles se
// descartaban sin avisar). Devuelve los puntos, o null si alguna fila no se entiende (ya avisó con alert).
function leerTablaCatalogo(text, clave, nombre) {
  const r = parsearTablaCurva(text, clave);
  if (r.errores.length) { alert(`${nombre}: ${r.errores.length > 1 ? 'las filas' : 'la fila'} ${r.errores.slice(0, 5).join(', ')} no se entiende${r.errores.length > 1 ? 'n' : ''} (se esperan dos números; la coma es decimal).`); return null; }
  return r.puntos;
}

function savePumpToCatalog() {
  const maker = document.getElementById('cat-maker').value.trim();
  const model = document.getElementById('cat-model').value.trim();
  if (!maker || !model) { alert('Ingresá fabricante y modelo.'); return; }
  const curve = leerTablaCatalogo(document.getElementById('cat-hq').value, 'H', 'Curva H-Q');
  if (!curve) return;
  if (curve.length < 2) { alert('La curva H-Q necesita al menos 2 puntos.'); return; }
  const powerCurve = leerTablaCatalogo(document.getElementById('cat-pq').value, 'P', 'Curva P-Q');
  if (!powerCurve) return;
  const stock = +document.getElementById('cat-stock').value || 0;
  const notes = document.getElementById('cat-pump-notes').value.trim();

  const pump = { maker, model, stock, notes, curve, powerCurve };
  const cat = loadCatalog();
  const editIdx = document.getElementById('edit-pump-id').value;
  if (editIdx !== '') cat[+editIdx] = pump; else cat.push(pump);
  saveCatalog(cat);
  document.getElementById('modal-add-pump').classList.remove('open');
  renderCatalogList();
}

function exportCatalog() {
  const cat = loadCatalog();
  const blob = new Blob([JSON.stringify(cat, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hydra_catalogo_bombas.json';
  a.click();
}

function importCatalog(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      const cat = loadCatalog();
      let added = 0;
      for (const p of data) {
        if (p && p.maker && p.model && Array.isArray(p.curve) && p.curve.length >= 2 &&
            p.curve.every(pt => pt && Number.isFinite(+pt.Q) && Number.isFinite(+pt.H))) {
          // [repo] Se guarda una copia con los tipos normalizados (antes se guardaba el objeto tal cual venía del archivo)
          cat.push({
            maker: String(p.maker), model: String(p.model),
            stock: (p.stock != null && p.stock !== '' && Number.isFinite(+p.stock)) ? +p.stock : undefined,
            notes: p.notes == null ? '' : String(p.notes),
            curve: p.curve.map(pt => ({ Q: +pt.Q, H: +pt.H })),
            powerCurve: Array.isArray(p.powerCurve)
              ? p.powerCurve.filter(pt => pt && Number.isFinite(+pt.Q) && Number.isFinite(+pt.P)).map(pt => ({ Q: +pt.Q, P: +pt.P }))
              : [],
          });
          added++;
        }
      }
      saveCatalog(cat);
      renderCatalogList();
      alert(`✅ ${added} bomba(s) importada(s) correctamente.`);
    } catch { alert('❌ Error al leer el archivo. Verificá que sea un catálogo Hydra válido.'); }
    input.value = '';
  };
  reader.readAsText(file);
}
