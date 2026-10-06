// tests/lib/pagina.js
'use strict';
/* Utilidades de navegador compartidas por las pruebas de pantalla: contexto determinista, redirección de las librerías de internet de la
   versión original a las copias locales de libs/, descargas con huella, y una «foto» del estado de la pantalla para comparar. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.resolve(__dirname, '..', '..');

const VIEWPORT = { width: 1400, height: 900 };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// Fecha congelada y Math.random con semilla fija: así los archivos exportados (PDF, Excel, JSON) son comparables byte a byte.
const INICIO_DETERMINISTA = `(() => {
  const T = Date.UTC(2026, 0, 15, 15, 30, 0), RD = Date;
  class FD extends RD { constructor(...a) { if (a.length === 0) super(T); else super(...a); } static now() { return T; } }
  window.Date = FD;
  let s = 123456789;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
})();`;

const leerLib = n => fs.readFileSync(path.join(RAIZ, 'libs', n));

/** Contexto de navegador con zona horaria, idioma y reloj fijos. `externas`: atiende con libs/ las librerías de internet de la versión original.
    `fuentes`: deja que se descarguen las tipografías locales (por defecto se bloquean para que el dibujo sea comparable). Todo lo demás de internet se bloquea y se anota en ctx.__sinRed. */
async function nuevoContexto(browser, base, { externas = false, fuentes = false } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true });
  await ctx.addInitScript(INICIO_DETERMINISTA);
  const sinRed = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) {
      // Se descartan las tipografías en ambos lados: sin ellas los dos usan la misma de reemplazo y el dibujo (canvas, PDF) es comparable.
      if (!fuentes && /\/libs\/fuentes\/.*\.woff2$/.test(u)) return route.abort();
      return route.continue();
    }
    if (externas) {
      if (u.includes('/Chart.js/')) return route.fulfill({ contentType: 'text/javascript', body: '' });      // la versión original la carga y no la usa
      if (u.includes('cdn.sheetjs.com')) return route.fulfill({ contentType: 'text/javascript', body: leerLib('xlsx.full.min.js') });
      if (u.includes('jspdf-autotable')) return route.fulfill({ contentType: 'text/javascript', body: leerLib('jspdf.plugin.autotable.min.js') });
      if (u.includes('/jspdf/')) return route.fulfill({ contentType: 'text/javascript', body: leerLib('jspdf.umd.min.js') });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.abort();
    sinRed.push(u);
    return route.abort();
  });
  ctx.__sinRed = sinRed;
  return ctx;
}

/** Foto de la pantalla y del estado interno (todo en texto comparable). */
const FOTO = () => {
  const rep = (k, v) => (typeof v === 'number' && !Number.isFinite(v)) ? '#' + String(v) : (Object.is(v, -0) ? '#-0' : v);
  const clon = document.body.cloneNode(true);
  clon.querySelectorAll('script, noscript').forEach(e => e.remove());
  const com = document.createTreeWalker(clon, NodeFilter.SHOW_COMMENT); const quitar = []; while (com.nextNode()) quitar.push(com.currentNode); quitar.forEach(c => c.remove());   // los comentarios del HTML no se ven ni se comparan
  const dom = clon.innerHTML.replace(/>\s+</g, '><').trim();
  const valores = [...document.querySelectorAll('input, select, textarea')].map(e =>
    (e.id || e.dataset.field || e.name || '?') + '|' + e.type + '|' + (e.type === 'file' ? '' : e.value) + '|' + (e.checked ? 1 : 0)).join('\n');
  const h = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
  const lienzos = [...document.querySelectorAll('canvas')].map(c => (c.id || '?') + ':' + c.width + 'x' + c.height + ':' + h(c.toDataURL())).join('\n');
  let cat = null; try { cat = localStorage.getItem('hydra_pump_catalog_v1'); } catch { /* sin almacenamiento */ }
  const estado = JSON.stringify({
    state, fluid, projectMeta, nextId: _nextId, undo: _undoStack.length, redo: _redoStack.length,
    iso: !!window.isIsoView, cat, titulo: document.title, sysCurves: _sysCurveCache, chartTab: typeof _chartTab === 'undefined' ? null : _chartTab,
  }, rep);
  return { dom, valores, lienzos, estado };
};

/** Descarga lo que dispare `accion` y devuelve nombre, tamaño y huella (el contenido queda en `buf`). */
async function descargar(page, accion) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), accion()]);
  const buf = fs.readFileSync(await d.path());
  return { nombre: d.suggestedFilename(), bytes: buf.length, sha: sha(buf), buf };
}

/** Espera a que el cartel del solver deje de decir «Calculando…». */
async function esperarCalculo(page) {
  await page.waitForFunction(() => document.getElementById('solver-status').textContent !== 'Calculando…', null, { timeout: 120000 });
}

/** Compara dos capturas PNG píxel a píxel (las decodifica el propio Chromium, sin dependencias).
    Devuelve { mismoTamano, distintos (píxeles con algún canal distinto), difMax (mayor diferencia de un canal, de 0 a 255) }. */
async function compararImagenes(browser, pngA, pngB) {
  const ctx = await browser.newContext(), p = await ctx.newPage();
  try {
    await p.setContent('<!doctype html><title>comparar</title>');
    return await p.evaluate(async ([a, b]) => {
      const leer = async b64 => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height);
      };
      const A = await leer(a), B = await leer(b);
      if (A.width !== B.width || A.height !== B.height) return { mismoTamano: false, distintos: -1, difMax: 255 };
      let distintos = 0, difMax = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        let d = 0;
        for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(A.data[i + k] - B.data[i + k]));
        if (d) { distintos++; if (d > difMax) difMax = d; }
      }
      return { mismoTamano: true, distintos, difMax };
    }, [pngA.toString('base64'), pngB.toString('base64')]);
  } finally { await ctx.close(); }
}

module.exports = { RAIZ, VIEWPORT, sha, nuevoContexto, FOTO, descargar, esperarCalculo, compararImagenes };
