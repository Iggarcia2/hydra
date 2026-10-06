// js/nucleo/algebra.js
'use strict';
/* Eliminación gaussiana con pivoteo parcial. */

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
