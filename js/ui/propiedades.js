// js/ui/propiedades.js
'use strict';
/* Panel de propiedades del nodo o arco seleccionado (v27: nivel en tanques, series de tubería, Crane TP 410, ANSI/HI 9.6.7, Kv de equipos y desglose hf/hm). */

function inp(label, field, val, type = 'number', extra = '') {
  const isNum = type === 'number';
  const inputType = isNum ? 'text' : type;
  const mode = isNum ? ' inputmode="decimal"' : '';
  return `<label class="prop-row">
    <span>${label}</span>
    <input type="${inputType}"${mode} value="${esc(val ?? '')}" data-field="${field}" class="prop-inp" step="any" ${extra}>
  </label>`;
}

function renderNodeProps(panel, node) {
  const isTank = node.type === 'tank';
  const hCalc  = isTank ? tankFixedHead(node, fluid) : null;
  panel.innerHTML = `
    <div class="prop-header" style="border-color:${NODE_COLORS[node.type] || '#2dd4bf'}">
      <span class="prop-type">${esc(node.type.toUpperCase())}</span>
      <span class="prop-name">${esc(node.label)}</span>
    </div>
    <div class="prop-body" id="prop-fields">
      ${inp('Nombre', 'label', node.label, 'text')}
      ${inp(isTank ? 'Cota solera z [m]' : 'Cota z [m]', 'cota', node.cota ?? 0)}
      ${isTank ? inp('Nivel de líquido [m]', 'level_m', node.level_m ?? 0) : ''}
      ${isTank
        ? inp('Presión gas / sup. [bar]', 'p_bar', node.p_bar ?? 0)
        : inp('Demanda Q [m³/h]', 'demand', node.demand ?? 0)}
      ${isTank ? `<div class="prop-result"><span>H total fija:</span><span>${hCalc !== null ? hCalc.toFixed(2) + ' m' : '—'}</span></div>` : ''}
      ${isTank ? `<label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Rol del tanque
        <select id="prop-tank-role" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:11px;outline:none;cursor:pointer;margin-bottom:7px;font-family:var(--mono)">
          <option value=""      ${!node.role              ? 'selected' : ''}>— Sin definir —</option>
          <option value="source"${node.role === 'source'  ? 'selected' : ''}>⬆ Entrega fluido</option>
          <option value="sink"  ${node.role === 'sink'    ? 'selected' : ''}>⬇ Recibe fluido</option>
        </select>
      </label>` : ''}
      ${node.H !== null && node.H !== undefined ? `<div class="prop-result"><span>H calc:</span><span>${(+node.H).toFixed(2)} m</span></div>` : ''}
      ${node.P !== null && node.P !== undefined ? `<div class="prop-result"><span>P piezométrica:</span><span>${(+node.P).toFixed(3)} bar</span></div>` : ''}
      ${!isTank && node.P_est !== null && node.P_est !== undefined ? `<div class="prop-result"><span>P manómetro:</span><span>${(+node.P_est).toFixed(3)} bar</span></div>` : ''}
      ${node.cavitation ? `<div class="prop-result" style="color:#f87171"><span>⚠ Cavitación:</span><span>P abs ≤ Pv</span></div>` : ''}
    </div>
    <div class="prop-actions">
      <button class="prop-btn delete-btn" onclick="deleteSelected()">🗑 Eliminar</button>
    </div>`;
  panel.querySelectorAll('.prop-inp').forEach(inpEl => {
    inpEl.addEventListener('change', () => {
      const f = inpEl.dataset.field;
      let v;
      if (inpEl.getAttribute('inputmode') === 'decimal') {
        const parsed = parseLocaleFloat(inpEl.value);
        if (!Number.isFinite(parsed) || (f === 'level_m' && parsed < 0)) { inpEl.value = (node[f] ?? ''); return; }
        v = parsed;
        inpEl.value = v;
      } else {
        v = inpEl.value;
      }
      pushUndo();
      node[f] = v;
      if (f === 'label') renderSidebarLists();
      if (isTank) renderNodeProps(panel, node);
      renderNetwork();
    });
  });
  const roleSelect = panel.querySelector('#prop-tank-role');
  if (roleSelect) roleSelect.addEventListener('change', () => { node.role = roleSelect.value || null; });
}

