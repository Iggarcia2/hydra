// js/ui/fluido.js
'use strict';
/* Panel de fluido: soporta agua por temperatura, biblioteca de fluidos de parciales y modo personalizado con ρ/SG/γ y ν/μ. */

function _populateFluidPresetsSelect() {
  const sel = document.getElementById('fluid-type');
  if (!sel || sel.dataset.presetsLoaded === '1' || typeof FLUID_PRESETS === 'undefined') return;
  const customOpt = sel.querySelector('option[value="custom"]');
  const groups = {};
  for (const p of FLUID_PRESETS) {
    if (!groups[p.group]) {
      const og = document.createElement('optgroup');
      og.label = p.group;
      groups[p.group] = og;
      sel.insertBefore(og, customOpt);
    }
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    groups[p.group].appendChild(opt);
  }
  sel.dataset.presetsLoaded = '1';
}

function onFluidChange() {
  const selEl = document.getElementById('fluid-type');
  const selVal = selEl ? selEl.value : 'water';
  const isWater = selVal === 'water';
  const isCustom = selVal === 'custom';
  const preset = (!isWater && !isCustom) ? getFluidPreset(selVal) : null;

  const customBox = document.getElementById('custom-fluid');
  const tempBox = document.getElementById('water-temp-box');
  if (customBox) customBox.style.display = isCustom ? '' : 'none';
  if (tempBox) tempBox.style.display = isWater ? '' : 'none';

  fluid.presetId = selVal;

  if (isCustom) {
    const rhoMode = document.getElementById('fluid-rho-mode')?.value || 'rho';
    const viscMode = document.getElementById('fluid-visc-mode')?.value || 'nu_cst';
    fluid.rhoMode = rhoMode;
    fluid.viscMode = viscMode;

    const lblRho = document.getElementById('lbl-fluid-rho');
    if (lblRho) lblRho.textContent = rhoMode === 'sg' ? 'Valor SG [-]' : rhoMode === 'gamma' ? 'Valor γ [kN/m³]' : 'Valor ρ [kg/m³]';
    const lblNu = document.getElementById('lbl-fluid-nu');
    if (lblNu) lblNu.textContent = viscMode === 'mu_pas' ? 'Valor μ [Pa·s]' : viscMode === 'mu_cp' ? 'Valor μ [cP]' : 'Valor ν [cSt]';

    const rawRho = parseLocaleFloat(document.getElementById('fluid-rho')?.value);
    if (Number.isFinite(rawRho) && rawRho > 0) {
      fluid.rho = rhoMode === 'sg' ? rawRho * 1000.0 : rhoMode === 'gamma' ? (rawRho * 1000.0 / G) : rawRho;
    } else {
      fluid.rho = 998.2;
    }

    const rawVisc = parseLocaleFloat(document.getElementById('fluid-nu')?.value);
    if (Number.isFinite(rawVisc) && rawVisc > 0) {
      if (viscMode === 'mu_pas') fluid.nu = rawVisc / fluid.rho;
      else if (viscMode === 'mu_cp') fluid.nu = (rawVisc * 1e-3) / fluid.rho;
      else fluid.nu = rawVisc * 1e-6;
    } else {
      fluid.nu = 1.004e-6;
    }
    fluid.pv_pa = 2339;
    fluid.bulk_pa = K_WATER;
    fluid.customName = (document.getElementById('fluid-name')?.value || '').trim();
  } else if (preset) {
    fluid.rho = preset.rho;
    fluid.nu = preset.nu;
    fluid.pv_pa = preset.pv_pa;
    fluid.bulk_pa = preset.bulk_pa;
    fluid.customName = preset.label;
  } else {
    const Tp = parseLocaleFloat(document.getElementById('fluid-temp')?.value);
    const T = Number.isFinite(Tp) ? Tp : 20;
    [fluid.rho, fluid.nu] = getWaterProps(T);
    fluid.pv_pa = getWaterVaporPressurePa(T);
    fluid.bulk_pa = K_WATER;
    fluid.customName = '';
  }

  const mu_cp = fluid.rho * fluid.nu * 1e3;
  const infoEl = document.getElementById('fluid-info');
  if (infoEl) {
    infoEl.textContent = `ρ = ${fluid.rho.toFixed(1)} kg/m³ · μ = ${mu_cp < 10 ? mu_cp.toFixed(3) : mu_cp.toFixed(1)} cP · ν = ${(fluid.nu * 1e6).toFixed(3)} cSt`;
  }
}

function initFluidPanel() {
  _populateFluidPresetsSelect();
  onFluidChange();
}
