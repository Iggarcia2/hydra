// js/nucleo/hidraulica.js
'use strict';
/* Fricción (Colebrook-White / Hagen-Poiseuille) y caudal de un tramo dado el salto de carga. */

function colebrook(Re, eD) {
  if (Re < 1)    return 0.02;
  if (Re < 2300) return 64/Re;
  let f = 0.25/Math.pow(Math.log10(eD/3.7 + 5.74/Math.pow(Re,0.9)),2);
  for (let i=0; i<60; i++) {
    const fn = 1/Math.pow(-2*Math.log10(eD/3.7 + 2.51/(Re*Math.sqrt(f))),2);
    if (Math.abs(fn-f)<1e-10){f=fn;break;} f=fn;
  }
  return f;
}

// Compute pipe flow Q [m³/h] from i→j given head difference dH [m]
// Also returns {Q, V, Re, f, hf, regime, conductance}
// [repo] `fluid` ({rho, nu}) es ahora un parámetro: el motor ya no lee variables globales.
function pipeCalc(dH, arc, fluid) {
  if (!fluid || !(Number.isFinite(fluid.nu) && fluid.nu > 0)) throw new Error('pipeCalc: falta el fluido o su viscosidad cinemática no es positiva');
  const {D_mm,L_m,eps_mm} = arc;
  const K = arcTotalK(arc);
  if (!Number.isFinite(K)) // [v13] válvula al 0% de apertura bloquea el tramo (K→∞)
    return {Q:0, V:0, Re:0, f:0.02, hf:0, regime:'Cerrada', cond:0};
  // [v23] El arco Valvula dedicado se trata como una pérdida puntual (K de la válvula +
  // accesorios), sin fricción de tramo propia — el panel ya no muestra ni deja editar
  // Longitud/Rugosidad/Espesor/Sarro para este tipo de arco (ver buildPipeGeomSection), así que
  // tampoco deben influir en el cálculo: se ignora el término f·L/D sin importar qué L_m haya
  // quedado guardado (default, o de un proyecto guardado antes de la v23). El diámetro SÍ se
  // sigue usando (área/velocidad/Re) — es el único dato geométrico que conserva este arco.
  const isValveArc = arc.type === 'valve';
  const Lterm = isValveArc ? 0 : L_m;
  // [v24 FIX] Un arco Valvula sin ninguna perdida propia (ej. Retencion sin accesorios ni K
  // adicional -> arcTotalK da 0 exacto) combinado con Lterm=0 (v23) deja el tramo SIN NINGUNA
  // resistencia definida -- mismo "Sistema singular" que ya se documentaba para K=Infinito (0%
  // de apertura) pero en el extremo opuesto, y sin necesitar una valvula cerrada: alcanza con
  // una Retencion sola, sin nada mas, que es justo el uso mas simple y esperable del elemento.
  // Antes de la v23 esto no pasaba porque siempre quedaba la friccion de L_m (100 m por
  // defecto) como resistencia de respaldo. Piso minimo (muy por debajo de la menor perdida real
  // de VALVE_OPENING_CURVES/FITTINGS, ej. esfera 100% abierta = 0.05) para que el caso
  // degenerado no se dispare -- no cambia ningun resultado real, un arco Valvula con perdida
  // propia genuina (K>0.01, cualquier caso real) sigue usando su K exacto sin tocar.
  const Keff = (isValveArc && K <= 0) ? 0.01 : K;
  const eps_eff = (eps_mm||0.046) + (arc.fouling_mm||0);
  const D = D_mm/1000, A = Math.PI*D*D/4, eD = (eps_eff/1000)/D;
  // [FIX] resistencia nula (L=0 sin accesorios) -> evita Q=Infinity y NaN en el Jacobiano
  const resistanceless = (Lterm <= 0) && (Keff <= 0);
  if (Math.abs(dH) < 1e-12 || D <= 0 || Lterm < 0 || resistanceless || !Number.isFinite(dH))
    return {Q:0, V:0, Re:0, f:0.02, hf:0, regime:'—', cond:0};
  const sign = dH > 0 ? 1 : -1;
  const adH = Math.abs(dH);
  let f = 0.02;
  let Q = 0, V = 0, Re = 0;
  for (let i=0; i<12; i++) {
    const r = (f*Lterm/D + Keff)/(2*G*A*A);
    Q = sign * Math.sqrt(adH/r);  // m³/s
    V = Math.abs(Q)/A;
    Re = V*D/fluid.nu;
    f = colebrook(Re, eD);
  }
  const regime = Re<2300?'Laminar':Re<4000?'Transición':'Turbulento';
  const cond = Math.abs(Q) > 1e-10 ? Math.abs(Q)/(2*adH) : 1e-6;
  return {Q:Q*3600, V, Re, f, hf:dH, regime, cond:cond*3600};
}
