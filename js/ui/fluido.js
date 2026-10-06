// js/ui/fluido.js
'use strict';
/* Panel de fluido: lee los campos de pantalla y actualiza el fluido del estado. */

function onFluidChange() {
  const custom = document.getElementById('fluid-type').value==='custom';
  document.getElementById('custom-fluid').style.display = custom?'':'none';
  // [v13 FIX] la temperatura ya no se deshabilita en modo personalizado: antes quedaba
  // bloqueada y el usuario no podía editarla. Sigue sin afectar ρ/ν cuando el fluido es
  // personalizado (esos vienen de los campos ρ y ν), pero el campo debe poder editarse siempre.
  if (custom) {
    // [v19 FIX] parseLocaleFloat acepta coma o punto — antes +value convertía un typo con
    // coma en NaN/"" y quedaba en el fallback de agua (998.2/1.004) en silencio, pisando el
    // fluido personalizado real del usuario sin ningún aviso.
    const rhoP = parseLocaleFloat(document.getElementById('fluid-rho').value);
    fluid.rho = (Number.isFinite(rhoP) && rhoP>0) ? rhoP : 998.2;
    const nuP = parseLocaleFloat(document.getElementById('fluid-nu').value);
    fluid.nu  = ((Number.isFinite(nuP) && nuP>0) ? nuP : 1.004)*1e-6;
    fluid.customName = (document.getElementById('fluid-name')?.value || '').trim(); // [v16]
  } else {
    const Tp = parseLocaleFloat(document.getElementById('fluid-temp').value);
    const T = Number.isFinite(Tp) ? Tp : 20;
    [fluid.rho, fluid.nu] = getWaterProps(T);
  }
  document.getElementById('fluid-info').textContent =
    `ρ = ${fluid.rho.toFixed(2)} kg/m³ · ν = ${(fluid.nu*1e6).toFixed(4)}×10⁻⁶ m²/s`;
}

// ── initFluidPanel: fluid already wired via onFluidChange() inline ──
function initFluidPanel() {
  onFluidChange(); // sync display from current inputs
}
