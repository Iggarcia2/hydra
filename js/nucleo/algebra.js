// js/nucleo/algebra.js
'use strict';
/* Eliminación gaussiana con pivoteo parcial y criterio de convergencia de las ecuaciones de continuidad. */

// Gaussian elimination with partial pivoting — solves Ax=b, returns x or null
function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row,i) => [...row, b[i]]);
  for (let col=0; col<n; col++) {
    let maxRow=col, maxVal=Math.abs(M[col][col]);
    for (let row=col+1; row<n; row++) {
      if (Math.abs(M[row][col])>maxVal){maxVal=Math.abs(M[row][col]);maxRow=row;}
    }
    [M[col],M[maxRow]] = [M[maxRow],M[col]];
    if (!Number.isFinite(M[col][col]) || Math.abs(M[col][col]) < 1e-14) return null;
    for (let row=col+1; row<n; row++) {
      const f = M[row][col]/M[col][col];
      for (let k=col; k<=n; k++) M[row][k] -= f*M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i=n-1; i>=0; i--) {
    x[i] = M[i][n];
    for (let k=i+1; k<n; k++) x[i] -= M[i][k]*x[k];
    x[i] /= M[i][i];
  }
  return x;
}

// [v26] Error de convergencia de las ecuaciones de continuidad de los nodos libres: el mayor |F_i| RELATIVO al caudal que circula por
// ese nodo (suma de |caudales| de sus arcos, bombas y demanda), con un piso para nodos sin caudal. En v25 el criterio era absoluto
// (|F| < 1e-4 m³/s = 0,36 m³/h): en redes de caudales chicos daba por convergida una solución con 10–20 % de error de caudal.
// Así la tolerancia significa lo mismo en una red de 0,3 m³/h que en una de 3000 m³/h.
const Q_PISO_MS = 1e-8;   // m³/s (0,036 L/h): piso del caudal de referencia
function errorContinuidad(F, circulante, NF) {
  let e = 0;
  for (let i=0; i<NF; i++) {
    const r = Math.abs(F[i]) / (circulante[i] + Q_PISO_MS);
    if (!Number.isFinite(r)) return Infinity;   // datos rotos (NaN/∞): nunca converge
    if (r > e) e = r;
  }
  return e;
}

// [v26] Búsqueda de línea de Newton (solver y curva del sistema): el paso se acepta si baja el residuo al menos un 10 %; si no, se prueban fracciones
// menores y se toma la mejor. En v25 bastaba CUALQUIER mejora, y con una válvula o un accesorio muy estrangulado (caudal ∝ √ΔH) Newton oscilaba de
// un lado al otro del equilibrio bajando el residuo apenas un 1–2 % por vuelta, sin llegar nunca a la tolerancia.
const LS_MEJORA = 0.9;
