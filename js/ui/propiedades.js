// js/ui/propiedades.js
'use strict';
/* Panel de propiedades del nodo o arco seleccionado. */

function inp(label, field, val, type='number', extra='') {
  // [v19] Los campos numéricos se muestran como texto con teclado decimal — un <input
  // type="number"> del navegador vacía el valor en silencio si se tipea coma (ver
  // parseLocaleFloat/commit handlers), que es exactamente el bug reportado.
  const isNum = type === 'number';
  const inputType = isNum ? 'text' : type;
  const mode = isNum ? ' inputmode="decimal"' : '';
  return `<label class="prop-row">
    <span>${label}</span>
    <input type="${inputType}"${mode} value="${esc(val??'')}" data-field="${field}" class="prop-inp" step="any" ${extra}>
  </label>`;
}

function renderNodeProps(panel, node) {
  const isTank = node.type==='tank';
  const hCalc  = isTank ? (+(node.cota??0) + +(node.p_bar??0)*1e5/(fluid.rho*9.81)) : null;
  panel.innerHTML = `
    <div class="prop-header" style="border-color:${NODE_COLORS[node.type]||'#2dd4bf'}">
      <span class="prop-type">${esc(node.type.toUpperCase())}</span>
      <span class="prop-name">${esc(node.label)}</span>
    </div>
    <div class="prop-body" id="prop-fields">
      ${inp('Nombre','label',node.label,'text')}
      ${inp('Cota z [m]','cota',node.cota??0)}
      ${isTank
        ? inp('Presión de trabajo [bar]','p_bar',node.p_bar??0)
        : inp('Demanda Q [m³/h]','demand',node.demand??0)}
      ${isTank ? `<div class="prop-result"><span>H piezométrica:</span><span>${hCalc!==null?hCalc.toFixed(2)+' m':'—'}</span></div>` : ''}
      ${isTank ? `<label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Rol del tanque
        <select id="prop-tank-role" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:11px;outline:none;cursor:pointer;margin-bottom:7px;font-family:var(--mono)">
          <option value=""      ${!node.role              ?'selected':''}>— Sin definir —</option>
          <option value="source"${node.role==='source'    ?'selected':''}>⬆ Entrega fluido</option>
          <option value="sink"  ${node.role==='sink'      ?'selected':''}>⬇ Recibe fluido</option>
        </select>
      </label>` : ''}
      ${node.H!==null&&node.H!==undefined ? `<div class="prop-result"><span>H calc:</span><span>${(+node.H).toFixed(2)} m</span></div>` : ''}
      ${node.P!==null&&node.P!==undefined ? `<div class="prop-result"><span>P calc:</span><span>${(+node.P).toFixed(3)} bar</span></div>` : ''}
    </div>
    <div class="prop-actions">
      <button class="prop-btn delete-btn" onclick="deleteSelected()">🗑 Eliminar</button>
    </div>`;
  panel.querySelectorAll('.prop-inp').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const f=inp.dataset.field;
      let v;
      if (inp.getAttribute('inputmode')==='decimal') {
        // [v19 FIX] antes: +inp.value convertía cualquier texto inválido (o vaciado por el
        // navegador al tipear coma) en 0 y lo guardaba en silencio. Ahora: si no parsea, se
        // revierte lo mostrado al valor ya guardado y no se toca el dato.
        const parsed = parseLocaleFloat(inp.value);
        if (!Number.isFinite(parsed)) { inp.value = (node[f] ?? ''); return; }
        v = parsed;
        inp.value = v; // normaliza lo mostrado (por si se tipeó con coma)
      } else {
        v = inp.value;
      }
      pushUndo();
      node[f]=v;
      if (f==='label') renderSidebarLists();
      renderNetwork();
    });
  });
  const roleSelect = panel.querySelector('#prop-tank-role');
  if (roleSelect) roleSelect.addEventListener('change', ()=>{ node.role = roleSelect.value || null; });
}

