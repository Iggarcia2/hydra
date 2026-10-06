// tests/e2e/pantalla.js
'use strict';
/* Prueba de pantalla del sitio (Chromium con Playwright):
     · carga limpia por http y por file:// (sin errores de consola, sin pedidos a internet, tipografías locales aplicadas),
     · el aviso de carga (js/guarda.js) rompiendo el sitio a propósito: falta un script, falta una librería, faltan los estilos, error al iniciar,
     · archivos de proyecto y de catálogo hostiles (código escondido en textos, ids y tipos inválidos): no se ejecuta nada y, si el archivo es
       inválido, la red que había queda intacta. La misma prueba se corre sobre la versión original (versiones/hydra_v25.html) para mostrar el contraste,
     · textos con HTML escritos a mano en los campos, y exportación a PDF y Excel con nombres extremos. */
const fs = require('fs'), os = require('os'), path = require('path');
const { servir } = require('../lib/servidor.js');
const { lanzar } = require('../lib/navegador.js');
const { RAIZ, nuevoContexto, descargar, esperarCalculo } = require('../lib/pagina.js');
const { seccion, prueba, cierto, igual, correr } = require('../lib/mini.js');

let srv, browser;
const URL_NUEVA = '/index.html', URL_V25 = '/versiones/hydra_v25.html';
const pausa = (p, ms = 120) => p.waitForTimeout(ms);

/** Abre una página con los registros de consola, errores y diálogos. */
async function abrir(ctx, url, { esperarListo = true } = {}) {
  const p = await ctx.newPage();
  p.registro = { consola: [], errores: [], dialogos: [], pedidos: [] };
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) p.registro.consola.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => p.registro.errores.push(e.message));
  p.on('dialog', d => { p.registro.dialogos.push(d.type() + ': ' + d.message()); d.accept(); });
  p.on('request', r => p.registro.pedidos.push(r.url()));
  await p.goto(url);
  if (esperarListo) await p.waitForFunction(() => window.__HYDRA_LISTO__ === true || window.__HYDRA_LISTO__ === undefined && document.readyState === 'complete', null, { timeout: 15000 });
  await pausa(p, 200);
  return p;
}
const aviso = p => p.evaluate(() => { const e = document.querySelector('[role=alert]'); return e ? { texto: e.textContent, fondo: getComputedStyle(e).backgroundColor } : null; });
async function conContexto(opciones, fn) { const ctx = await nuevoContexto(browser, srv.url, opciones); try { return await fn(ctx); } finally { await ctx.close(); } }
const sinRuido = lista => lista.filter(x => !/Failed to load resource/.test(x));

