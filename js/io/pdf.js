// js/io/pdf.js
'use strict';
/* Memoria de cálculo en PDF (jsPDF + AutoTable): diagrama de la red, tablas y curva bomba-sistema. */

// ── Export PDF ─────────────────────────────────────────────────────────────────
// [v15] Diagrama simplificado de la red para la memoria de cálculo (PDF). La vista de
// pantalla es SVG (no se puede insertar directo como imagen), pero cada nodo ya tiene
// guardada su posición (x,y) — se reutiliza ese layout con un dibujo simple en canvas,
// con la paleta sobria del PDF en vez del tema oscuro de pantalla. Devuelve un dataURL PNG,
// o null si el canvas no está disponible en este navegador (el PDF sigue sin la imagen).
function renderNetworkDiagramCanvas() {
  try {
    const nodes = state.nodes, arcs = state.arcs;
    if (!nodes.length) return null;
    const canvas = document.createElement('canvas');
    const scale = 3;
    const Wc = 480, Hc = 230, legendH = 16;
    canvas.width = Wc*scale; canvas.height = Hc*scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,Wc,Hc);

    const plotH = Hc - legendH;
    const xs = nodes.map(n=>n.x||0), ys = nodes.map(n=>n.y||0);
    const minX=Math.min(...xs), maxX=Math.max(...xs);
    const minY=Math.min(...ys), maxY=Math.max(...ys);
    const pad = 26;
    const spanX = Math.max(maxX-minX, 1), spanY = Math.max(maxY-minY, 1);
    const scaleFit = Math.min((Wc-pad*2)/spanX, (plotH-pad*2)/spanY);
    const offX = (Wc - spanX*scaleFit)/2, offY = (plotH - spanY*scaleFit)/2;
    const px = x => offX + (x-minX)*scaleFit;
    const py = y => offY + (y-minY)*scaleFit;

    const colorArc = a => a.type==='pump' ? '#8B4F9F' : a.type==='valve' ? '#0C447C' : a.type==='equip' ? '#B8860B' : '#8a8a86';

    arcs.forEach(a => {
      const fr = nodes.find(n=>n.id===a.fromId), to = nodes.find(n=>n.id===a.toId);
      if (!fr||!to) return;
      const x1=px(fr.x||0), y1=py(fr.y||0), x2=px(to.x||0), y2=py(to.y||0);
      ctx.strokeStyle = colorArc(a);
      ctx.lineWidth = a.type==='pump' ? 2 : 1.3;
      if (a.type==='equip') ctx.setLineDash([4,2]); else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.setLineDash([]);
      const mx=(x1+x2)/2, my=(y1+y2)/2, dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
      const ux=dx/len, uy=dy/len, ah=3;
      ctx.beginPath();
      ctx.moveTo(mx+ux*ah, my+uy*ah);
      ctx.lineTo(mx-uy*ah*0.6-ux*ah*0.3, my+ux*ah*0.6-uy*ah*0.3);
      ctx.lineTo(mx+uy*ah*0.6-ux*ah*0.3, my-ux*ah*0.6-uy*ah*0.3);
      ctx.closePath();
      ctx.fillStyle = colorArc(a);
      ctx.fill();
      ctx.fillStyle = '#9a9892'; ctx.font = '6px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(a.label||'', mx, my - 4.5);
    });

    nodes.forEach(n => {
      const x=px(n.x||0), y=py(n.y||0);
      if (n.type==='tank') {
        ctx.fillStyle = '#e7f0e9'; ctx.strokeStyle = '#3d6b4f'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.rect(x-6.5,y-5.5,13,11); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#e9f1f9'; ctx.strokeStyle = '#0C447C'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(x,y,5,0,2*Math.PI); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#2c2c2a'; ctx.font = 'bold 7px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(n.label||'', x, y - 9);
    });

    let lx = 10;
    const ly = Hc - 6;
    ctx.font = '6.5px Helvetica'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const legendItem = (draw, label) => {
      draw(lx, ly);
      ctx.fillStyle = '#5F5E5A';
      ctx.fillText(label, lx+13, ly+2.2);
      lx += 13 + ctx.measureText(label).width + 12;
    };
    legendItem((x,y)=>{ ctx.fillStyle='#e9f1f9'; ctx.strokeStyle='#0C447C'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(x+4,y,4,0,2*Math.PI); ctx.fill(); ctx.stroke(); }, 'Nodo');
    legendItem((x,y)=>{ ctx.fillStyle='#e7f0e9'; ctx.strokeStyle='#3d6b4f'; ctx.lineWidth=1; ctx.beginPath(); ctx.rect(x,y-4,10,8); ctx.fill(); ctx.stroke(); }, 'Reservorio');
    legendItem((x,y)=>{ ctx.strokeStyle='#8B4F9F'; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+10,y); ctx.stroke(); }, 'Bomba');
    legendItem((x,y)=>{ ctx.strokeStyle='#8a8a86'; ctx.lineWidth=1.3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+10,y); ctx.stroke(); }, 'Tramo');

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[v15] No se pudo generar el diagrama de la red para el PDF:', e);
    return null;
  }
}

