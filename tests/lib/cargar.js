// tests/lib/cargar.js
'use strict';
/* Carga los archivos de js/ dentro de un contexto de Node (sin navegador) para probar la lógica sin pantalla.
   Única fuente de verdad del orden de carga: los <script src="js/..."> de index.html. No hay listas de archivos duplicadas.
   El contexto arranca vacío (solo `console`): si un archivo del motor nombra `document`, `window`, `state` o `fluid`, la carga o la
   llamada falla con ReferenceError. Eso es lo que demuestra que js/datos/ y js/nucleo/ no dependen de la pantalla ni del estado global. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
// Grupos de módulos con una palabra clave. Cualquier otra entrada tiene que ser una ruta exacta de index.html (p. ej. 'js/estado.js').
const GRUPOS = {
  'nucleo': r => r.startsWith('js/datos/') || r.startsWith('js/nucleo/'),   // todo lo que no toca el DOM ni el estado global
};

function ordenDeCarga() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const rutas = [...html.matchAll(/<script\s+src="(js\/[^"]+)"/g)].map(m => m[1]);
  if (!rutas.length) throw new Error('index.html no declara ningún <script src="js/...">');
  return rutas;
}

/** Rutas (en el orden de index.html) de los módulos elegidos. Lanza si algo no existe o no se cargaría. */
function rutas(seleccion) {
  if (!Array.isArray(seleccion) || !seleccion.length) throw new Error('rutas(): hay que indicar qué módulos cargar');
  const orden = ordenDeCarga(), elegidas = new Set();
  for (const s of seleccion) {
    if (GRUPOS[s]) {
      const g = orden.filter(GRUPOS[s]);
      if (!g.length) throw new Error('El grupo «' + s + '» no tiene módulos en index.html');
      g.forEach(r => elegidas.add(r));
    } else if (orden.includes(s)) elegidas.add(s);
    else throw new Error('El módulo «' + s + '» no está en el orden de carga de index.html');
  }
  return orden.filter(r => elegidas.has(r));
}

/** {ruta: texto} de cada módulo. */
function leer(lista) {
  const out = {};
  for (const r of lista) out[r] = fs.readFileSync(path.join(RAIZ, r), 'utf8');
  return out;
}

/** Contexto vacío: solo `console` más lo que se pida en `extras` (p. ej. un `document` de mentira). */
function contexto(extras) {
  const ctx = { console };
  Object.assign(ctx, extras || {});
  return vm.createContext(ctx);
}

/** Ejecuta los textos en orden (un script por archivo, como el navegador) dentro de `ctx`. */
function ejecutar(ctx, lista, textos) {
  for (const r of lista) new vm.Script(textos[r], { filename: r }).runInContext(ctx);
  return ctx;
}

/** Atajo: carga la selección en un contexto nuevo y devuelve el contexto. */
function crear(seleccion, extras) {
  const lista = rutas(seleccion);
  return ejecutar(contexto(extras), lista, leer(lista));
}

/** Evalúa una expresión o sentencias dentro del contexto. Con `limiteMs`, corta el cálculo si tarda más (lanza ERR_SCRIPT_EXECUTION_TIMEOUT). */
function evaluar(ctx, codigo, limiteMs) { return vm.runInContext(codigo, ctx, limiteMs ? { timeout: limiteMs } : undefined); }

module.exports = { RAIZ, rutas, leer, contexto, ejecutar, crear, evaluar };
