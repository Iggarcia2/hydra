// js/nucleo/bombas.js
'use strict';
/* Curvas de bomba: carga, derivada, caudal máximo y potencia de eje por interpolación. */

// Pump head at flow Q [m³/h] — quadratic fit from H-Q curve points
function pumpHead(Q_m3h, arc) {
  const curve = arc.pumpCurve;
  if (!curve || curve.length < 2) return 50;
  // Sort by Q
  const pts = [...curve].sort((a,b)=>a.Q-b.Q);
  const Q = Math.abs(Q_m3h);
  if (Q <= pts[0].Q) return pts[0].H;
  if (Q >= pts[pts.length-1].Q) {
    // Linear extrapolation beyond rated max Q — clamped to avoid solver explosion
    const n = pts.length-1;
    const slope = (pts[n].H - pts[n-1].H)/(pts[n].Q - pts[n-1].Q);
    const extrapolated = pts[n].H + slope*(Q - pts[n].Q);
    // Clamp: never below −30 % of shutoff head (prevents wild divergence)
    return Math.max(extrapolated, -0.3 * pts[0].H);
  }
  for (let i=0; i<pts.length-1; i++) {
    if (pts[i].Q<=Q && Q<=pts[i+1].Q) {
      const t=(Q-pts[i].Q)/(pts[i+1].Q-pts[i].Q);
      return pts[i].H + t*(pts[i+1].H-pts[i].H);
    }
  }
  return 0;
}
// Pendiente de la curva [m por m³/h] respecto del caudal absoluto, por diferencia central de ±0,5 m³/h. [v26] El punto central nunca baja de
// 0,5 m³/h: pumpHead usa |Q|, así que con Q < 0,5 los dos puntos quedaban a ambos lados del cero y la diferencia daba una pendiente
// mucho menor que la real (con una curva de 0,066 m por m³/h, 0,0034 a Q = 0,03). Newton usaba esa pendiente para la bomba que alimenta un
// nodo sin salida (caudal 0): el paso se pasaba de largo y el solver no convergía.
function pumpHeadDeriv(Q_m3h, arc) {
  const dQ = 0.5, Qc = Math.max(Math.abs(Q_m3h), dQ);
  return (pumpHead(Qc+dQ,arc)-pumpHead(Qc-dQ,arc))/(2*dQ);
}
// Max Q where pump can deliver (Q at H=0)
function pumpMaxQ(arc) {
  const pts = [...arc.pumpCurve].sort((a,b)=>a.Q-b.Q);
  return pts[pts.length-1].Q * (arc.nPumps||1);
}


// Potencia de eje [kW] en Q [m³/h] — interpola curva P-Q (UNA bomba)
function pumpPower(Q_m3h, arc) {
  const curve = arc.powerCurve;
  if (!curve || curve.length < 2) return null;
  const pts = [...curve].sort((a,b)=>a.Q-b.Q);
  const Q = Math.abs(Q_m3h);
  if (Q <= pts[0].Q) return pts[0].P;
  if (Q >= pts[pts.length-1].Q) {
    const n = pts.length-1;
    const slope = (pts[n].P - pts[n-1].P)/(pts[n].Q - pts[n-1].Q);
    return Math.max(0, pts[n].P + slope*(Q - pts[n].Q));
  }
  for (let i=0; i<pts.length-1; i++) {
    if (pts[i].Q<=Q && Q<=pts[i+1].Q) {
      const t=(Q-pts[i].Q)/(pts[i+1].Q-pts[i].Q);
      return pts[i].P + t*(pts[i+1].P-pts[i].P);
    }
  }
  return null;
}