function buildPipeGeomSection(arc, full = true) {
  const ss = 'width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:4px 6px;font-size:10px;outline:none;cursor:pointer;margin-bottom:7px';
  const schedKey = (arc.schedule && PIPE_SCHEDULES[arc.schedule]) ? arc.schedule : 'SCH40';
  const activeList = PIPE_SCHEDULES[schedKey].list;
  const schedSelect = `
    <label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Norma / Serie de tubería
      <select id="prop-schedule" style="${ss}">
        ${Object.entries(PIPE_SCHEDULES).map(([k, v]) => `<option value="${k}"${k === schedKey ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select>
    </label>`;
  const dnOpts = activeList.filter(d => d.D !== null).map(d => {
    const sel = Math.abs((arc.D_mm || 200) - d.D) < 0.25 ? ' selected' : '';
    return `<option value="${d.D}"${sel}>${esc(d.label)} (${d.D} mm)</option>`;
  }).join('');
  const dnSelect = `
    <label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Diámetro nominal
      <select id="prop-nps" style="${ss}">
        <option value="">— Personalizado —</option>${dnOpts}
      </select>
    </label>`;
  const dInteriorInp = `<label style="display:block"><span style="font-size:10px;color:var(--muted)">D interior [mm]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.D_mm || 200)}" data-field="D_mm" class="prop-inp" step="0.1"></label>`;
  if (!full) {
    return `<div class="prop-sep">Diámetro</div>${schedSelect}${dnSelect}${dInteriorInp}`;
  }
  const matActual = materialDeArco(arc);
  const matOpts = MATERIALS.map(m => {
    const sel = matActual && matActual.label === m.label ? ' selected' : '';
    return `<option value="${esc(m.label)}"${sel}>${esc(m.label)} — ε ${m.eps} mm</option>`;
  }).join('');
  return `
    <div class="prop-sep">Geometría del caño</div>
    ${schedSelect}
    ${dnSelect}
    <div class="row2">
      ${dInteriorInp}
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">Longitud L [m]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.L_m ?? 100)}" data-field="L_m" class="prop-inp" step="0.1"></label>
    </div>
    <label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Material / Rugosidad base
      <select id="prop-material" style="${ss}">
        <option value="">— Personalizado —</option>${matOpts}
      </select>
    </label>
    <div class="row2">
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">ε base [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.eps_mm ?? 0.046).toFixed(4)}" data-field="eps_mm" class="prop-inp" step="0.001"></label>
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">Espesor wall [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.wall_mm ?? 5.0).toFixed(2)}" data-field="wall_mm" class="prop-inp" step="0.1" min="0.1"></label>
    </div>
    <label style="display:block"><span style="font-size:10px;color:var(--muted)">Sarro Δε [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.fouling_mm ?? 0).toFixed(3)}" data-field="fouling_mm" class="prop-inp" step="0.001" min="0"></label>`;
}

