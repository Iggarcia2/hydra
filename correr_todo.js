// tests/correr_todo.js
'use strict';
/* Corre la verificación y termina con código distinto de 0 si algo falla (nada se omite en silencio):
     node tests/correr_todo.js                  unitarias del motor + contraste con la implementación independiente en Python
     node tests/correr_todo.js --e2e            suma la prueba de pantalla (Chromium con Playwright)
     node tests/correr_todo.js --equivalencia   suma la equivalencia con la versión original (versiones/hydra_v25.html): motor y pantalla
     node tests/correr_todo.js --todo           todo lo anterior (varios minutos) */
const { spawnSync } = require('child_process'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const todo = process.argv.includes('--todo');
const e2e = todo || process.argv.includes('--e2e'), equiv = todo || process.argv.includes('--equivalencia');

function ejecutar(nombre, cmd, args) {
  console.log('\n== ' + nombre + ' ==');
  const r = spawnSync(cmd, args, { cwd: RAIZ, stdio: 'inherit' });
  if (r.error) { console.log('No se pudo ejecutar «' + cmd + '»: ' + r.error.message); return false; }
  return r.status === 0;
}
function pythonDisponible() {
  for (const c of ['python3', 'python']) { const r = spawnSync(c, ['-I', '-c', 'import scipy, numpy'], { stdio: 'ignore' }); if (!r.error && r.status === 0) return c; }
  return null;
}

const py = pythonDisponible();
const node = process.execPath;
const resultados = [
  ['Unitarias del motor', ejecutar('Unitarias del motor de cálculo', node, ['tests/unit/test_nucleo.js'])],
  ['Casos de referencia', ejecutar('Casos de referencia (resueltos con el motor JS)', node, ['tests/ref/gen_casos.js'])],
  ['Contraste con Python', py ? ejecutar('Contraste con la implementación independiente (' + py + ' + scipy)', py, ['-I', 'tests/ref/ref.py'])
    : (console.log('\n== Contraste con Python ==\nNo hay Python 3 con numpy y scipy: este paso NO se pudo correr.'), false)],
];
if (e2e) resultados.push(['Prueba de pantalla', ejecutar('Prueba de pantalla (Chromium)', node, ['tests/e2e/pantalla.js'])]);
if (equiv) {
  resultados.push(['Equivalencia del motor con v25', ejecutar('Equivalencia del motor con la versión original', node, ['tests/equivalencia/motor.js', '150'])]);
  resultados.push(['Equivalencia de pantalla con v25', ejecutar('Equivalencia de la pantalla con la versión original (varios minutos)', node, ['tests/equivalencia/pantalla.js'])]);
}

console.log('\n── Resumen ──');
resultados.forEach(x => console.log((x[1] ? 'OK     ' : 'FALLA  ') + x[0]));
if (!e2e) console.log('(la prueba de pantalla no se corrió: usá --e2e)');
if (!equiv) console.log('(la equivalencia con la versión original no se corrió: usá --equivalencia)');
process.exit(resultados.every(x => x[1]) ? 0 : 1);