// ── Archivos de proyecto para las pruebas hostiles ────────────────────────────────────────────────────────────────────────────
async function proyectoBase(ctx) {            // el proyecto que guarda la propia aplicación con su red de ejemplo (esquema real)
  const p = await abrir(ctx, srv.url + URL_NUEVA);
  const d = await descargar(p, () => p.click('button:has-text("💾 Guardar")'));
  await p.close();
  return JSON.parse(d.buf.toString('utf8'));
}
const subir = (p, selector, obj) => p.locator(selector).setInputFiles({ name: 'archivo.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const CARGAR = 'input[type=file][onchange*="loadProject"]', IMPORTAR = 'input[type=file][onchange*="importCatalog"]';
const IMG = n => '"><img src=x onerror="window.__xss=' + n + '">';          // se sale de un atributo y crea un <img> que falla al cargar → ejecuta el código

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
seccion('Carga limpia');
prueba('por http: arranca, calcula, usa las tipografías locales y no pide nada a internet', async () => {
  await conContexto({ fuentes: true }, async ctx => {
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    igual(await p.evaluate(() => window.__HYDRA_LISTO__), true);
    igual(await aviso(p), null, 'no tiene que haber ningún aviso de carga');
    await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
    cierto(/^Convergió/.test(await p.locator('#solver-status').innerText()), await p.locator('#solver-status').innerText());
    const fuentes = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')); });
    cierto(fuentes.includes('IBM Plex Mono') && fuentes.includes('IBM Plex Sans'), 'tipografías cargadas: ' + fuentes.join(', '));
    igual(await p.evaluate(() => [typeof window.jspdf, typeof XLSX].join()), 'object,object', 'librerías de exportación');
    igual(sinRuido(p.registro.consola).concat(p.registro.errores).length, 0, 'consola: ' + p.registro.consola.concat(p.registro.errores).join(' | '));
    cierto(p.registro.pedidos.every(u => u.startsWith(srv.url)), 'pedidos fuera del sitio: ' + p.registro.pedidos.filter(u => !u.startsWith(srv.url)).join(', '));
    cierto(ctx.__sinRed.length === 0, 'recursos externos pedidos: ' + ctx.__sinRed.join(', '));
  });
});
prueba('por file:// (doble clic en index.html): arranca, calcula y exporta', async () => {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  try {
    const p = await abrir(ctx, 'file://' + path.join(RAIZ, 'index.html'));
    igual(await p.evaluate(() => window.__HYDRA_LISTO__), true); igual(await aviso(p), null);
    await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
    cierto(/^Convergió/.test(await p.locator('#solver-status').innerText()));
    const x = await descargar(p, () => p.click('button:has-text("📊 Excel")')); cierto(x.bytes > 5000 && /\.xlsx$/.test(x.nombre), x.nombre);
    igual(sinRuido(p.registro.consola).concat(p.registro.errores).length, 0, p.registro.consola.concat(p.registro.errores).join(' | '));
  } finally { await ctx.close(); }
});
prueba('el sitio no depende de nada fuera de sí mismo: ningún <script>, <link> ni @import apunta a internet', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) cierto(!/^(?:https?:)?\/\//.test(m[1]), 'recurso externo: ' + m[1]);
  for (const f of ['css/estilos.css', 'libs/fuentes/fuentes.css']) cierto(!/https?:\/\//.test(fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), f + ' pide algo a internet');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
seccion('Aviso de carga (js/guarda.js): se rompe el sitio a propósito');
prueba('falta un script de js/: aviso rojo arriba que nombra el archivo', async () => {
  await conContexto({}, async ctx => {
    await ctx.route('**/js/nucleo/solver.js', r => r.abort());
    const p = await abrir(ctx, srv.url + URL_NUEVA, { esperarListo: false });
    const a = await aviso(p);
    cierto(a && /No se pudo cargar el archivo js\/nucleo\/solver\.js/.test(a.texto), JSON.stringify(a));
    cierto(/No uses los resultados/.test(a.texto)); igual(a.fondo, 'rgb(127, 29, 29)', 'rojo');
    igual(await p.evaluate(() => Math.round(document.querySelector('[role=alert]').getBoundingClientRect().top)), 0, 'franja pegada arriba');
  });
});
prueba('falta una librería de libs/: aviso ámbar abajo (no tapa los botones), se puede ocultar, la red se calcula igual y exportar avisa en vez de fallar callado', async () => {
  await conContexto({ externas: false }, async ctx => {
    await ctx.route('**/libs/jspdf.umd.min.js', r => r.abort());
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    const a = await aviso(p);
    cierto(a && /Faltan librerías de exportación/.test(a.texto) && /libs\/jspdf\.umd\.min\.js/.test(a.texto), JSON.stringify(a));
    igual(a.fondo, 'rgb(120, 53, 15)', 'ámbar');
    igual(await p.evaluate(() => { const r = document.querySelector('[role=alert]').getBoundingClientRect(); return Math.round(r.bottom) === innerHeight; }), true, 'franja pegada abajo, no arriba');
    igual(await p.evaluate(() => window.__HYDRA_LISTO__), true, 'la aplicación sí arrancó');
    await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
    cierto(/^Convergió/.test(await p.locator('#solver-status').innerText()), 'calcula igual');
    await p.click('button:has-text("📄 PDF")'); await pausa(p, 80); await p.click('#modal-project-save-btn'); await pausa(p, 300);
    cierto(p.registro.dialogos.some(d => /jsPDF|PDF/.test(d)), 'exportar PDF tiene que avisar; diálogos: ' + p.registro.dialogos.join(' | '));
    igual(await p.locator('#solver-status').getAttribute('class').then(c => /ok/.test(c)), true, 'el estado del cálculo no se pisa');
    await p.click('[role=alert] button:has-text("Ocultar aviso")');
    igual(await p.evaluate(() => getComputedStyle(document.querySelector('[role=alert]')).display), 'none', 'el aviso se oculta');
  });
});
prueba('falta la librería de Excel: exportar avisa', async () => {
  await conContexto({}, async ctx => {
    await ctx.route('**/libs/xlsx.full.min.js', r => r.abort());
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    cierto(/xlsx\.full\.min\.js/.test((await aviso(p)).texto));
    await p.click('button:has-text("📊 Excel")'); await pausa(p, 200);
    cierto(p.registro.dialogos.some(d => /Excel|SheetJS|XLSX/i.test(d)), 'diálogos: ' + p.registro.dialogos.join(' | '));
  });
});
prueba('faltan los estilos: aviso rojo (la página se vería sin formato)', async () => {
  await conContexto({}, async ctx => {
    await ctx.route('**/css/estilos.css', r => r.fulfill({ status: 404, body: 'no existe' }));
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    const a = await aviso(p);
    cierto(a && /estilos/.test(a.texto) && /css\/estilos\.css/.test(a.texto), JSON.stringify(a)); igual(a.fondo, 'rgb(127, 29, 29)');
  });
});
prueba('error al iniciar (un script lanza una excepción): aviso rojo con el mensaje', async () => {
  await conContexto({}, async ctx => {
    await ctx.route('**/js/ui/inicio.js', r => r.fulfill({ contentType: 'text/javascript', body: 'throw new Error("falla de prueba");' }));
    const p = await abrir(ctx, srv.url + URL_NUEVA, { esperarListo: false });
    const a = await aviso(p);
    cierto(a && /Error al iniciar/.test(a.texto) && /falla de prueba|initDefaults/.test(a.texto), JSON.stringify(a));
  });
});
prueba('por file://, con una carpeta incompleta (sin js/ui/lienzo.js, o sin css/): aviso rojo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-'));
  try {
    const copiar = destino => fs.cpSync(RAIZ, destino, { recursive: true, filter: s => !/[\\/](tests|versiones|node_modules)([\\/]|$)/.test(path.relative(RAIZ, s)) });
    const A = path.join(tmp, 'sin-lienzo'), B = path.join(tmp, 'sin-css');
    copiar(A); fs.unlinkSync(path.join(A, 'js', 'ui', 'lienzo.js'));
    copiar(B); fs.unlinkSync(path.join(B, 'css', 'estilos.css'));
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      let p = await abrir(ctx, 'file://' + path.join(A, 'index.html'), { esperarListo: false });
      cierto(/js\/ui\/lienzo\.js/.test((await aviso(p)).texto), 'sin lienzo.js'); await p.close();
      p = await abrir(ctx, 'file://' + path.join(B, 'index.html'), { esperarListo: false });
      cierto(/estilos/.test((await aviso(p)).texto), 'sin estilos');
    } finally { await ctx.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
prueba('sin JavaScript: la página lo dice en vez de quedar vacía', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  try {
    const p = await ctx.newPage(); await p.goto(srv.url + URL_NUEVA);
    cierto(await p.locator('.sinjs').isVisible(), 'el aviso <noscript> tiene que verse');
  } finally { await ctx.close(); }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
seccion('Archivos hostiles (contraste con la versión original)');
const estadoRed = p => p.evaluate(() => JSON.stringify({ n: state.nodes.map(x => [x.id, x.label]), a: state.arcs.map(x => [x.id, x.label, x.fromId, x.toId]), f: [fluid.rho, fluid.nu] }));
const xss = p => p.evaluate(() => window.__xss);

async function cargarHostil(ctx, url, obj) {
  const p = await abrir(ctx, srv.url + url);
  const antes = await estadoRed(p);
  await subir(p, CARGAR, obj); await pausa(p, 350);
  return { p, antes };
}
async function recorrer(p) {            // toca todo lo que muestra textos de la red: lista de nodos/arcos, propiedades, proyecto, resultados
  await p.click('#tab-nodes'); await p.click('#tab-arcs'); await p.click('#tab-props');
  for (const sel of ['#nodes-list .node-item >> nth=1', '#arcs-list .arc-item >> nth=1']) { await p.click(sel.includes('arcs') ? '#tab-arcs' : '#tab-nodes'); await p.click(sel).catch(() => {}); await pausa(p, 80); }
  await p.locator('#canvas-root .node-el').nth(1).click().catch(() => {}); await pausa(p, 80);
  await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
  for (const t of ['nodes-res', 'arcs-res', 'bom', 'ariete', 'kpis']) { await p.click('#rtab-' + t); await pausa(p, 60); }
  await p.click('#tab-fluid'); await p.click('button:has-text("🗒 Proyecto")'); await pausa(p, 100); await p.click('#modal-project .modal-btn:has-text("Cancelar")');
  await pausa(p, 400);
}

prueba('textos con HTML en etiquetas, nombre de fluido y datos del proyecto: se muestran como texto, no se ejecutan', async () => {
  await conContexto({}, async ctx => {
    const base = await proyectoBase(ctx);
    base.nodes[1].label = IMG(1); base.arcs[1].label = '<svg onload="window.__xss=2">'; base.arcs[2].regime = IMG(3);
    base.fluid.customName = IMG(4); base.projectMeta.name = IMG(5); base.projectMeta.notes = '<script>window.__xss=6</script>'; base.name = IMG(7);
    const { p } = await cargarHostil(ctx, URL_NUEVA, base);
    await recorrer(p);
    igual(await xss(p), undefined, 'no tiene que ejecutarse nada');
    igual(await p.evaluate(() => document.querySelectorAll('img[src="x"], svg[onload]').length), 0, 'no tiene que crearse ningún elemento a partir del texto');
    cierto((await p.locator('#nodes-list').innerText()).includes('<img src=x'), 'la etiqueta se ve como texto');
  });
});
prueba('contraste: la versión original SÍ ejecuta el mismo archivo', async () => {
  await conContexto({ externas: true }, async ctx => {
    const base = await proyectoBase(await nuevoContexto(browser, srv.url, {}));
    base.nodes[1].label = IMG(1);
    const { p } = await cargarHostil(ctx, URL_V25, base);
    await p.locator('#canvas-root .node-el').nth(1).click(); await pausa(p, 300);        // al seleccionar el nodo, su etiqueta se vuelca sin escapar en el campo «Nombre»
    const r = await xss(p);
    console.log('      (en v25: window.__xss = ' + r + (r ? ' → el código del archivo se ejecutó' : ' → no se ejecutó con este vector') + ')');
    cierto(r === 1, 'v25 tendría que ejecutar la etiqueta hostil; si no, esta prueba de contraste ya no demuestra nada');
  });
});
prueba('ids y tipos inválidos, arcos hacia nodos inexistentes e ids repetidos: se rechaza el archivo y la red queda intacta', async () => {
  await conContexto({}, async ctx => {
    const base = await proyectoBase(ctx);
    const clon = () => JSON.parse(JSON.stringify(base));
    const casos = [
      ['id de nodo con código', b => { b.nodes[0].id = '1);window.__xss=10;//'; }, /id numérico entero/],
      ['tipo de nodo con comillas', b => { b.nodes[0].type = 'tank"onclick="window.__xss=11'; }, /tipo no válido/],
      ['tipo de arco con comillas', b => { b.arcs[0].type = 'pipe" onmouseover="window.__xss=12'; }, /tipo no válido/],
      ['origen de arco como texto', b => { b.arcs[0].fromId = '1;window.__xss=13'; }, /numérico entero/],
      ['arco hacia un nodo que no existe', b => { b.arcs[1].toId = 999; }, /no existe/],
      ['ids repetidos', b => { b.nodes[1].id = b.nodes[0].id; }, /repite el id/],
      ['un arco tiene el id de un nodo', b => { b.arcs[0].id = b.nodes[0].id; }, /repite el id/],
      ['nodes no es una lista', b => { b.nodes = { x: 1 }; }, /Formato inválido/],
      ['nodo nulo', b => { b.nodes[2] = null; }, /formato inválido/],
    ];
    for (const [nombre, mutar, patron] of casos) {
      const b = clon(); mutar(b);
      const { p, antes } = await cargarHostil(ctx, URL_NUEVA, b);
      cierto(p.registro.dialogos.some(d => /Error al cargar/.test(d) && patron.test(d)), nombre + ' → diálogos: ' + p.registro.dialogos.join(' | '));
      igual(await estadoRed(p), antes, nombre + ': la red tiene que quedar como estaba');
      igual(await xss(p), undefined, nombre); await p.close();
    }
    const q = await abrir(ctx, srv.url + URL_NUEVA); await subir(q, CARGAR, 'esto no es json'); await pausa(q, 300);
    cierto(q.registro.dialogos.some(d => /Error al cargar/.test(d)), 'JSON inválido');
  });
});
prueba('contraste: la versión original acepta un id con código y lo ejecuta al tocar el nodo', async () => {
  await conContexto({ externas: true }, async ctx => {
    const base = await proyectoBase(await nuevoContexto(browser, srv.url, {}));
    base.nodes[1].id = '2);window.__xss=10;//';
    const { p } = await cargarHostil(ctx, URL_V25, base);
    await p.click('#tab-nodes'); await p.locator('#nodes-list .node-item').nth(1).click(); await pausa(p, 300);   // el id se inserta sin validar dentro de onclick="selectElement(...)"
    const r = await xss(p);
    console.log('      (en v25: window.__xss = ' + r + (r ? ' → el código del archivo se ejecutó' : ' → no se ejecutó con este vector') + ')');
    cierto(r === 10, 'v25 tendría que ejecutar el id hostil; si no, esta prueba de contraste ya no demuestra nada');
  });
});
prueba('fluido y valores numéricos fuera de rango en el archivo: se usan los valores por defecto y la red carga', async () => {
  await conContexto({}, async ctx => {
    const base = await proyectoBase(ctx);
    base.fluid = { rho: -5, nu: 'abc', q_required: 'x', type: '<b>', temp: 'caliente', customName: { a: 1 } };
    base.arcs[1].D_mm = -3; base.arcs[1].L_m = 'abc'; base.nodes[0].cota = 'alto'; base.projectMeta = { name: 7, rev: { a: 1 }, __proto__: { x: 1 }, desconocido: 'z' };
    const { p } = await cargarHostil(ctx, URL_NUEVA, JSON.stringify(base).replace('"projectMeta":{', '"projectMeta":{"__proto__":{"polucion":1},'));
    igual(p.registro.dialogos.length, 0, 'no tiene que avisar error: ' + p.registro.dialogos.join(' | '));
    igual(await p.evaluate(() => [fluid.rho, fluid.nu, fluid.customName].join()), '998.2,0.000001004,');
    igual(await p.evaluate(() => [projectMeta.name, projectMeta.rev, projectMeta.desconocido, ({}).polucion].join()), 'Red Hidráulica,Rev. 0,,', 'solo los cinco campos conocidos y solo si son texto');
    igual(await p.evaluate(() => [state.arcs[1].D_mm, state.arcs[1].L_m, state.nodes[0].cota].join()), '200,100,0');
    await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
    cierto(/^Convergió/.test(await p.locator('#solver-status').innerText()), 'calcula tras cargar');
  });
});
prueba('nextId nunca queda por debajo del mayor id: lo nuevo no pisa lo cargado', async () => {
  await conContexto({}, async ctx => {
    const base = await proyectoBase(ctx); base.nextId = 1;
    const { p } = await cargarHostil(ctx, URL_NUEVA, base);
    await p.click('#mode-node'); const b = await p.locator('#net-svg').boundingBox(); await p.mouse.click(b.x + 40, b.y + b.height - 40); await pausa(p, 100);
    const ids = await p.evaluate(() => state.nodes.concat(state.arcs).map(e => e.id));
    igual(new Set(ids).size, ids.length, 'ids repetidos: ' + ids.join(','));
  });
});

seccion('Catálogo de bombas con datos hostiles');
const CATALOGO_HOSTIL = [
  { maker: IMG(20), model: '<b>M</b>', stock: IMG(21), notes: IMG(22), curve: [{ Q: 0, H: 10 }, { Q: 5, H: 0 }], powerCurve: [{ Q: 0, P: '<x>' }] },
  { maker: 'Bien', model: 'M2', stock: '7', curve: [{ Q: '0', H: '10' }, { Q: '5', H: '0' }] },
  { maker: 'Sin curva', model: 'X', curve: [{ Q: 0, H: 'abc' }, { Q: 1, H: 2 }] },
  null, 'texto', { maker: 'a' },
];
prueba('importar un catálogo con HTML en los datos: se muestra como texto, los registros inválidos se descartan y se avisa cuántos entraron', async () => {
  await conContexto({}, async ctx => {
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    await p.click('button:has-text("⛯ Catálogo")'); await subir(p, IMPORTAR, CATALOGO_HOSTIL); await pausa(p, 400);
    igual(await xss(p), undefined, 'no tiene que ejecutarse nada');
    igual(await p.evaluate(() => document.querySelectorAll('img[src="x"]').length), 0);
    cierto(p.registro.dialogos.some(d => /2 bomba\(s\) importada/.test(d)), 'diálogos: ' + p.registro.dialogos.join(' | '));
    cierto((await p.locator('#catalog-list').innerText()).includes('<img src=x'), 'el texto se ve literal');
    const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('hydra_pump_catalog_v1')));
    igual(guardado.length, 2); igual(typeof guardado[1].stock, 'number'); igual(guardado[0].stock, undefined, 'stock inválido no se guarda');
  });
});
prueba('contraste: la versión original ejecuta el catálogo hostil al mostrarlo', async () => {
  await conContexto({ externas: true }, async ctx => {
    const p = await abrir(ctx, srv.url + URL_V25);
    await p.click('button:has-text("⛯ Catálogo")'); await subir(p, IMPORTAR, CATALOGO_HOSTIL.slice(0, 3)); await pausa(p, 400);   // sin los elementos nulos: en v25 uno solo aborta toda la importación
    const r = await xss(p);
    console.log('      (en v25: window.__xss = ' + r + (r ? ' → el código del archivo se ejecutó' : ' → no se ejecutó con este vector') + ')');
    cierto(r === 21, 'v25 tendría que ejecutar el stock hostil; si no, esta prueba de contraste ya no demuestra nada');
  });
});
prueba('un catálogo guardado a mano con basura en el almacenamiento del navegador no rompe la pantalla', async () => {
  await conContexto({}, async ctx => {
    for (const basura of ['{no es json', 'null', '"texto"', '{"a":1}', '[1,2,3]', '[{"maker":"A","model":"B","curve":"x"}]']) {
      const p = await abrir(ctx, srv.url + URL_NUEVA);
      await p.evaluate(b => localStorage.setItem('hydra_pump_catalog_v1', b), basura);
      await p.click('button:has-text("⛯ Catálogo")'); await pausa(p, 150);
      igual(p.registro.errores.length, 0, 'almacenamiento «' + basura + '» → ' + p.registro.errores.join(' | '));
      await p.close();
    }
  });
});

const TRES_BOMBAS = JSON.stringify(['A', 'B', 'C'].map(m => ({ maker: m + 'maker', model: m + '1', stock: 1, notes: '', curve: [{ Q: 0, H: 10 }, { Q: 5, H: 0 }], powerCurve: [] })));
async function catalogoConBuscador(ctx, url) {
  const p = await abrir(ctx, srv.url + url);
  await p.evaluate(c => localStorage.setItem('hydra_pump_catalog_v1', c), TRES_BOMBAS);
  await p.click('button:has-text("⛯ Catálogo")'); await p.fill('#cat-search', 'cmaker'); await p.evaluate(() => renderCatalogList()); await pausa(p, 80);
  return p;
}
const fabricantes = p => p.evaluate(() => JSON.parse(localStorage.getItem('hydra_pump_catalog_v1')).map(x => x.maker).join());
prueba('con un texto en el buscador, borrar y editar actúan sobre la bomba que se ve', async () => {
  await conContexto({}, async ctx => {
    let p = await catalogoConBuscador(ctx, URL_NUEVA);
    await p.click('#catalog-list button:has-text("✕")'); await pausa(p, 100);
    igual(await fabricantes(p), 'Amaker,Bmaker', 'se tiene que borrar C, la que se veía'); await p.close();
    p = await catalogoConBuscador(ctx, URL_NUEVA);
    await p.click('#catalog-list button:has-text("✏")'); await pausa(p, 100);
    igual(await p.inputValue('#cat-maker'), 'Cmaker', 'se tiene que editar C, la que se veía');
  });
});
prueba('contraste: la versión original, con el mismo filtro, borra la primera bomba del catálogo en vez de la que se ve', async () => {
  await conContexto({ externas: true }, async ctx => {
    const p = await catalogoConBuscador(ctx, URL_V25);
    await p.click('#catalog-list button:has-text("✕")'); await pausa(p, 100);
    const r = await fabricantes(p);
    console.log('      (en v25 quedó: ' + r + ')');
    igual(r, 'Bmaker,Cmaker', 'v25 borra A aunque se veía C; si no, esta prueba de contraste ya no demuestra nada');
  });
});

seccion('Textos escritos a mano y exportación');
prueba('etiqueta con HTML escrita en el campo: se muestra literal en todos lados y no se ejecuta', async () => {
  await conContexto({}, async ctx => {
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    await p.locator('#canvas-root .node-el').nth(1).click(); await pausa(p, 100);
    await p.locator('#props-content [data-field="label"]').evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, IMG(30));
    await pausa(p, 100); await recorrer(p);
    igual(await xss(p), undefined); igual(await p.evaluate(() => document.querySelectorAll('img[src="x"]').length), 0);
    igual(await p.evaluate(() => state.nodes[1].label), IMG(30), 'el dato no se altera: solo se escapa al mostrarlo');
  });
});
prueba('exportar PDF y Excel con etiquetas extremas (5.000 caracteres, comillas, <>, emoji, saltos de línea) no falla', async () => {
  await conContexto({}, async ctx => {
    const p = await abrir(ctx, srv.url + URL_NUEVA);
    await p.evaluate(() => {
      state.nodes[1].label = 'N"<>\'&😀' + 'x'.repeat(5000); state.arcs[1].label = 'A\n\t"<b>' + 'y'.repeat(3000); projectMeta.name = 'Proyecto "raro" <&> ' + 'z'.repeat(300); projectMeta.notes = 'línea 1\nlínea 2\n' + 'w'.repeat(4000);
      renderNetwork(); renderSidebarLists();
    });
    await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p);
    const x = await descargar(p, () => p.click('button:has-text("📊 Excel")')); cierto(x.bytes > 5000, 'excel ' + x.bytes);
    const f = await descargar(p, async () => { await p.click('button:has-text("📄 PDF")'); await pausa(p, 80); await p.click('#modal-project-save-btn'); });
    cierto(f.bytes > 20000 && f.buf.slice(0, 5).toString() === '%PDF-', 'pdf ' + f.bytes + ' ' + f.nombre);
    cierto(!/[\\/:*?"<>|\n\r\t]/.test(f.nombre) && f.nombre.length < 200, 'nombre de archivo seguro: ' + f.nombre);
    igual(p.registro.errores.length, 0, p.registro.errores.join(' | ')); igual(p.registro.dialogos.length, 0, p.registro.dialogos.join(' | '));
  });
});

// ── Ejecución ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  srv = await servir(RAIZ); browser = await lanzar();
  let ok = false;
  try { ok = await correr('Pruebas de pantalla'); }
  finally { await browser.close(); await srv.cerrar(); }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
