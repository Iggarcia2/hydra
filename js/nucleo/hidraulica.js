// js/nucleo/hidraulica.js
'use strict';
/* Fricción (laminar, transición, Colebrook-White) y caudal de un tramo a partir de la diferencia de carga. */

const RE_LAMINAR    = 2300;   // por debajo: flujo laminar, f = 64/Re (Hagen-Poiseuille)
const RE_TURBULENTO = 4000;   // por encima: flujo turbulento, Colebrook-White; entre los dos: transición
const COND_RETENCION_CERRADA = 1e-6;   // [m³/s por m] conductancia que ve Newton en una retención cerrada (el caudal sigue siendo 0): con 0, un nodo cuyas retenciones
                                       // están todas cerradas quedaba sin ecuación y el sistema se declaraba singular; con un valor chico, Newton lo empuja a abrirlas
const EPS_DEFECTO_MM = 0.046; // acero comercial: se usa solo cuando el tramo NO trae rugosidad (un 0 explícito es un tubo liso y se respeta)

// Rugosidad absoluta efectiva [mm] de un tramo: rugosidad del material + sarro (Δε).
// Un valor negativo no tiene sentido físico y se toma como 0.
function arcEpsMm(arc) {
  const e = (arc.eps_mm != null && Number.isFinite(+arc.eps_mm)) ? +arc.eps_mm : EPS_DEFECTO_MM;
  const s = Number.isFinite(+arc.fouling_mm) ? +arc.fouling_mm : 0;
  return Math.max(0, e) + Math.max(0, s);
}

// Colebrook-White (turbulento): 1/√f = −2·log10(ε/(3,7·D) + 2,51/(Re·√f)), por iteración. Solo vale para Re ≥ 4000.
function colebrook(Re, eD) {
  let f = 0.25/Math.pow(Math.log10(eD/3.7 + 5.74/Math.pow(Re,0.9)),2);
  for (let i=0; i<60; i++) {
    const fn = 1/Math.pow(-2*Math.log10(eD/3.7 + 2.51/(Re*Math.sqrt(f))),2);
    if (Math.abs(fn-f)<1e-10){f=fn;break;} f=fn;
  }
  return f;
}

// Factor de fricción de Darcy en todo el rango de Re. Es CONTINUO: en v25 pasaba de 64/Re a Colebrook de golpe en Re = 2300
// (con ε/D = 0,0005, f saltaba de 0,0278 a 0,0477, un 72 % más), y entre 2300 y 4000 el caudal podía no tener solución única.
//   Re < 1           → 0,02 (sin flujo; valor de resguardo)
//   Re < 2300        → 64/Re
//   2300 ≤ Re < 4000 → interpolación lineal en Re entre 64/2300 y Colebrook(4000) (la zona de transición no tiene una ley única)
//   Re ≥ 4000        → Colebrook-White
function frictionFactor(Re, eD) {
  if (!(Re >= 1)) return 0.02;
  if (Re < RE_LAMINAR) return 64/Re;
  if (Re >= RE_TURBULENTO) return colebrook(Re, eD);
  const fL = 64/RE_LAMINAR, fT = colebrook(RE_TURBULENTO, eD);
  return fL + (fT - fL) * (Re - RE_LAMINAR) / (RE_TURBULENTO - RE_LAMINAR);
}

