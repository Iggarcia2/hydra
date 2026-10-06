// tests/lib/mini.js
'use strict';
/* Mini corredor de pruebas sin dependencias: seccion(), prueba(), comparadores y correr(). Las pruebas pueden ser síncronas o async. */
const cola = [];
function seccion(titulo) { cola.push({ titulo }); }
function prueba(nombre, fn) { cola.push({ nombre, fn }); }

function cierto(c, msg) { if (!c) throw new Error(msg || 'la condición era falsa'); }
function igual(real, esperado, msg) {
  if (!Object.is(real, esperado)) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + mostrar(esperado) + ' y fue ' + mostrar(real));
}
function igualJSON(real, esperado, msg) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + b + ' y fue ' + a);
}
/** |real − esperado| ≤ tolRel·|esperado| (o tolAbs si esperado es 0). */
function cercano(real, esperado, tolRel, msg, tolAbs = 1e-12) {
  const e = Math.abs(real - esperado), lim = Math.max(tolRel * Math.abs(esperado), tolAbs);
  if (!(e <= lim)) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + mostrar(esperado) + ' ± ' + mostrar(lim) + ' y fue ' + mostrar(real) + ' (error relativo ' + (esperado ? (e / Math.abs(esperado)).toExponential(2) : 'n/a') + ')');
}
function lanza(fn, patron, msg) {
  try { fn(); } catch (e) { if (patron && !patron.test(String(e.message))) throw new Error((msg ? msg + ': ' : '') + 'se lanzó otro error: ' + e.message); return; }
  throw new Error((msg ? msg + ': ' : '') + 'tendría que haber lanzado un error');
}
const mostrar = v => typeof v === 'string' ? JSON.stringify(v) : (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : JSON.stringify(v));

async function correr(titulo) {
  console.log(titulo);
  let ok = 0; const fallos = [];
  for (const t of cola) {
    if (t.titulo) { console.log('\n' + t.titulo); continue; }
    try { await t.fn(); ok++; console.log('  ✓ ' + t.nombre); }
    catch (e) { fallos.push(t.nombre); console.log('  ✗ ' + t.nombre + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
  }
  console.log('\n' + ok + ' pruebas correctas, ' + fallos.length + ' con error' + (fallos.length ? ':\n  - ' + fallos.join('\n  - ') : '.'));
  return fallos.length === 0;
}
module.exports = { seccion, prueba, cierto, igual, igualJSON, cercano, lanza, correr };