// ── Pipe geometry: NPS / material dropdowns ──
function buildPipeGeomSection(arc, full=true) {
  const ss = 'width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:4px 6px;font-size:10px;outline:none;cursor:pointer;margin-bottom:7px';
  const dnOpts = DN_LIST.filter(d=>d.D!==null).map(d=>{
    const sel = Math.abs((arc.D_mm||200)-d.D)<0.5 ? ' selected' : '';
    return `<option value="${d.D}"${sel}>${d.label}</option>`;
  }).join('');
  const dnSelect = `
    <label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Diámetro nominal (SCH 40)
      <select id="prop-nps" style="${ss}">
        <option value="">— Personalizado —</option>${dnOpts}
      </select>
    </label>`;
  const dInteriorInp = `<label style="display:block"><span style="font-size:10px;color:var(--muted)">D interior [mm]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.D_mm||200)}" data-field="D_mm" class="prop-inp" step="0.1"></label>`;
  // [v23] Elemento Valvula dedicado: a pedido del usuario, el panel muestra solo el diámetro
  // (nominal + interior) — sin longitud/material/espesor/sarro, porque se lo trata como una
  // pérdida puntual (K de la válvula + accesorios), sin fricción de tramo propia (ver
  // pipeCalc: para arc.type==='valve' el término f·L/D se ignora sin importar qué L_m/eps_mm/
  // wall_mm/fouling_mm haya quedado guardado). Los tramos de tubería/retención (isPipe) siguen
  // mostrando la sección completa, sin cambios.
  if (!full) {
    return `<div class="prop-sep">Diámetro</div>${dnSelect}${dInteriorInp}`;
  }
  // [v26] El material se guarda en el tramo (arc.material) porque PVC, HDPE y cobre comparten rugosidad y solo el material define el
  // módulo de Young del golpe de ariete. Si no se puede determinar (rugosidad a mano, o proyecto de v25 con ε = 0,0015), queda «Personalizado».
  const matActual = materialDeArco(arc);
  const matOpts = MATERIALS.map(m=>{
    const sel = matActual && matActual.label === m.label ? ' selected' : '';
    return `<option value="${esc(m.label)}"${sel}>${m.label} — ε ${m.eps} mm</option>`;
  }).join('');
  return `
    <div class="prop-sep">Geometría del caño</div>
    ${dnSelect}
    <div class="row2">
      ${dInteriorInp}
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">Longitud L [m]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.L_m||100)}" data-field="L_m" class="prop-inp" step="0.1"></label>
    </div>
    <label style="display:block;margin-bottom:2px;font-size:10px;color:var(--muted)">Material / Rugosidad base
      <select id="prop-material" style="${ss}">
        <option value="">— Personalizado —</option>${matOpts}
      </select>
    </label>
    <div class="row2">
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">ε base [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.eps_mm??0.046).toFixed(4)}" data-field="eps_mm" class="prop-inp" step="0.001"></label>
      <label style="display:block"><span style="font-size:10px;color:var(--muted)">Espesor wall [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.wall_mm??5.0).toFixed(2)}" data-field="wall_mm" class="prop-inp" step="0.1" min="0.1"></label>
    </div>
    <label style="display:block"><span style="font-size:10px;color:var(--muted)">Sarro Δε [mm]</span>
        <input type="text" inputmode="decimal" value="${(arc.fouling_mm??0).toFixed(3)}" data-field="fouling_mm" class="prop-inp" step="0.001" min="0"></label>`;
}