function exportPDF() {
  if (typeof window.jspdf === 'undefined') {
    alert('Librería PDF no disponible: no se cargó libs/jspdf.umd.min.js (o su complemento de tablas). Revisá que la carpeta libs/ esté completa y recargá.'); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297;
  const margin = 14;
  // [v14] Paleta sobria/profesional para impresion (antes: teal + fondo casi negro de la UI)
  const slate  = [30, 41, 59];        // #1e293b - encabezado
  const steel  = [12, 68, 124];       // #0C447C - acento / titulos de seccion
  const ink    = [44, 44, 42];        // #2c2c2a - texto de cuerpo
  const gray   = [95, 94, 90];        // #5F5E5A - texto secundario
  const lightFill  = [241, 239, 232]; // #F1EFE8 - encabezado de tablas
  const altRow     = [247, 246, 241]; // fila alterna
  const borderGray = [211, 209, 199]; // #D3D1C7 - lineas separadoras
  let y = margin;

  const convOk = state.results?.ok;
  const convStr = convOk===true?`Convergió en ${state.results.iterations} iteraciones`:convOk===false?'No convergió':'Sin calcular';

  // ── Portada / encabezado ──
  doc.setFillColor(...slate);
  doc.rect(0, 0, W, 34, 'F');
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.setTextColor(159,179,198);
  doc.text('MEMORIA DE CÁLCULO HIDRÁULICO', margin, 10);
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.setTextColor(255,255,255);
  doc.text(projectMeta.name, margin, 19);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.setTextColor(199,210,221);
  const dateStr = new Date().toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'});
  doc.text(`${projectMeta.rev}   ·   ${dateStr}`, margin, 27);
  if (projectMeta.client)   doc.text(`Cliente: ${projectMeta.client}`, W/2+10, 19);
  if (projectMeta.engineer) doc.text(`Ingeniero: ${projectMeta.engineer}`, W/2+10, 27);
  doc.setFontSize(7); doc.setTextColor(120,138,156);
  doc.text('HYDRA v25', W-margin, 8, {align:'right'});

  y = 42;

  // ── Línea separadora ──
  const hr = () => { doc.setDrawColor(...borderGray); doc.setLineWidth(0.3); doc.line(margin, y, W-margin, y); y += 3; };
  // [v16] Única definición de dnLbl (antes duplicada más abajo, en la sección de materiales) —
  // se usa acá también para la columna "Diámetro" de la tabla de Arcos.
  const dnLbl = D => D!=null ? (DN_LIST.find(d=>d.D&&Math.abs(d.D-D)<0.5)?.label || `${D} mm`) : '-';

  // ── 1. Alcance y metodología ──
  doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
  doc.text('1. ALCANCE Y METODOLOGÍA', margin, y); y += 4; hr();
  doc.setFont('helvetica','normal'); doc.setTextColor(...ink); doc.setFontSize(8);
  const fluidTypeSel = document.getElementById('fluid-type')?.value || 'water';
  // [v16] Nombre del fluido personalizado, si el usuario lo cargó (si no, texto genérico)
  const customFluidName = (fluid.customName||'').trim() || 'Fluido personalizado';
  // [v15] Sin letras griegas ni exponentes unicode: la fuente estándar de jsPDF (Helvetica)
  // no las soporta y las reemplaza por caracteres basura (ver correcciones.md).
  const fluidDesc = fluidTypeSel === 'custom'
    ? `${customFluidName}: densidad = ${fluid.rho.toFixed(1)} kg/m³, viscosidad cinemática = ${(fluid.nu*1e6).toFixed(4)}×10^-6 m²/s.`
    : `Agua a ${document.getElementById('fluid-temp')?.value || 20} °C (densidad = ${fluid.rho.toFixed(1)} kg/m³, viscosidad cinemática = ${(fluid.nu*1e6).toFixed(4)}×10^-6 m²/s, según tabla de propiedades).`;
  const tol = document.getElementById('solver-tol')?.value || '1e-4';
  const maxIter = document.getElementById('solver-maxiter')?.value || 100;
  const metodoLines = [
    `Fluido: ${fluidDesc}`,
    `Pérdida de carga por fricción: ecuación de Colebrook-White (régimen turbulento, Re > 2300) / Hagen-Poiseuille (régimen laminar, Re < 2300).`,
    `Pérdidas localizadas: coeficiente de resistencia K por accesorio (codos, tees, válvulas, incluyendo % de apertura en válvulas manuales).`,
    `Resolución de la red: balance de masa y energía por nodo mediante solver Newton-Raphson con Jacobiano analítico. Tolerancia de convergencia ${tol}, máximo ${maxIter} iteraciones.`,
    `Resultado de esta corrida: ${convStr}.`,
    `Hipótesis: régimen permanente, fluido incompresible, propiedades del fluido uniformes en toda la red.`,
  ];
  metodoLines.forEach(line => {
    const wrapped = doc.splitTextToSize('•  ' + line, W - margin*2);
    doc.text(wrapped, margin, y); y += wrapped.length*3.7 + 1.3;
  });
  y += 3;

  // ── 2. Resumen de la red ──
  if (y > H - 40) { doc.addPage(); y = margin; }
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...steel);
  doc.text('2. RESUMEN DE LA RED', margin, y); y += 4; hr();
  doc.setFont('helvetica','normal'); doc.setTextColor(...ink); doc.setFontSize(8);
  const sumRows = [
    [`Nodos: ${state.nodes.length}`, `Arcos: ${state.arcs.length}`, `Densidad: ${fluid.rho.toFixed(1)} kg/m³`],
    [`Solver: ${convStr}`, `Visc. cinemática: ${(fluid.nu*1e6).toFixed(4)}×10^-6 m²/s`, fluidTypeSel==='custom' ? `Fluido: ${customFluidName}` : ``],
  ];
  sumRows.forEach(row => {
    doc.text(row[0], margin, y); doc.text(row[1], W/2-10, y); doc.text(row[2], W-margin, y, {align:'right'});
    y += 5;
  });
  if (projectMeta.notes) {
    y += 1;
    doc.setTextColor(...gray);
    doc.text('Notas:', margin, y); y += 4;
    const lines = doc.splitTextToSize(projectMeta.notes, W - margin*2);
    doc.text(lines, margin, y); y += lines.length * 4 + 2;
  }
  y += 3;

  // ── 3. Tabla de nodos ──
  if (state.nodes.length) {
    if (y > H - 60) { doc.addPage(); y = margin; }
    doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
    doc.text('3. NODOS', margin, y); y += 4; hr();

    // [v15] Diagrama simplificado, para ubicar visualmente los nodos de la tabla
    const diagImg = renderNetworkDiagramCanvas();
    if (diagImg) {
      const diagW = W - margin*2, diagH = diagW * (230/480);
      if (y + diagH > H - 20) { doc.addPage(); y = margin; }
      doc.addImage(diagImg, 'PNG', margin, y, diagW, diagH);
      y += diagH + 5;
    } else {
      doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text('(no se pudo generar el diagrama en este navegador)', margin, y+4); y += 8;
      doc.setFont('helvetica','normal'); doc.setTextColor(...ink); doc.setFontSize(8);
    }

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.5, font: 'helvetica', textColor: ink },
      headStyles: { fillColor: lightFill, textColor: steel, fontStyle: 'bold', lineWidth: 0.1, lineColor: borderGray },
      alternateRowStyles: { fillColor: altRow },
      head: [['ID','Nombre','Tipo','Cota [m]','H [m]','P [bar]','Demanda [m3/h]']],
      body: state.nodes.map(n => [
        n.id, n.label, n.type, (n.cota??0).toFixed(1),
        n.H!=null?(+n.H).toFixed(2):'-',
        n.P!=null?(+n.P).toFixed(3):'-',
        (n.demand||0).toFixed(1)
      ]),
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── 4. Tabla de arcos ──
  if (state.arcs.length) {
    if (y > H - 60) { doc.addPage(); y = margin; }
    doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
    doc.text('4. ARCOS', margin, y); y += 4; hr();
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, font: 'helvetica', textColor: ink },
      headStyles: { fillColor: lightFill, textColor: steel, fontStyle: 'bold', lineWidth: 0.1, lineColor: borderGray },
      alternateRowStyles: { fillColor: altRow },
      head: [['Nombre','Tipo','Diámetro','De -> A','Q [m3/h]','V [m/s]','dH [m]','Re','Regimen']],
      body: state.arcs.map(a => {
        const fr=findNode(a.fromId), t=findNode(a.toId);
        return [
          a.label, a.type, dnLbl(a.D_mm),
          `${fr?.label||'?'} -> ${t?.label||'?'}`,
          a.Q!=null?Math.abs(+a.Q).toFixed(1):'-',
          a.V!=null?(+a.V).toFixed(2):'-',
          a.hf!=null?(+a.hf).toFixed(2):'-',
          a.Re!=null?Math.round(a.Re).toLocaleString():'-',
          a.regime||'-',
        ];
      }),
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── 4.1 Accesorios por tramo ──
  // [v21] Detalle de accesorios (codos, tees, válvulas internas, etc.) por tramo, y de los
  // elementos Válvula dedicados que tengan curva K-vs-apertura, con su % de apertura actual.
  // Usa arcAccessoryRows() — misma fuente que fittingsK()/arcTotalK() — para no duplicar la
  // lógica de accesorios ya usada por el solver y por el resumen en pantalla (BOM). Sin columna
  // de K: esta tabla es de inventario/configuración, no de resultados de cálculo.
  const accessoryRows = [];
  state.arcs.forEach(a => {
    arcAccessoryRows(a).forEach(r => accessoryRows.push([
      a.label, r.accesorio, String(r.cantidad),
      r.tipo ?? '-',
      r.apertura != null ? `${r.apertura}%` : '-',
    ]));
  });
  if (accessoryRows.length) {
    if (y > H - 60) { doc.addPage(); y = margin; }
    doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
    doc.text('4.1 ACCESORIOS POR TRAMO', margin, y); y += 4; hr();
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, font: 'helvetica', textColor: ink },
      headStyles: { fillColor: lightFill, textColor: steel, fontStyle: 'bold', lineWidth: 0.1, lineColor: borderGray },
      alternateRowStyles: { fillColor: altRow },
      head: [['Tramo','Accesorio','Cantidad','Tipo','% Apertura']],
      body: accessoryRows,
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── 5. Curva de la bomba y del sistema ──
  // [v18] Un solo bloque para los tres modos: siempre se intenta el gráfico (curva de sistema
  // real, calculada igual sin importar el modo; la curva de catálogo solo se dibuja en modo
  // curva). Antes había dos bloques separados (con/sin curva de catálogo) — se unifican para
  // no mantener dos veces la misma lógica de layout.
  const pumpArcsAll = state.arcs.filter(a=>a.type==='pump');
  if (pumpArcsAll.length) {
    if (y > H - 90) { doc.addPage(); y = margin; }
    doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
    doc.text('5. CURVA DE LA BOMBA Y DEL SISTEMA', margin, y); y += 4; hr();
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    const introChart = doc.splitTextToSize('Curva H-Q de cada bomba (cuando aplica) contra la curva de resistencia de la red (resuelta numéricamente a distintos caudales), con el punto resultante de esta corrida.', W-margin*2);
    doc.text(introChart, margin, y); y += introChart.length*3.6 + 3;

    pumpArcsAll.forEach(pump => {
      if (y > H - 95) { doc.addPage(); y = margin; }
      const mode = pump.pumpMode || 'curve';
      const sysCurve = computeSystemCurve(redActual(), pump);
      const imgData = renderPumpSystemChartCanvas(pump, sysCurve);
      const imgW = 122, imgH = 61;
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...ink);
      doc.text(pump.label || ('Bomba ' + pump.id), margin, y);
      y += 3;
      if (mode !== 'curve') {
        doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(...gray);
        const note = mode==='fixedQ'
          ? 'Modo caudal fijo: entrega este caudal sin límite de presión — la red exige la presión mostrada.'
          : 'Modo presión fija: entrega esta presión en la descarga (dato del manómetro, siempre ahí) — la red exige el caudal mostrado.';
        const noteLines = doc.splitTextToSize(note, imgW);
        doc.text(noteLines, margin, y); y += noteLines.length*3.2 + 2;
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
      }
      const imgY = y;
      if (imgData) doc.addImage(imgData, 'PNG', margin, imgY, imgW, imgH);
      else { doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...gray);
        doc.text('(sin datos suficientes para graficar — calculá la red primero)', margin, imgY+8); }
      const qop = pump.Q != null ? Math.abs(pump.Q) : null;
      const hop = pump.hf != null ? pump.hf : null;
      const kx = margin + imgW + 10;
      let ky = imgY + 8;
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
      const kpi = (lbl,val) => {
        doc.setTextColor(...gray); doc.text(lbl, kx, ky);
        doc.setTextColor(...ink); doc.setFont('helvetica','bold'); doc.text(val, kx, ky+4.2);
        doc.setFont('helvetica','normal'); ky += 12;
      };
      if (mode === 'fixedQ') {
        kpi('Caudal fijado', qop!=null ? qop.toFixed(1)+' m³/h' : '—');
        kpi('Presión requerida', hop!=null ? hop.toFixed(2)+' m' : '—');
      } else if (mode === 'fixedP') {
        kpi('Presión fijada', pump.fixedP_bar!=null ? pump.fixedP_bar.toFixed(2)+' bar' : '—');
        kpi('Caudal resultante', qop!=null ? qop.toFixed(1)+' m³/h' : '—');
      } else {
        kpi('Q de operación', qop!=null ? qop.toFixed(1)+' m³/h' : '—');
        kpi('H de operación', hop!=null ? hop.toFixed(2)+' m' : '—');
      }
      kpi('Potencia al eje', pump.P_eje!=null ? pump.P_eje.toFixed(2)+' kW' : '—');
      y = imgY + imgH + 8;
    });
  }

  // ── 6. BOM Tuberías ──
  const pipes = state.arcs.filter(a=>a.type==='pipe'||a.type==='check');
  if (pipes.length) {
    if (y > H - 60) { doc.addPage(); y = margin; }
    doc.setFont('helvetica','bold'); doc.setTextColor(...steel); doc.setFontSize(9);
    doc.text('6. LISTA DE MATERIALES — TUBERÍAS', margin, y); y += 4; hr();
    const pipeGroups2 = {};
    pipes.forEach(a => {
      const key = `D${a.D_mm}_e${a.eps_mm}`;
      if (!pipeGroups2[key]) pipeGroups2[key] = { D_mm: a.D_mm, eps_mm: a.eps_mm, totalL: 0, count: 0 };
      pipeGroups2[key].totalL += a.L_m || 0;
      pipeGroups2[key].count++;
    });
    const matLbl = eps => MATERIALS.find(m=>Math.abs(m.eps-eps)<1e-5)?.label || `rugosidad ${eps}`;
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.5, font: 'helvetica', textColor: ink },
      headStyles: { fillColor: lightFill, textColor: steel, fontStyle: 'bold', lineWidth: 0.1, lineColor: borderGray },
      head: [['Diámetro','Material','ε [mm]','Long. total [m]','N° tramos']],
      body: Object.values(pipeGroups2).map(g=>[dnLbl(g.D_mm),matLbl(g.eps_mm),g.eps_mm,g.totalL.toFixed(1),g.count]),
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Pie de página en cada hoja ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...borderGray); doc.setLineWidth(0.2); doc.line(margin, H-10, W-margin, H-10);
    doc.setFontSize(7); doc.setTextColor(...gray); doc.setFont('helvetica','normal');
    doc.text(`Hydra v25  ·  ${projectMeta.name}  ·  ${projectMeta.rev}`, margin, H-6);
    doc.text(`Página ${i} de ${pageCount}`, W-margin, H-6, {align:'right'});
    doc.text(dateStr, W/2, H-6, {align:'center'});
  }

  doc.save(`${projectMeta.name.replace(/[^a-z0-9_\-]/gi,'_').slice(0,100)}_${projectMeta.rev.replace(/\s/g,'').slice(0,40)}.pdf`);   // [repo] nombres de archivo acotados (un nombre larguísimo no se podía guardar)
}

