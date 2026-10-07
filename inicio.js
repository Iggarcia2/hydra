// js/ui/inicio.js
'use strict';
/* Red de ejemplo con la que arranca la aplicación. */

// ── initDefaults: fix fluid reference ──
function initDefaults() {
  const Ts = mkNode('tank',    140, 240, {label:'TS', cota:0, p_bar:0.5});
  const J1 = mkNode('junction',310, 240, {label:'J1', demand:0, cota:0});
  const J2 = mkNode('junction',450, 150, {label:'J2', demand:0, cota:5});
  const J3 = mkNode('junction',450, 330, {label:'J3', demand:0, cota:2});
  const Te = mkNode('tank',    590, 240, {label:'TD', cota:5, p_bar:0});
  state.nodes.push(Ts, J1, J2, J3, Te);

  const pump = mkArc('pump', Ts.id, J1.id, {label:'BM-01',
    pumpCurve:[{Q:0,H:30},{Q:50,H:28},{Q:100,H:24},{Q:150,H:18},{Q:200,H:10},{Q:220,H:0}]});
  const p1   = mkArc('pipe', J1.id, J2.id, {label:'T1', D_mm:150, L_m:120, eps_mm:0.046});
  const p2   = mkArc('pipe', J1.id, J3.id, {label:'T2', D_mm:100, L_m:80,  eps_mm:0.046});
  const p3   = mkArc('pipe', J2.id, Te.id, {label:'T3', D_mm:150, L_m:30,  eps_mm:0.046});
  const p4   = mkArc('pipe', J3.id, Te.id, {label:'T4', D_mm:100, L_m:30,  eps_mm:0.046});
  state.arcs.push(pump, p1, p2, p3, p4);

  renderNetwork(); renderSidebarLists(); renderProps();
  renderKPIs();
  setTimeout(zoomFit, 50);
  updateHint('Red de ejemplo cargada · Presioná ↵ o "Calcular" para resolver');
}