function renderArcProps(panel, arc) {
  const isPump = arc.type === 'pump';
  const isEquip = arc.type === 'equip';
  const isValve = arc.type === 'valve';
  const isPipe = arc.type === 'pipe' || arc.type === 'check';
  const hasPipe = isPipe || isValve;
  const from = findNode(arc.fromId), to = findNode(arc.toId);

  if (!arc.fitQty || arc.fitQty.length !== FITTINGS.length) {
    const prev = Array.isArray(arc.fitQty) ? arc.fitQty : [];
    arc.fitQty = FITTINGS.map((_, i) => Number.isFinite(+prev[i]) ? +prev[i] : 0);
  }
  if (!Array.isArray(arc.fitOpen) || arc.fitOpen.length !== FITTINGS.length) {
    const prevOpen = arc.fitOpen || [];
    arc.fitOpen = FITTINGS.map((_, i) => Number.isFinite(+prevOpen[i]) ? +prevOpen[i] : 100);
  }

  let pumpSection = '';
  if (isPump) {
    const pumpMode = arc.pumpMode || 'curve';
    const pumpModeInputs = pumpMode === 'fixedQ' ? `
      <label class="prop-row"><span>Caudal requerido [m³/h]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.fixedQ_m3h ?? 100)}" min="0" step="1" data-field="fixedQ_m3h" class="prop-inp"></label>
      <div style="font-size:9px;color:var(--muted);margin-top:2px;margin-bottom:4px;line-height:1.5">
        Desplazamiento positivo ideal: entrega este caudal y la red determina la carga necesaria.
      </div>` : pumpMode === 'fixedP' ? `
      <label class="prop-row"><span>Presión de descarga [bar]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.fixedP_bar ?? 3)}" min="0" step="0.1" data-field="fixedP_bar" class="prop-inp"></label>` : `
      <div class="row2">
        <label style="display:block"><span style="font-size:10px;color:var(--muted)">Velocidad [rpm]</span>
          <input type="text" inputmode="decimal" value="${esc(arc.speed_rpm ?? 1450)}" data-field="speed_rpm" class="prop-inp"></label>
        <label style="display:block"><span style="font-size:10px;color:var(--muted)">ANSI/HI 9.6.7 (visc.)</span>
          <select id="prop-visc-corr" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:4px 6px;font-size:10px">
            <option value="1"${arc.viscCorr !== false ? ' selected' : ''}>Activa</option>
            <option value="0"${arc.viscCorr === false ? ' selected' : ''}>Desactivada</option>
          </select></label>
      </div>
      <div class="prop-sep">Curva H-Q (ensayo en agua)</div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:4px">Una fila por punto: Q [m³/h] &nbsp;H [m]</div>
      <textarea class="prop-curve" data-field="pumpCurve">${arc.pumpCurve.map(p => `${esc(p.Q)}\t${esc(p.H)}`).join('\n')}</textarea>
      <div class="prop-sep" style="margin-top:8px">Curva P-Q en agua <span style="color:var(--muted);font-weight:400">(escala con ρ y ANSI/HI)</span></div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:4px">Una fila por punto: Q [m³/h] &nbsp;P [kW] — para una bomba</div>
      <textarea class="prop-curve prop-power-curve" data-field="powerCurve">${(arc.powerCurve || []).map(p => `${esc(p.Q)}\t${esc(p.P)}`).join('\n')}</textarea>`;
    pumpSection = `
      <label class="prop-row"><span>Bombas en paralelo</span>
        <input type="text" inputmode="decimal" value="${esc(arc.nPumps || 1)}" min="1" max="10" data-field="nPumps" class="prop-inp" step="1"></label>
      <label class="prop-row"><span>Modo</span>
        <select data-field="pumpMode" class="prop-inp">
          <option value="curve"${pumpMode === 'curve' ? ' selected' : ''}>Curva H-Q</option>
          <option value="fixedQ"${pumpMode === 'fixedQ' ? ' selected' : ''}>Caudal fijo (calcular carga)</option>
          <option value="fixedP"${pumpMode === 'fixedP' ? ' selected' : ''}>Presión fija (calcular caudal)</option>
        </select></label>
      ${pumpModeInputs}`;
  }

  const totalK = arcTotalK(arc);
  let fittingsSection = '';
  if (isPipe) {
    const kMethod = arc.kMethod || 'crane';
    const rows = FITTINGS.map((f, i) => {
      const openVal = arc.fitOpen[i] ?? 100;
      const kNow = fittingUnitK(arc, i);
      const openCell = f.curve
        ? `<input type="text" inputmode="decimal" class="fit-open-inp" data-fit-idx="${i}" value="${esc(openVal)}" min="0" max="100" step="5" title="% de apertura — 0% = válvula cerrada">`
        : `<span style="color:var(--faint)">—</span>`;
      return `
      <tr>
        <td>${esc(f.name)}</td>
        <td class="fit-k">${fmtK(kNow)}</td>
        <td><input type="text" inputmode="decimal" class="fit-inp" data-fit-idx="${i}"
          value="${esc(arc.fitQty[i] || 0)}" min="0" max="99" step="1"></td>
        <td>${openCell}</td>
      </tr>`;
    }).join('');
    fittingsSection = `
      <div class="prop-sep">Accesorios del tramo</div>
      <label class="prop-row"><span>Método K</span>
        <select data-field="kMethod" class="prop-inp">
          <option value="crane"${kMethod !== 'fixed' ? ' selected' : ''}>Crane TP 410 (Le/D · fT)</option>
          <option value="fixed"${kMethod === 'fixed' ? ' selected' : ''}>K constante clásico</option>
        </select></label>
      <table class="fit-table">
        <thead><tr><th>Accesorio</th><th>K</th><th>Cant.</th><th>% Apert.</th></tr></thead>
        <tbody id="fit-tbody-${arc.id}">${rows}</tbody>
        <tfoot><tr class="fit-total-row">
          <td colspan="3">K total tramo</td>
          <td id="fit-total-${arc.id}" style="text-align:center">${fmtK(totalK)}</td>
        </tr></tfoot>
      </table>`;
  }

  const eqMode = arc.equipMode || 'quadratic';
  let equipSection = isEquip ? `
      <label class="prop-row"><span>Modelo equipo</span>
        <select data-field="equipMode" class="prop-inp">
          <option value="quadratic"${eqMode !== 'threshold' ? ' selected' : ''}>Cuadrático Kv (ΔP @ Qnom agua)</option>
          <option value="threshold"${eqMode === 'threshold' ? ' selected' : ''}>Umbral fijo [bar]</option>
        </select></label>
      ${inp('ΔP nominal [bar]', 'dp_bar', arc.dp_bar)}
      ${inp('Q nominal [m³/h]', 'q_nom_m3h', arc.q_nom_m3h ?? 0)}
      ${inp('D boquilla [mm]', 'D_mm', arc.D_mm ?? 200)}
      <div style="font-size:9px;color:var(--muted);margin-top:-2px;margin-bottom:6px;line-height:1.45">
        Si Q nominal = 0, se adopta V = 2 m/s en D boquilla. En modo Kv, ΔH es geométrico e independiente de ρ.
      </div>` : '';

  const valveHasCurve = isValve && !!VALVE_OPENING_CURVES[arc.valveType];
  let valveSection = isValve ? `
      <label class="prop-row"><span>Tipo</span>
        <select data-field="valveType" class="prop-inp">
          ${Object.keys(VALVE_TYPE_LABELS).map(v => `<option value="${v}"${arc.valveType === v ? ' selected' : ''}>${VALVE_TYPE_LABELS[v]}</option>`).join('')}
        </select></label>
      ${valveHasCurve ? inp('% Apertura', 'open_pct', arc.open_pct ?? 100) : ''}
      ${inp('ΔP mín [bar]', 'pmin_bar', arc.pmin_bar || 0)}` : '';

  panel.innerHTML = `
    <div class="prop-header" style="border-color:${ARC_COLORS[arc.type] || '#64748b'}">
      <span class="prop-type">${esc(arc.type.toUpperCase())}</span>
      <span class="prop-name">${esc(arc.label)} · ${esc(from?.label || '?')}→${esc(to?.label || '?')}</span>
    </div>
    <div class="prop-body">
      ${inp('Nombre', 'label', arc.label, 'text')}
      ${hasPipe ? buildPipeGeomSection(arc, isPipe) : ''}
      ${isEquip && !hasPipe ? inp('P mín. entrada [bar]', 'pmin_bar', arc.pmin_bar ?? 0) : ''}
      ${hasPipe ? inp('K adicional', 'customK', arc.customK) : ''}
      ${pumpSection}${equipSection}${valveSection}
      ${fittingsSection}
    </div>
    <div class="prop-results">
      ${arc.Q !== null && arc.Q !== undefined ? `<div class="prop-result"><span>Q:</span><span>${(+arc.Q).toFixed(2)} m³/h</span></div>` : ''}
      ${arc.V !== null && arc.V !== undefined ? `<div class="prop-result"><span>V:</span><span>${(+arc.V).toFixed(2)} m/s</span></div>` : ''}
      ${hasPipe && arc.hf_major != null ? `<div class="prop-result"><span>hf primaria:</span><span>${(+arc.hf_major).toFixed(2)} m</span></div>` : ''}
      ${hasPipe && arc.hm_minor != null ? `<div class="prop-result"><span>hm accesorios:</span><span>${(+arc.hm_minor).toFixed(2)} m</span></div>` : ''}
      ${arc.hf !== null && arc.hf !== undefined ? `<div class="prop-result"><span>${isPump && (arc.pumpMode || 'curve') === 'fixedQ' ? 'Carga requerida' : (isPump && (arc.pumpMode || 'curve') === 'fixedP' ? 'Incremento carga' : 'ΔH total')}:</span><span>${(+arc.hf).toFixed(2)} m</span></div>` : ''}
      ${arc.Re !== null && arc.Re !== undefined && !isPump && !isEquip ? `<div class="prop-result"><span>Re / f:</span><span>${Math.round(arc.Re)} · ${(+arc.f || 0).toFixed(4)}</span></div>` : ''}
      ${hasPipe ? `<div class="prop-result"><span>K total:</span><span>${fmtK(totalK)}</span></div>` : ''}
      ${isPump && arc.P_hid != null ? `<div class="prop-result"><span>P hid:</span><span>${arc.P_hid.toFixed(2)} kW</span></div>` : ''}
      ${isPump && arc.P_eje != null ? `<div class="prop-result" style="color:var(--amber)"><span>P eje:</span><span>${arc.P_eje.toFixed(2)} kW</span></div>` : ''}
      ${isPump && arc.NPSHa != null ? `<div class="prop-result"><span>NPSHa succión:</span><span>${arc.NPSHa.toFixed(2)} m</span></div>` : ''}
      ${isPump && (arc.viscB || 0) > 1 ? `<div class="prop-result" style="color:#38bdf8"><span>ANSI/HI B=${arc.viscB.toFixed(1)}:</span><span>CQ=${arc.C_Q.toFixed(2)} · Cη=${arc.C_eta.toFixed(2)}</span></div>` : ''}
    </div>
    <div class="prop-actions">
      <button class="prop-btn delete-btn" onclick="deleteSelected()">🗑 Eliminar</button>
    </div>`;

  const _refreshFitTable = () => {
    const kTxt = fmtK(arcTotalK(arc));
    const tot = document.getElementById('fit-total-' + arc.id);
    if (tot) tot.textContent = kTxt;
    panel.querySelectorAll('.fit-k').forEach((cell, idx) => {
      cell.textContent = fmtK(fittingUnitK(arc, idx));
    });
    const kRes = panel.querySelector('.prop-results');
    if (kRes) {
      kRes.querySelectorAll('.prop-result').forEach(el => {
        if (el.querySelector('span:first-child')?.textContent === 'K total:')
          el.querySelector('span:last-child').textContent = kTxt;
      });
    }
  };

  panel.querySelectorAll('.prop-inp').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.field;
      let v;
      if (el.tagName === 'SELECT') {
        v = el.value;
      } else if (el.getAttribute('inputmode') === 'decimal') {
        const parsed = parseLocaleFloat(el.value);
        const belowMin = ((f === 'D_mm' || f === 'speed_rpm') && parsed <= 0) ||
                         (f === 'nPumps' && parsed < 1) ||
                         ((f === 'eps_mm' || f === 'fouling_mm' || f === 'L_m' || f === 'q_nom_m3h') && parsed < 0);
        const outOfPct = (f === 'open_pct' && (parsed < 0 || parsed > 100));
        if (!Number.isFinite(parsed) || belowMin || outOfPct) { el.value = (arc[f] ?? ''); return; }
        v = parsed;
        el.value = v;
      } else {
        v = el.value;
      }
      pushUndo();
      arc[f] = v;
      if (f === 'label') renderSidebarLists();
      if (f === 'D_mm' || f === 'kMethod' || f === 'customK') _refreshFitTable();
      renderNetwork();
    });
  });

  const viscEl = panel.querySelector('#prop-visc-corr');
  if (viscEl) viscEl.addEventListener('change', () => { pushUndo(); arc.viscCorr = viscEl.value === '1'; });

  for (const selField of ['pumpMode', 'valveType', 'equipMode']) {
    const sEl = panel.querySelector(`[data-field="${selField}"]`);
    if (sEl) sEl.addEventListener('change', () => renderArcProps(panel, arc));
  }

  const avisoCurva = (cuadro, msg) => {
    let el = cuadro.nextElementSibling && cuadro.nextElementSibling.classList.contains('prop-curve-err') ? cuadro.nextElementSibling : null;
    if (!msg) { if (el) el.remove(); cuadro.classList.remove('invalid'); return; }
    if (!el) { el = document.createElement('div'); el.className = 'prop-curve-err'; cuadro.insertAdjacentElement('afterend', el); }
    el.textContent = msg; cuadro.classList.add('invalid');
  };
  const leerCurva = (cuadro, clave, puedeEstarVacia, avisar) => {
    const r = parsearTablaCurva(cuadro.value, clave);
    let msg = '';
    if (r.errores.length)
      msg = (r.errores.length > 1 ? 'Filas ' : 'Fila ') + r.errores.slice(0, 5).join(', ') + (r.errores.length > 5 ? '…' : '') +
            ': se esperan dos números (Q y ' + clave + ') separados por tabulación, espacio o «;»; la coma es decimal.';
    else if (r.puntos.length < 2 && !(puedeEstarVacia && r.puntos.length === 0)) msg = 'Hacen falta al menos 2 puntos.';
    if (!msg || avisar) avisoCurva(cuadro, msg);
    return msg ? null : r.puntos;
  };
  const ta = panel.querySelector('[data-field="pumpCurve"]');
  if (ta) {
    let _deb1;
    const parseHQ = avisar => { const p = leerCurva(ta, 'H', false, avisar); if (p) arc.pumpCurve = p; };
    ta.addEventListener('input',  () => { clearTimeout(_deb1); _deb1 = setTimeout(() => parseHQ(false), 600); });
    ta.addEventListener('change', () => parseHQ(true));
  }
  const taP = panel.querySelector('[data-field="powerCurve"]');
  if (taP) {
    let _deb2;
    const parsePQ = avisar => { const p = leerCurva(taP, 'P', true, avisar); if (p) arc.powerCurve = p; };
    taP.addEventListener('input',  () => { clearTimeout(_deb2); _deb2 = setTimeout(() => parsePQ(false), 600); });
    taP.addEventListener('change', () => parsePQ(true));
  }

  const schedEl = panel.querySelector('#prop-schedule');
  if (schedEl) schedEl.addEventListener('change', () => {
    arc.schedule = schedEl.value;
    if (arc.schedule === 'CU_L') { arc.material = 'Cobre'; arc.eps_mm = 0.0015; }
    const firstDn = PIPE_SCHEDULES[arc.schedule]?.list.find(d => d.D !== null);
    if (firstDn) { arc.D_mm = firstDn.D; if (firstDn.t) arc.wall_mm = firstDn.t; }
    renderArcProps(panel, arc);
    renderNetwork();
  });

  const npsEl = panel.querySelector('#prop-nps');
  if (npsEl) npsEl.addEventListener('change', () => {
    const d = parseFloat(npsEl.value);
    if (d > 0) {
      arc.D_mm = d;
      const di = panel.querySelector('[data-field="D_mm"]'); if (di) di.value = d.toFixed(2);
      const list = PIPE_SCHEDULES[arc.schedule || 'SCH40']?.list || DN_LIST;
      const dn = list.find(x => x.D === d);
      if (dn && dn.t) { arc.wall_mm = dn.t; const wi = panel.querySelector('[data-field="wall_mm"]'); if (wi) wi.value = dn.t.toFixed(2); }
      _refreshFitTable();
      renderNetwork();
    }
  });

  const matEl = panel.querySelector('#prop-material');
  if (matEl) matEl.addEventListener('change', () => {
    const mat = MATERIALS.find(m => m.label === matEl.value);
    if (mat) { arc.eps_mm = mat.eps; arc.material = mat.label; const ei = panel.querySelector('[data-field="eps_mm"]'); if (ei) ei.value = mat.eps.toFixed(4); renderNetwork(); }
  });

  panel.querySelectorAll('.fit-inp').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.fitIdx;
      const raw = parseLocaleFloat(el.value);
      arc.fitQty[i] = Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
      el.value = arc.fitQty[i];
      _refreshFitTable();
    });
  });

  panel.querySelectorAll('.fit-open-inp').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.fitIdx;
      const raw = parseLocaleFloat(el.value);
      const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
      arc.fitOpen[i] = v;
      el.value = v;
      _refreshFitTable();
    });
  });
}

function renderProps() {
  const empty   = document.getElementById('props-empty');
  const content = document.getElementById('props-content');
  if (!empty || !content) return;
  const id = state.selectedId;
  if (!id) {
    empty.style.display = ''; content.style.display = 'none'; content.innerHTML = ''; return;
  }
  const node = findNode(id), arc = findArc(id);
  empty.style.display = 'none'; content.style.display = '';
  if (node)      renderNodeProps(content, node);
  else if (arc)  renderArcProps(content, arc);
  else { empty.style.display = ''; content.style.display = 'none'; }
}