function renderArcProps(panel, arc) {
  const isPump = arc.type==='pump';
  const isEquip = arc.type==='equip';
  const isValve = arc.type==='valve';
  const isPipe = arc.type==='pipe'||arc.type==='check';
  const hasPipe = isPipe||isValve;
  const from=findNode(arc.fromId),to=findNode(arc.toId);

  // Ensure fitQty array matches FITTINGS length
  if (!arc.fitQty || arc.fitQty.length !== FITTINGS.length)
    arc.fitQty = new Array(FITTINGS.length).fill(0);
  // [v13] Ensure fitOpen array matches FITTINGS length (backward-compat con proyectos viejos)
  if (!Array.isArray(arc.fitOpen) || arc.fitOpen.length !== FITTINGS.length) {
    const prevOpen = arc.fitOpen || [];
    arc.fitOpen = FITTINGS.map((_, i) => Number.isFinite(prevOpen[i]) ? prevOpen[i] : 100);
  }

  let pumpSection = '';
  if (isPump) {
    const pumpMode = arc.pumpMode || 'curve'; // [v17]
    const pumpModeInputs = pumpMode==='fixedQ' ? `
      <label class="prop-row"><span>Caudal requerido [m³/h]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.fixedQ_m3h??100)}" min="0" step="1" data-field="fixedQ_m3h" class="prop-inp"></label>
      <div style="font-size:9px;color:var(--muted);margin-top:2px;margin-bottom:4px;line-height:1.5">
        La bomba entrega este caudal sin límite de presión — la red calcula qué presión hace
        falta para lograrlo. No hace falta curva H-Q en este modo.
      </div>` : pumpMode==='fixedP' ? `
      <label class="prop-row"><span>Presión de descarga [bar]</span>
        <input type="text" inputmode="decimal" value="${esc(arc.fixedP_bar??3)}" min="0" step="0.1" data-field="fixedP_bar" class="prop-inp"></label>
      <div style="font-size:9px;color:var(--muted);margin-top:2px;margin-bottom:4px;line-height:1.5">
        [v18] Presión que marca el manómetro a la salida de la bomba (siempre ahí, no en la
        succión) — la red calcula qué caudal resulta. No hace falta curva H-Q en este modo.
      </div>` : `
      <div class="prop-sep">Curva H-Q</div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:4px">Una fila por punto: Q [m³/h] &nbsp;H [m]</div>
      <textarea class="prop-curve" data-field="pumpCurve">${arc.pumpCurve.map(p=>`${esc(p.Q)}\t${esc(p.H)}`).join('\n')}</textarea>
      <div class="prop-sep" style="margin-top:8px">Curva P-Q <span style="color:var(--muted);font-weight:400">(opcional)</span></div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:4px">Una fila por punto: Q [m³/h] &nbsp;P [kW] — para una bomba</div>
      <textarea class="prop-curve prop-power-curve" data-field="powerCurve">${(arc.powerCurve||[]).map(p=>`${esc(p.Q)}\t${esc(p.P)}`).join('\n')}</textarea>`;
    pumpSection = `
      <label class="prop-row"><span>Bombas en paralelo</span>
        <input type="text" inputmode="decimal" value="${esc(arc.nPumps||1)}" min="1" max="10" data-field="nPumps" class="prop-inp" step="1"></label>
      <label class="prop-row"><span>Modo</span>
        <select data-field="pumpMode" class="prop-inp">
          <option value="curve"${pumpMode==='curve'?' selected':''}>Curva H-Q</option>
          <option value="fixedQ"${pumpMode==='fixedQ'?' selected':''}>Caudal fijo (calcular presión)</option>
          <option value="fixedP"${pumpMode==='fixedP'?' selected':''}>Presión fija (calcular caudal)</option>
        </select></label>
      ${pumpModeInputs}`;
  }

  // Fittings table for pipe/valve arcs
  const totalK = arcTotalK(arc); // [v13] fuente única (fittingsK + customK); Infinity si hay válvula cerrada
  let fittingsSection = '';
  // [v21] La tabla generica de accesorios ya no aplica al elemento Valvula dedicado -- ese
  // arco ahora maneja su propio Tipo + % Apertura (ver valveSection mas abajo), conectados
  // directo a arcTotalK(). Sigue disponible sin cambios en tuberias/retencion (isPipe), que es
  // donde viven las "valvulas internas" como un accesorio mas entre varios.
  if (isPipe) {
    const rows = FITTINGS.map((f,i) => {
      const openVal = arc.fitOpen[i] ?? 100;
      const kNow = f.curve ? valveKAtPct(f.curve, openVal) : f.k;
      const openCell = f.curve
        ? `<input type="text" inputmode="decimal" class="fit-open-inp" data-fit-idx="${i}" value="${esc(openVal)}" min="0" max="100" step="5" title="% de apertura — 0% = válvula cerrada">`
        : `<span style="color:var(--faint)">—</span>`;
      return `
      <tr>
        <td>${f.name}</td>
        <td class="fit-k">${fmtK(kNow)}</td>
        <td><input type="text" inputmode="decimal" class="fit-inp" data-fit-idx="${i}"
          value="${esc(arc.fitQty[i]||0)}" min="0" max="99" step="1"></td>
        <td>${openCell}</td>
      </tr>`;
    }).join('');
    fittingsSection = `
      <div class="prop-sep">Accesorios del tramo</div>
      <table class="fit-table">
        <thead><tr><th>Accesorio</th><th>K</th><th>Cant.</th><th>% Apert.</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="fit-total-row">
          <td colspan="3">K total accesorios</td>
          <td id="fit-total-${arc.id}" style="text-align:center">${fmtK(totalK)}</td>
        </tr></tfoot>
      </table>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;line-height:1.5">
        % Apert. solo aplica a válvulas con curva característica (compuerta/esfera/mariposa/globo).
        Curvas típicas de referencia — calibrar con datos del fabricante si se requiere precisión.
      </div>`;
  }

  let equipSection = isEquip ? inp('ΔP fijo [bar]','dp_bar',arc.dp_bar) : '';
  // [v21] Tipo en espanol (VALVE_TYPE_LABELS) + % Apertura propio, conectado de verdad al
  // calculo via arcTotalK() -- antes 'Tipo' se mostraba en ingles/codigo interno y no afectaba
  // el resultado salvo para 'check'; el % apertura real solo funcionaba si se agregaba una
  // valvula en la tabla generica de accesorios (ahora sacada de este panel, ver arriba).
  const valveHasCurve = isValve && !!VALVE_OPENING_CURVES[arc.valveType];
  let valveSection = isValve ? `
      <label class="prop-row"><span>Tipo</span>
        <select data-field="valveType" class="prop-inp">
          ${Object.keys(VALVE_TYPE_LABELS).map(v=>`<option value="${v}"${arc.valveType===v?' selected':''}>${VALVE_TYPE_LABELS[v]}</option>`).join('')}
        </select></label>
      ${valveHasCurve ? inp('% Apertura','open_pct',arc.open_pct??100) : ''}
      ${valveHasCurve ? `<div style="font-size:9px;color:var(--muted);margin-top:-4px;margin-bottom:7px;line-height:1.5">0% cierra el tramo por completo. Curva K-vs-apertura de referencia (no de fabricante) -- calibrar si se requiere precisi\u00f3n de proyecto.</div>` : ''}
      ${inp('ΔP mín [bar]','pmin_bar',arc.pmin_bar||0)}` : '';

  panel.innerHTML = `
    <div class="prop-header" style="border-color:${ARC_COLORS[arc.type]||'#64748b'}">
      <span class="prop-type">${esc(arc.type.toUpperCase())}</span>
      <span class="prop-name">${esc(arc.label)} · ${esc(from?.label||'?')}→${esc(to?.label||'?')}</span>
    </div>
    <div class="prop-body">
      ${inp('Nombre','label',arc.label,'text')}
      ${hasPipe ? buildPipeGeomSection(arc, isPipe) : ''}
      ${isEquip&&!hasPipe ? inp('P mín. entrada [bar]','pmin_bar',arc.pmin_bar??0) : ''}
      ${hasPipe ? inp('K adicional','customK',arc.customK) : ''}
      ${pumpSection}${equipSection}${valveSection}
      ${fittingsSection}
    </div>
    <div class="prop-results">
      ${arc.Q!==null&&arc.Q!==undefined?`<div class="prop-result"><span>Q:</span><span>${(+arc.Q).toFixed(1)} m³/h</span></div>`:''}
      ${arc.V!==null&&arc.V!==undefined?`<div class="prop-result"><span>V:</span><span>${(+arc.V).toFixed(2)} m/s</span></div>`:''}
      ${arc.hf!==null&&arc.hf!==undefined?`<div class="prop-result"><span>${isPump&&(arc.pumpMode||'curve')==='fixedQ'?'Presión requerida':(isPump&&(arc.pumpMode||'curve')==='fixedP'?'Incremento de presión':'Δh')}:</span><span>${(+arc.hf).toFixed(2)} m</span></div>`:''}
      ${arc.Re!==null&&arc.Re!==undefined?`<div class="prop-result"><span>Re:</span><span>${Math.round(arc.Re)}</span></div>`:''}
      ${hasPipe?`<div class="prop-result"><span>K total:</span><span>${fmtK(totalK)}</span></div>`:''}
      ${isPump&&arc.P_hid!=null?`<div class="prop-result"><span>P hid:</span><span>${arc.P_hid.toFixed(2)} kW</span></div>`:''}
      ${isPump&&arc.P_eje!=null?`<div class="prop-result" style="color:var(--amber)"><span>P eje:</span><span>${arc.P_eje.toFixed(2)} kW</span></div>`:''}
    </div>
    <div class="prop-actions">
      <button class="prop-btn delete-btn" onclick="deleteSelected()">🗑 Eliminar</button>
    </div>`;

  panel.querySelectorAll('.prop-inp').forEach(el=>{
    el.addEventListener('change', ()=>{
      const f=el.dataset.field;
      let v;
      if (el.tagName==='SELECT') {
        v=el.value;
      } else if (el.getAttribute('inputmode')==='decimal') {
        // [v19 FIX] antes: +el.value convertía cualquier texto inválido (o vaciado por el
        // navegador al tipear coma decimal) en 0 y lo guardaba en silencio — así se rompían
        // D_mm/L_m (resistencia nula -> no converge) y se perdían valores de bomba sin aviso.
        // Ahora: acepta coma o punto; si no es válido o pisa un piso físico, revierte lo
        // mostrado al valor ya guardado y NO toca el dato.
        const parsed = parseLocaleFloat(el.value);
        // [v26] ε, sarro y longitud negativos no tienen sentido físico (una longitud negativa bloqueaba el tramo en silencio).
        const belowMin = (f==='D_mm' && parsed<=0) || (f==='nPumps' && parsed<1) || ((f==='eps_mm' || f==='fouling_mm' || f==='L_m') && parsed<0);
        const outOfPct = (f==='open_pct' && (parsed<0 || parsed>100)); // [v21] % apertura valvula: 0-100
        if (!Number.isFinite(parsed) || belowMin || outOfPct) { el.value = (arc[f] ?? ''); return; }
        v = parsed;
        el.value = v; // normaliza lo mostrado (por si se tipeó con coma)
      } else {
        v = el.value;
      }
      pushUndo();
      arc[f]=v;
      if (f==='label') renderSidebarLists();
      renderNetwork();
    });
  });
  // [v17] Cambiar el modo de bomba redibuja el panel (curva H-Q vs caudal fijo son inputs distintos)
  const pumpModeEl = panel.querySelector('[data-field="pumpMode"]');
  if (pumpModeEl) pumpModeEl.addEventListener('change', () => renderArcProps(panel, arc));
  // [v22 FIX] Mismo problema que pumpMode: cambiar "Tipo" en un arco Valvula ya abierto en el
  // panel decide si corresponde mostrar "% Apertura" (valveHasCurve, calculado al momento del
  // render). Sin este listener el dato se guardaba bien (arc.valveType) pero el campo %
  // Apertura nunca aparecia hasta cerrar y volver a abrir el panel -- reportado por el usuario
  // con una captura real (Tipo=Mariposa sin campo de apertura visible).
  const valveTypeEl = panel.querySelector('[data-field="valveType"]');
  if (valveTypeEl) valveTypeEl.addEventListener('change', () => renderArcProps(panel, arc));
  // [v26.1] Curvas H-Q y P-Q: la coma es decimal (ver parsearTablaCurva; en v25 «7,5  60,8» se guardaba como Q=7, H=5) y un texto que no se
  // entiende NO se guarda en silencio: al salir del cuadro se avisa debajo y la curva guardada queda como estaba. Mientras se escribe solo se
  // guarda lo que ya es válido (sin avisar a mitad de una fila).
  const avisoCurva = (cuadro, msg) => {
    let el = cuadro.nextElementSibling && cuadro.nextElementSibling.classList.contains('prop-curve-err') ? cuadro.nextElementSibling : null;
    if (!msg) { if (el) el.remove(); cuadro.classList.remove('invalid'); return; }
    if (!el) { el = document.createElement('div'); el.className = 'prop-curve-err'; cuadro.insertAdjacentElement('afterend', el); }
    el.textContent = msg; cuadro.classList.add('invalid');
  };
  // Devuelve los puntos si el texto es válido (y quita el aviso), o null (y, si avisar, lo muestra).
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
    ta.addEventListener('input',  ()=>{ clearTimeout(_deb1); _deb1=setTimeout(()=>parseHQ(false),600); });
    ta.addEventListener('change', ()=>parseHQ(true));
  }
  const taP = panel.querySelector('[data-field="powerCurve"]');
  if (taP) {
    let _deb2;
    const parsePQ = avisar => { const p = leerCurva(taP, 'P', true, avisar); if (p) arc.powerCurve = p; };
    taP.addEventListener('input',  ()=>{ clearTimeout(_deb2); _deb2=setTimeout(()=>parsePQ(false),600); });
    taP.addEventListener('change', ()=>parsePQ(true));
  }

  // Fittings quantity inputs
  // NPS → D_mm
  const npsEl = panel.querySelector('#prop-nps');
  if (npsEl) npsEl.addEventListener('change', () => {
    const d = parseFloat(npsEl.value);
    if (d > 0) {
      arc.D_mm=d; const di=panel.querySelector('[data-field="D_mm"]'); if(di) di.value=d.toFixed(1);
      // [v26] El espesor sigue al diámetro nominal (SCH 40). Con el 5 mm fijo de v25, un DN600 daba una celeridad del golpe de ariete ~25 % baja.
      const dn = DN_LIST.find(x => x.D === d);
      if (dn && dn.t) { arc.wall_mm = dn.t; const wi=panel.querySelector('[data-field="wall_mm"]'); if(wi) wi.value=dn.t.toFixed(2); }
      renderNetwork();
    }
  });
  // Material → eps_mm
  const matEl = panel.querySelector('#prop-material');
  if (matEl) matEl.addEventListener('change', () => {
    const mat = MATERIALS.find(m => m.label === matEl.value);
    if (mat) { arc.eps_mm=mat.eps; arc.material=mat.label; const ei=panel.querySelector('[data-field="eps_mm"]'); if(ei) ei.value=mat.eps.toFixed(4); renderNetwork(); }
  });

  // [v13] refresca el K total mostrado (tabla de accesorios + resumen) tras cambiar cantidad o % apertura
  const _refreshFitTotals = () => {
    const kTxt = fmtK(arcTotalK(arc));
    const tot = document.getElementById('fit-total-'+arc.id);
    if (tot) tot.textContent = kTxt;
    const kRes = panel.querySelector('.prop-results');
    if (kRes) {
      kRes.querySelectorAll('.prop-result').forEach(el => {
        if (el.querySelector('span:first-child')?.textContent==='K total:')
          el.querySelector('span:last-child').textContent = kTxt;
      });
    }
  };
  panel.querySelectorAll('.fit-inp').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.fitIdx;
      const raw = parseLocaleFloat(el.value); // [v19] acepta coma o punto
      arc.fitQty[i] = Math.max(0, Math.round(Number.isFinite(raw)?raw:0));
      el.value = arc.fitQty[i];
      _refreshFitTotals();
    });
  });
  // [v13] % de apertura de válvula → recalcula K de esa fila y los totales
  panel.querySelectorAll('.fit-open-inp').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.fitIdx;
      const raw = parseLocaleFloat(el.value); // [v19] acepta coma o punto
      const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw)?raw:0)));
      if (!Array.isArray(arc.fitOpen) || arc.fitOpen.length !== FITTINGS.length)
        arc.fitOpen = new Array(FITTINGS.length).fill(100);
      arc.fitOpen[i] = v;
      el.value = v;
      const kCell = el.closest('tr')?.querySelector('.fit-k');
      if (kCell) {
        const f = FITTINGS[i];
        kCell.textContent = fmtK(f.curve ? valveKAtPct(f.curve, v) : f.k);
      }
      _refreshFitTotals();
    });
  });
}

// ── Properties panel (HTML uses props-content / props-empty) ──
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
  else { empty.style.display=''; content.style.display='none'; }
}