// Dibuja la curva bomba-sistema en un canvas offscreen y devuelve un dataURL PNG para el PDF.
// Si el navegador no puede generar el canvas (o algo falla), devuelve null y el PDF sigue sin la imagen.
function renderPumpSystemChartCanvas(pump, sysCurvePts) {
  try {
    // [v18] En modo curva se dibuja la curva de catálogo + la de sistema + el cruce, como
    // siempre. En caudal fijo / presión fija no hay curva de catálogo real (pump.pumpCurve
    // puede tener datos viejos/no usados) — se omite esa línea y se deja solo la curva de
    // sistema con el punto resultante marcado y su valor anotado al lado.
    const mode = pump.pumpMode || 'curve';
    const nP_ = pump.nPumps||1;
    const curve = mode==='curve' && pump.pumpCurve && pump.pumpCurve.length>=2
      ? [...pump.pumpCurve].sort((a,b)=>a.Q-b.Q).map(p=>({Q:p.Q*nP_, H:p.H}))
      : [];
    const sysPts = (sysCurvePts||[]).filter(p=>Number.isFinite(p.H));
    const qop = pump.Q!=null ? Math.abs(pump.Q) : null;
    const hop = pump.hf!=null ? pump.hf : (qop!=null && mode==='curve' ? pumpHead(qop/nP_, pump) : null);

    if (!curve.length && sysPts.length<2 && (qop==null || hop==null)) return null; // nada que graficar

    const canvas = document.createElement('canvas');
    const scale = 3;
    const Wc = 480, Hc = 240;
    canvas.width = Wc*scale; canvas.height = Hc*scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,Wc,Hc);

    const allQ = curve.map(p=>p.Q).concat(sysPts.map(p=>p.Q)).concat(qop!=null?[qop]:[]);
    const allH = curve.map(p=>p.H).concat(sysPts.map(p=>p.H)).concat(hop!=null?[hop]:[]);
    const maxQ = Math.max(...allQ, 1) * 1.05;
    const maxH = Math.max(...allH, 1) * 1.15;

    const pad = {l:36, r:14, t:12, b:26};
    const px = q => pad.l + (q/maxQ)*(Wc-pad.l-pad.r);
    const py = h => pad.t + (1-Math.max(h,0)/maxH)*(Hc-pad.t-pad.b);

    ctx.strokeStyle = '#e1e0d9'; ctx.lineWidth = 1; ctx.font = '10px Helvetica';
    for (let i=0;i<=4;i++){
      const yy = pad.t + i*(Hc-pad.t-pad.b)/4;
      ctx.beginPath(); ctx.moveTo(pad.l,yy); ctx.lineTo(Wc-pad.r,yy); ctx.stroke();
      ctx.fillStyle='#898781'; ctx.textAlign='right'; ctx.fillText((maxH*(1-i/4)).toFixed(0), pad.l-4, yy+3);
    }
    for (let i=0;i<=4;i++){
      const xx = pad.l + i*(Wc-pad.l-pad.r)/4;
      ctx.beginPath(); ctx.moveTo(xx,pad.t); ctx.lineTo(xx,Hc-pad.b); ctx.stroke();
      ctx.fillStyle='#898781'; ctx.textAlign='center'; ctx.fillText((maxQ*i/4).toFixed(0), xx, Hc-pad.b+13);
    }
    ctx.fillStyle='#5F5E5A'; ctx.textAlign='center';
    ctx.fillText('Q [m³/h]', pad.l+(Wc-pad.l-pad.r)/2, Hc-4);
    ctx.save(); ctx.translate(11,pad.t+(Hc-pad.t-pad.b)/2); ctx.rotate(-Math.PI/2); ctx.fillText('H [m]',0,0); ctx.restore();

    if (sysPts.length>=2) {
      ctx.strokeStyle = '#993C1D'; ctx.lineWidth = 2; ctx.beginPath();
      sysPts.forEach((p,i)=> i===0?ctx.moveTo(px(p.Q),py(p.H)):ctx.lineTo(px(p.Q),py(p.H)));
      ctx.stroke();
    }
    if (curve.length) {
      ctx.strokeStyle = '#185FA5'; ctx.lineWidth = 2; ctx.beginPath();
      curve.forEach((p,i)=> i===0?ctx.moveTo(px(p.Q),py(p.H)):ctx.lineTo(px(p.Q),py(p.H)));
      ctx.stroke();
    }

    if (qop!=null && hop!=null) {
      ctx.beginPath(); ctx.arc(px(qop),py(hop),5,0,2*Math.PI);
      ctx.fillStyle = '#1e293b'; ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle='#ffffff'; ctx.stroke();
      if (mode !== 'curve') {
        // [v18] Sin curva de catálogo, el valor anotado junto al punto es la única forma de
        // "ver" el cruce en el gráfico — se pidió explícitamente que sea visible ahí mismo.
        ctx.textAlign='left'; ctx.font='bold 9px Helvetica'; ctx.fillStyle='#1e293b';
        ctx.fillText(qop.toFixed(1)+' m³/h', px(qop)+7, py(hop)-4);
        ctx.font='9px Helvetica'; ctx.fillStyle='#5F5E5A';
        ctx.fillText(hop.toFixed(2)+' m', px(qop)+7, py(hop)+7);
      }
    }

    ctx.textAlign='left'; ctx.font='9px Helvetica';
    let legY = pad.t;
    if (curve.length) {
      ctx.fillStyle='#185FA5'; ctx.fillRect(Wc-138,legY,10,2); ctx.fillStyle='#5F5E5A'; ctx.fillText('Bomba', Wc-124, legY+4);
      legY += 11;
    }
    if (sysPts.length>=2) {
      ctx.fillStyle='#993C1D'; ctx.fillRect(Wc-138,legY,10,2); ctx.fillStyle='#5F5E5A'; ctx.fillText('Sistema', Wc-124, legY+4);
      legY += 12;
    }
    if (qop!=null) {
      ctx.fillStyle='#1e293b'; ctx.beginPath(); ctx.arc(Wc-133,legY+3,3,0,2*Math.PI); ctx.fill();
      ctx.fillStyle='#5F5E5A'; ctx.fillText(mode==='curve' ? 'Operación' : 'Resultado', Wc-124, legY+6);
    }

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[v14] No se pudo generar el gráfico bomba-sistema para el PDF:', e);
    return null;
  }
}