// Compute pipe flow Q [m³/h] from i→j given head difference dH [m]
// Also returns {Q, V, Re, f, hf, regime, conductance}
// [repo] `fluid` ({rho, nu}) es ahora un parámetro: el motor ya no lee variables globales.
// [v26] Cada régimen se resuelve por separado y la pérdida total es hf = (f·L/D + K)·V²/2g:
//   laminar → fórmula cerrada (hf = b·V + a·V², con b = 32·ν·L/(g·D²) y a = K/2g; antes: iteración con ~0,1 % de error),
//   transición → bisección sobre V (hf crece con V), turbulento → punto fijo en f como siempre.
//   `cond` (∂Q/∂dH, para el Jacobiano de Newton) es la derivada exacta en laminar y transición; en turbulento sigue
//   siendo Q/(2·dH), como en v25 (antes se usaba también en laminar, y ahí Newton oscilaba con fluidos viscosos).
function pipeCalc(dH, arc, fluid) {
  if (!fluid || !(Number.isFinite(fluid.nu) && fluid.nu > 0)) throw new Error('pipeCalc: falta el fluido o su viscosidad cinemática no es positiva');
  const {D_mm,L_m} = arc;
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
  const D = D_mm/1000, A = Math.PI*D*D/4, eD = (arcEpsMm(arc)/1000)/D;
  // [FIX] resistencia nula (L=0 sin accesorios) -> evita Q=Infinity y NaN en el Jacobiano
  const resistanceless = (Lterm <= 0) && (Keff <= 0);
  if (D <= 0 || Lterm < 0 || resistanceless || !Number.isFinite(dH))
    return {Q:0, V:0, Re:0, f:0.02, hf:0, regime:'—', cond:0};
  const nu = fluid.nu;
  if (Math.abs(dH) < 1e-12) {
    // Sin diferencia de carga no hay caudal, pero la conductancia NO es 0: es la del límite laminar (A/b) o, si el tramo no tiene
    // fricción (solo K), el piso de siempre. Con cond = 0 el nodo quedaba sin ninguna ecuación y Newton daba «sistema singular» justo
    // al converger (un nodo sin salida, como una derivación tapada por una retención, llega a dH = 0 exacto).
    const b0 = 32*nu*Lterm/(G*D*D);
    return {Q:0, V:0, Re:0, f:0.02, hf:0, regime:'—', cond:(b0 > 0 ? A/b0 : 1e-6)*3600};
  }
  const sign = dH > 0 ? 1 : -1;
  const adH = Math.abs(dH);
  const kL = Lterm/D;                                   // L/D
  const hfDeV = (V, f) => (f*kL + Keff)*V*V/(2*G);      // pérdida total para una velocidad y un f dados

  // (1) Laminar: f = 64/Re ⇒ hf = b·V + a·V². Forma estable (sin cancelación si a→0 o b→0).
  const a = Keff/(2*G), b = 32*nu*Lterm/(G*D*D);
  let V = 2*adH/(b + Math.sqrt(b*b + 4*a*adH));
  let Re = V*D/nu, f;
  let dhdV;                                             // d(hf)/dV, solo para laminar/transición (turbulento usa Q/(2·dH))
  if (Re <= RE_LAMINAR || kL === 0) {
    // (sin tramo de tubería, f no interviene: la V de arriba ya es exacta en cualquier régimen)
    f = frictionFactor(Re, eD);
    if (Re <= RE_LAMINAR) dhdV = b + 2*a*V;
  } else {
    const V4 = RE_TURBULENTO*nu/D;
    const fT = colebrook(RE_TURBULENTO, eD);
    if (adH <= hfDeV(V4, fT)) {
      // (2) Transición: hf(V) es continua y creciente entre V(2300) y V(4000) ⇒ bisección.
      let lo = RE_LAMINAR*nu/D, hi = V4;
      for (let i=0; i<200; i++) {
        const m = (lo + hi)/2;
        if (hfDeV(m, frictionFactor(m*D/nu, eD)) < adH) lo = m; else hi = m;
        if (hi - lo <= 1e-15*hi) break;
      }
      V = (lo + hi)/2; Re = V*D/nu; f = frictionFactor(Re, eD);
      const dfdRe = (fT - 64/RE_LAMINAR)/(RE_TURBULENTO - RE_LAMINAR);
      dhdV = (f*kL + Keff)*V/G + (V*V/(2*G))*kL*dfdRe*(D/nu);
    } else {
      // (3) Turbulento: punto fijo en f (converge rápido: f depende poco de Re), igual que v25 pero hasta converger.
      f = 0.02;
      for (let i=0; i<100; i++) {
        const r = (f*kL + Keff)/(2*G*A*A);
        const Q = Math.sqrt(adH/r);   // m³/s
        V = Q/A; Re = V*D/nu;
        const fn = frictionFactor(Re, eD);
        const hecho = Math.abs(fn - f) < 1e-12;
        f = fn;
        if (hecho) break;
      }
    }
  }
  const Qabs = V*A;                                     // m³/s
  const regime = Re<RE_LAMINAR?'Laminar':Re<RE_TURBULENTO?'Transición':'Turbulento';
  // m³/s por m (turbulento: piso de 1e-6 para flujos casi nulos, como en v25)
  const cond = (dhdV !== undefined) ? A/dhdV : (Qabs > 1e-10 ? Qabs/(2*adH) : 1e-6);
  return {Q:sign*Qabs*3600, V, Re, f, hf:dH, regime, cond:cond*3600};
}

// Un elemento de retención solo deja pasar de «desde» hacia «hasta»: el tipo antiguo 'check' o un elemento Válvula de tipo retención.
function esRetencion(arc) {
  return arc.type === 'check' || (arc.type === 'valve' && arc.valveType === 'check');
}

// Caudal (Q_ms en m³/s, Q_m3h en m³/h) y conductancia cond [m³/s por m] de un arco con pérdida de tubería (pipe, check, valve)
// para la diferencia de carga dH [m]. Fuente única para el solver, la curva del sistema y los resultados: una retención contra la
// corriente bloquea (caudal 0). En v25 el solver lo bloqueaba pero la tabla informaba el caudal inverso que habría sin retención.
function caudalTramo(arc, dH, fluid) {
  if (esRetencion(arc) && dH < 0) return {Q_ms:0, Q_m3h:0, cond:COND_RETENCION_CERRADA};
  const r = pipeCalc(dH, arc, fluid);
  return {Q_ms:r.Q/3600, Q_m3h:r.Q, cond:r.cond/3600};
}
