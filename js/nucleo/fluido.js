// js/nucleo/fluido.js
'use strict';
/* Propiedades del agua por interpolación de la tabla de temperaturas. */

function getWaterProps(T) {
  if (!Number.isFinite(T)) throw new Error('getWaterProps: la temperatura tiene que ser un número finito');   // [repo] antes devolvía undefined
  const t = WATER_TABLE;
  if (T <= t[0][0])  return [t[0][1], t[0][2]];
  if (T >= t[t.length-1][0]) return [t[t.length-1][1], t[t.length-1][2]];
  for (let i=0; i<t.length-1; i++) {
    if (t[i][0]<=T && T<=t[i+1][0]) {
      const f=(T-t[i][0])/(t[i+1][0]-t[i][0]);
      return [t[i][1]+f*(t[i+1][1]-t[i][1]), t[i][2]+f*(t[i+1][2]-t[i][2])];
    }
  }
}
