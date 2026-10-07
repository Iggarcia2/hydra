// js/io/excel.js
'use strict';
/* Exportación a Excel (SheetJS). */

function exportExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Librería Excel no disponible: no se cargó libs/xlsx.full.min.js. Revisá que la carpeta libs/ esté completa y recargá.'); return;
  }
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen
  const convOk = state.results?.ok;
  const resData = [
    [`Hydra ${VERSION_APP} — Calculadora de Redes Hidráulicas`],
    ['Fecha:', new Date().toLocaleDateString('es-AR')],
    [],
    ['Nodos:', state.nodes.length],
    ['Arcos:', state.arcs.length],
    ['Fluido:', `ρ=${fluid.rho.toFixed(2)} kg/m³  ν=${(fluid.nu*1e6).toFixed(4)}x10⁻⁶ m²/s`],
    ['Convergencia:', convOk===true?`Si (${state.results.iterations} iter)`:convOk===false?'No convergio':'Sin calcular'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resData), 'Resumen');

  // Hoja 2: Nodos
  const nodesRows = [['ID','Nombre','Tipo','Cota [m]','H [m]','P [bar]','Demanda [m3/h]']];
  for (const n of state.nodes) nodesRows.push([
    n.id, n.label, n.type, n.cota??0,
    n.H!=null?+(+n.H).toFixed(4):null,
    n.P!=null?+(+n.P).toFixed(4):null,
    n.demand||0
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nodesRows), 'Nodos');

  // Hoja 3: Arcos
  const arcsRows = [['ID','Nombre','Tipo','De','A','Q [m3/h]','V [m/s]','dH [m]','Re','Regimen','f','P_hid [kW]','P_eje [kW]']];
  for (const a of state.arcs) {
    const fr=findNode(a.fromId), t=findNode(a.toId);
    arcsRows.push([a.id, a.label, a.type, fr?.label||'?', t?.label||'?',
      a.Q!=null?+(+a.Q).toFixed(3):null, a.V!=null?+(+a.V).toFixed(4):null,
      a.hf!=null?+(+a.hf).toFixed(3):null, a.Re!=null?Math.round(a.Re):null,
      a.regime||'-', a.f!=null?+(+a.f).toFixed(6):null,
      a.P_hid!=null?+(+a.P_hid).toFixed(3):null, a.P_eje!=null?+(+a.P_eje).toFixed(3):null
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(arcsRows), 'Arcos');

  // Hoja 4: BOM
  const fitNames = FITTINGS.map(f => f.name);
  const bomRows = [['Nombre','Tipo','Material','eps [mm]','D int [mm]','L [m]','K total', ...fitNames, 'Q [m3/h]','V [m/s]','Re','Regimen']];
  for (const a of state.arcs) {
    if (a.type==='pipe'||a.type==='check') {
      const Kraw = arcTotalK(a);
      const K = Number.isFinite(Kraw) ? +Kraw.toFixed(3) : 'Cerrada (K=∞)';
      const fQty = FITTINGS.map((_, i) => (a.fitQty || [])[i] || 0);
      bomRows.push([a.label, a.type, etiquetaMaterial(a), a.eps_mm ?? EPS_DEFECTO_MM, a.D_mm||200, a.L_m||0, K, ...fQty,
        a.Q!=null?+(+a.Q).toFixed(3):null, a.V!=null?+(+a.V).toFixed(4):null,
        a.Re!=null?Math.round(a.Re):null, a.regime||'-']);
    } else {
      const fQty = FITTINGS.map(() => 0);
      bomRows.push([a.label, a.type, '-', '-', a.D_mm||'-', '-', '-', ...fQty,
        a.Q!=null?+(+a.Q).toFixed(3):null, a.V!=null?+(+a.V).toFixed(4):null, '-', a.regime||a.type]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bomRows), 'BOM');

  XLSX.writeFile(wb, `red_hidraulica_${new Date().toISOString().slice(0,10)}.xlsx`);
}
