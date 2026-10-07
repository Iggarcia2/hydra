// tests/equivalencia/pantalla.js
'use strict';
/* Prueba de equivalencia de la PANTALLA contra la versión original de un solo archivo (versiones/hydra_v25.html).
   Abre las dos versiones en Chromium, ejecuta exactamente el mismo recorrido (clics, teclas, edición de propiedades, cálculo, vista 3D,
   fluido, proyecto, catálogo, guardar/cargar, exportar a Excel y PDF) y, después de cada paso, compara:
     · el HTML completo de la pantalla (sin <script>), los valores de todos los campos,
     · el estado interno (red, fluido, datos del proyecto, pilas de deshacer, catálogo guardado),
     · lo dibujado en cada <canvas> (solo su tamaño),
     · los cuadros de diálogo que aparecieron,
     · los archivos descargados (solo el nombre),
     · una captura de pantalla en los pasos marcados.
   Desde la v26 el cálculo cambió A PROPÓSITO (criterio de convergencia relativo, ley de fricción continua, diámetros SCH 40 corregidos, material
   con módulo de Young, etc.; ver README), así que los números de la pantalla ya no coinciden con los de v25: incluso la red de ejemplo da
   9,761 m en J1 y no 9,756 m (v25 se detenía con un residuo de 1e-4 en m³/s). Por eso, en esta prueba TODO NÚMERO se reemplaza por «#» antes
   de comparar: lo que tiene que coincidir es la estructura de la pantalla, los textos, las opciones, los avisos, el orden de las filas y el
   comportamiento de cada control. La exactitud de los números la prueban las pruebas del motor (tests/unit, tests/equivalencia/motor.js y
   tests/ref). Las diferencias de estructura que son parte del cambio están en ESPERADAS, cada una con su motivo.
   Las capturas ya no se comparan píxel a píxel (las cifras cambian el dibujo): tienen que ser del mismo tamaño y con menos de un 5 % de píxeles
   distintos, lo que detecta un diseño roto o un CSS que no cargó.
   Las librerías de internet de la versión original se sirven desde libs/ (mismas copias que usa el sitio nuevo), el reloj y Math.random
   están fijos y las tipografías de internet se descartan en los dos lados.
   Usá:  node tests/equivalencia/pantalla.js        (devuelve código 1 si hay alguna diferencia) */
const fs = require('fs'), path = require('path');
const { servir } = require('../lib/servidor.js');
const { lanzar } = require('../lib/navegador.js');
const { RAIZ, sha, nuevoContexto, FOTO, descargar, esperarCalculo, compararImagenes } = require('../lib/pagina.js');

const MAX_PIXELES_DISTINTOS = 0.05;      // fracción de píxeles de una captura que puede diferir (por las cifras nuevas)

/* Reemplaza los números por «#» (y las huellas SHA y los hashes de los lienzos): ver la cabecera. */
const NUMERO = /-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/gi;
const normalizar = s => String(s).replace(/[0-9a-f]{64}/g, 'SHA').replace(/(\d+x\d+):[0-9a-f]+/g, '$1:HASH').replace(NUMERO, '#');

/* Diferencias de estructura que son parte de la v26: [clave, patrón que se busca en la versión NUEVA, motivo, reemplazo (por defecto se quita)]. */
const ESPERADAS = [
  ['dom', /<th>Tramo<\/th><th>Material<\/th>[\s\S]*?<\/table>/g, 'tabla de ariete: columna nueva «Material» (encabezado y una celda por fila)',
    tabla => tabla.replace('<th>Material</th>', '').replace(/(<td>[^<]*<\/td>)\s*<td>(?:<span[^>]*>[^<]*<\/span>|[^<]*)<\/td>/g, '$1')],
  ['dom', /value="(?:Acero [^"]+|PVC|HDPE|Cobre|Fundición gris)"/g, 'las opciones del material llevan su nombre como valor (v25: la rugosidad)', 'value="#"'],
  ['dom', /<option value="#">PVC — ε # mm<\/option><option value="#">HDPE — ε # mm<\/option>/g, 'PVC y HDPE son dos materiales (v25: «PVC / HDPE», con módulos de Young 4 veces distintos)', '<option value="#">PVC / HDPE — ε # mm</option>'],
  ['dom', /; al elegir un diámetro nominal se carga el de Sch#\.\s*El módulo de Young sale del material elegido en el tramo; si no está indicado se usa el del acero \(del lado conservador\)\./g, 'nota de la tabla de ariete: espesor de Sch 40 al elegir el diámetro y módulo de Young por material', '.'],
  ['estado', /,"material":"[^"]*"/g, 'el tramo guarda el material elegido (campo nuevo `material`)'],
  ['dom', /<div class="tb-badge" id="tb-version">/g, 'la versión de la barra la escribe js/arranque.js desde VERSION_APP (v25 la traía fija en el HTML)', '<div class="tb-badge">'],
];
/* El select de material: v25 elegía la opción por la rugosidad (y mostraba «Personalizado» si no coincidía con ninguna) y v26 por el material
   del tramo; su valor se ignora en los dos lados (lo que se compara es que el control exista y se pueda editar). */
const IGNORAR = [['valores', /prop-material\|select-one\|[^|\n]*\|/g, 'prop-material|select-one|*|']];
/* La cantidad de puntos de una curva del sistema no se compara: v26 barre el rango completo aun con un nodo suelto en la red (v25 dejaba la curva
   corta porque su tolerancia absoluta daba por «convergido» el barrido en el punto de operación); lo que importa es que haya curva. */
IGNORAR.push(['estado', /(?:\{"Q":#,"H":#\},?)+/g, '{CURVA}']);

// ── Recorrido ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const idDe = (p, etiqueta) => p.evaluate(l => (state.nodes.concat(state.arcs).find(e => e.label === l) || {}).id, etiqueta);
const pausa = (p, ms = 120) => p.waitForTimeout(ms);
async function tecla(p, k) { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press(k); await pausa(p, 40); }
async function calcular(p) { await p.click('button:has-text("▶ Calcular")'); await esperarCalculo(p); }
async function pulsar(p, sel) { await p.click(sel); await pausa(p, 60); }
async function fijar(p, sel, valor, evento = 'change') {
  await p.locator(sel).evaluate((el, [v, ev]) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); if (ev) el.dispatchEvent(new Event(ev, { bubbles: true })); }, [valor, evento]);
  await pausa(p, 40);
}
async function clicNodo(p, etiqueta) { const id = await idDe(p, etiqueta); await p.click(`#canvas-root .node-el[data-id="${id}"]`); await pausa(p, 60); }
async function clicArco(p, etiqueta) { const id = await idDe(p, etiqueta); await p.click(`#canvas-root .arc-el[data-id="${id}"]`); await pausa(p, 60); }
async function lienzoPunto(p, fx, fy) { const b = await p.locator('#net-svg').boundingBox(); return { x: b.x + b.width * fx, y: b.y + b.height * fy }; }
async function clicLienzo(p, fx, fy) { const { x, y } = await lienzoPunto(p, fx, fy); await p.mouse.click(x, y); await pausa(p, 60); }

/** Toca TODOS los campos del panel de propiedades del elemento seleccionado (cada uno dispara su propio manejador), de a uno por vez. */
async function perturbarPropiedades(p, extra = {}) {
  const SEL = '#props-content input:not([type=file]):not([type=hidden]):not([disabled]), #props-content select, #props-content textarea';
  const hechos = [];
  for (let i = 0; i < 80; i++) {
    const n = await p.locator(SEL).count();
    if (i >= n) break;
    const el = p.locator(SEL).nth(i);
    const info = await el.evaluate(e => ({ tag: e.tagName, type: e.type, field: e.dataset.field || e.id || '', value: e.value, mode: e.getAttribute('inputmode'), opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.value) : [] }));
    hechos.push(info.field + ':' + info.tag);
    if (info.tag === 'SELECT') {
      const otra = info.opts.find(v => v !== info.value);
      if (otra !== undefined) await el.selectOption(otra);
    } else if (info.tag === 'TEXTAREA') {
      const nuevo = extra[info.field] || '0\t40\n60\t36\n120\t28\n180\t16\n220\t4';
      await el.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, nuevo);
      await pausa(p, 760);                                      // los editores de curvas esperan 600 ms antes de leer
    } else if (info.type === 'checkbox') {
      await el.click();
    } else if (info.mode === 'decimal' || info.type === 'number') {
      const x = parseFloat(String(info.value).replace(',', '.'));
      const nuevo = Number.isFinite(x) ? (x === 0 ? 1.5 : Math.round(x * 1.25 * 1000) / 1000) : 5;
      await el.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, String(nuevo).replace('.', ','));   // con coma decimal, como tipea el usuario
    } else {
      await el.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, info.value + 'x');
    }
    await pausa(p, 40);
  }
  return hechos.join(',');
}

const PASOS = [];
const paso = (nombre, fn, { captura = false } = {}) => PASOS.push({ nombre, fn, captura });

paso('inicio', async p => { await pausa(p, 350); }, { captura: true });
paso('calcular red de ejemplo', calcular, { captura: true });
for (const [t, nombre] of [['nodes-res', 'resultados: nodos'], ['arcs-res', 'resultados: arcos'], ['chart', 'resultados: curvas'], ['bom', 'resultados: BOM'], ['ariete', 'resultados: ariete'], ['kpis', 'resultados: resumen']])
  paso(nombre, async p => { await pulsar(p, '#rtab-' + t); await pausa(p, 150); });
paso('curvas: pestaña de la bomba', async p => { await pulsar(p, '#rtab-chart'); await pausa(p, 150); await pulsar(p, '#chart-tabs-bar button:nth-child(2)'); await pausa(p, 100); });
paso('panel lateral: nodos', p => pulsar(p, '#tab-nodes'));
paso('panel lateral: arcos', p => pulsar(p, '#tab-arcs'));
paso('panel lateral: fluido', p => pulsar(p, '#tab-fluid'));
paso('panel lateral: propiedades', p => pulsar(p, '#tab-props'));

paso('seleccionar nodo J1', p => clicNodo(p, 'J1'));
paso('editar todas las propiedades de J1', async p => { await perturbarPropiedades(p); });
paso('seleccionar tanque TS', p => clicNodo(p, 'TS'));
paso('editar todas las propiedades de TS (incluye rol)', async p => { await perturbarPropiedades(p); });
paso('calcular con rol de tanque', calcular);
paso('seleccionar tubería T1', p => clicArco(p, 'T1'));
paso('editar todas las propiedades de T1', async p => { await perturbarPropiedades(p); });
paso('calcular tras editar T1', calcular, { captura: true });
paso('seleccionar bomba BM-01', p => clicArco(p, 'BM-01'));
paso('editar todas las propiedades de la bomba (modo curva)', async p => { await perturbarPropiedades(p); });
paso('bomba: volver al modo curva y fijar caudal fijo', async p => {
  await fijar(p, '#props-content [data-field="pumpMode"]', 'fixedQ'); await pausa(p, 100);
  await fijar(p, '#props-content [data-field="fixedQ_m3h"]', '60,5');
});
paso('calcular con bomba de caudal fijo', calcular);
paso('bomba: presión fija', async p => { await fijar(p, '#props-content [data-field="pumpMode"]', 'fixedP'); await pausa(p, 100); await fijar(p, '#props-content [data-field="fixedP_bar"]', '4,2'); });
paso('calcular con bomba de presión fija', calcular);
paso('bomba: otra vez curva', async p => { await fijar(p, '#props-content [data-field="pumpMode"]', 'curve'); await pausa(p, 100); });
paso('calcular con bomba por curva', calcular);

// Alta de elementos con el mouse
paso('modo nodo (tecla N) y alta de dos nodos', async p => { await tecla(p, 'n'); await clicLienzo(p, 0.12, 0.85); await clicLienzo(p, 0.55, 0.88); });
paso('tipo tanque y alta de otro nodo', async p => { await pulsar(p, '#nt-tank'); await clicLienzo(p, 0.85, 0.85); await pulsar(p, '#nt-junction'); });
paso('modo arco (tecla A): tubería entre los dos primeros nuevos', async p => {
  await tecla(p, 'a');
  const ids = await p.evaluate(() => state.nodes.slice(-3).map(n => n.id));
  await p.click(`#canvas-root .node-el[data-id="${ids[0]}"]`); await p.click(`#canvas-root .node-el[data-id="${ids[1]}"]`); await pausa(p, 60);
});
paso('editar propiedades de la tubería nueva', async p => { await perturbarPropiedades(p); });
paso('arco: válvula', async p => {
  await pulsar(p, '#at-valve');
  const ids = await p.evaluate(() => state.nodes.slice(-3).map(n => n.id));
  await p.click(`#canvas-root .node-el[data-id="${ids[1]}"]`); await p.click(`#canvas-root .node-el[data-id="${ids[2]}"]`); await pausa(p, 60);
});
paso('editar propiedades de la válvula', async p => { await perturbarPropiedades(p); });
paso('arco: equipo', async p => {
  await pulsar(p, '#at-equip');
  const ids = await p.evaluate(() => state.nodes.slice(-3).map(n => n.id));
  await p.click(`#canvas-root .node-el[data-id="${ids[2]}"]`); await p.click(`#canvas-root .node-el[data-id="${await idDe(p, 'J3')}"]`); await pausa(p, 60);
});
paso('editar propiedades del equipo', async p => { await perturbarPropiedades(p); });
paso('arco: bomba', async p => {
  await pulsar(p, '#at-pump');
  const ids = await p.evaluate(() => state.nodes.slice(-3).map(n => n.id));
  await p.click(`#canvas-root .node-el[data-id="${ids[0]}"]`); await p.click(`#canvas-root .node-el[data-id="${await idDe(p, 'J2')}"]`); await pausa(p, 60);
});
paso('volver a tubería y a modo selección (Esc)', async p => { await pulsar(p, '#at-pipe'); await tecla(p, 'Escape'); });
paso('calcular con los elementos nuevos', calcular, { captura: true });
paso('arrastrar un nodo', async p => {
  const id = await idDe(p, 'J3'); const b = await p.locator(`#canvas-root .node-el[data-id="${id}"]`).boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 4 }); await p.mouse.up(); await pausa(p, 60);
});

// Deshacer / rehacer / borrar
paso('deshacer ×3 con botones', async p => { for (let i = 0; i < 3; i++) await pulsar(p, '#btn-undo'); });
paso('rehacer ×2 con botones', async p => { for (let i = 0; i < 2; i++) await pulsar(p, '#btn-redo'); });
paso('deshacer y rehacer con teclado', async p => { await p.keyboard.press('Control+z'); await pausa(p, 40); await p.keyboard.press('Control+z'); await pausa(p, 40); await p.keyboard.press('Control+y'); await pausa(p, 40); });
paso('borrar el nodo seleccionado (Supr)', async p => { await clicNodo(p, 'J3'); await tecla(p, 'Delete'); });
paso('borrar un arco', async p => { await clicArco(p, 'T3'); await tecla(p, 'Delete'); });
paso('deshacer el borrado', p => pulsar(p, '#btn-undo'));
paso('Enter calcula', async p => { await tecla(p, 'Enter'); await esperarCalculo(p); });

// Vista
paso('zoom +', p => pulsar(p, '.zoom-btn[title="Acercar"]'));
paso('zoom −', p => pulsar(p, '.zoom-btn[title="Alejar"]'));
paso('ajustar todo', async p => { await pulsar(p, '.zoom-btn[title="Ajustar todo"]'); await pausa(p, 150); });
paso('rueda del mouse', async p => { const { x, y } = await lienzoPunto(p, 0.5, 0.5); await p.mouse.move(x, y); await p.mouse.wheel(0, -240); await pausa(p, 80); await p.mouse.wheel(0, 120); await pausa(p, 80); });
paso('modo pan (tecla P) y arrastre', async p => { await tecla(p, 'p'); const { x, y } = await lienzoPunto(p, 0.5, 0.4); await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 60, y + 25, { steps: 5 }); await p.mouse.up(); await tecla(p, 's'); });
paso('atajos de zoom con teclado', async p => { await p.keyboard.press('Control+='); await pausa(p, 40); await p.keyboard.press('Control+-'); await pausa(p, 40); await p.keyboard.press('Control+0'); await pausa(p, 150); });
paso('vista isométrica 3D', async p => { await pulsar(p, '#btn-iso'); await pausa(p, 200); }, { captura: true });
paso('3D: seleccionar y colores por velocidad', async p => { await fijar(p, '#color-by', 'velocity'); await clicNodo(p, 'J1'); });
paso('3D: volver a 2D', async p => { await pulsar(p, '#btn-iso'); await pausa(p, 200); });
for (const v of ['velocity', 'headloss', 'flow', 'type']) paso('colorear arcos por ' + v, p => fijar(p, '#color-by', v));
for (const v of ['none', 'V', 'hf', 'name', 'Q']) paso('etiquetas de arcos: ' + v, p => fijar(p, '#arc-label', v));
for (const v of ['H', 'P', 'both', 'name']) paso('etiquetas de nodos: ' + v, p => fijar(p, '#node-label', v));

// Fluido y opciones de cálculo
paso('fluido personalizado', async p => {
  await pulsar(p, '#tab-fluid'); await fijar(p, '#fluid-type', 'custom', 'change');
  await fijar(p, '#fluid-name', 'Aceite <b>liviano</b>', 'input'); await fijar(p, '#fluid-rho', '870,5', 'input'); await fijar(p, '#fluid-nu', '45', 'input');
});
paso('calcular con fluido personalizado', calcular);
paso('fluido personalizado con valores inválidos', async p => { await fijar(p, '#fluid-rho', 'abc', 'input'); await fijar(p, '#fluid-nu', '-3', 'input'); });
paso('agua a 60 °C', async p => { await fijar(p, '#fluid-type', 'water', 'change'); await fijar(p, '#fluid-temp', '60', 'input'); });
paso('agua con temperatura inválida', async p => { await fijar(p, '#fluid-temp', 'xx', 'input'); await fijar(p, '#fluid-temp', '35,5', 'input'); });
paso('calcular con agua a 35,5 °C', calcular);
paso('caudal requerido', async p => { await fijar(p, '#q-required', '40', 'input'); await pulsar(p, '#rtab-kpis'); });
paso('caudal requerido imposible', async p => { await fijar(p, '#q-required', '9999', 'input'); });
paso('tolerancia alta e iteraciones', async p => { await fijar(p, '#solver-tol', '1e-6', 'change'); await fijar(p, '#solver-maxiter', '40', 'input'); });
paso('calcular con tolerancia alta', calcular);
paso('iteraciones inválidas', async p => { await fijar(p, '#solver-maxiter', '', 'input'); });
paso('calcular con iteraciones vacías', calcular);

// Proyecto, guardar, cargar, exportar
paso('datos del proyecto', async p => {
  await pulsar(p, 'button:has-text("🗒 Proyecto")');
  await fijar(p, '#proj-name', 'Red <i>norte</i> & "sur"', 'input'); await fijar(p, '#proj-rev', 'Rev. 3', 'input'); await fijar(p, '#proj-client', 'Bio4 S.A.', 'input');
  await fijar(p, '#proj-engineer', 'I. García', 'input'); await fijar(p, '#proj-notes', 'Primera línea\nSegunda línea', 'input');
  await pulsar(p, '#modal-project-save-btn');
});
paso('datos del proyecto: cancelar', async p => { await pulsar(p, 'button:has-text("🗒 Proyecto")'); await fijar(p, '#proj-name', 'No se guarda', 'input'); await pulsar(p, '#modal-project .modal-btn:has-text("Cancelar")'); });

const GUARDADOS = {};   // contenido de los archivos que se bajan (para volver a cargarlos)
paso('guardar proyecto (JSON)', async p => ({ descarga: pubDescarga(GUARDADOS, 'proyecto', await descargar(p, () => p.click('button:has-text("💾 Guardar")'))) }));
paso('exportar a Excel', async p => ({ descarga: pubDescarga(GUARDADOS, 'excel', await descargar(p, () => p.click('button:has-text("📊 Excel")'))) }));
paso('exportar a PDF (pide revisión primero)', async p => ({
  descarga: pubDescarga(GUARDADOS, 'pdf', await descargar(p, async () => { await p.click('button:has-text("📄 PDF")'); await pausa(p, 60); await p.click('#modal-project-save-btn'); })),
}));
paso('limpiar red (confirmación aceptada)', async p => { await p.click('button:has-text("✕ Limpiar")'); await pausa(p, 100); });
paso('calcular red vacía', calcular);
paso('abrir el proyecto guardado', async p => {
  await p.locator('input[type=file][onchange*="loadProject"]').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: GUARDADOS.proyecto.buf });
  await pausa(p, 300);
}, { captura: true });
paso('calcular el proyecto abierto', calcular);
paso('exportar PDF del proyecto abierto', async p => ({
  descarga: pubDescarga(GUARDADOS, 'pdf2', await descargar(p, async () => { await p.click('button:has-text("📄 PDF")'); await pausa(p, 60); await p.click('#modal-project-save-btn'); })),
}));

// Catálogo de bombas
paso('catálogo: abrir vacío', async p => { await pulsar(p, 'button:has-text("⛯ Catálogo")'); });
paso('catálogo: bomba sin datos (aviso)', async p => { await pulsar(p, '#modal-catalog button:has-text("+ Nueva bomba")'); await pulsar(p, '#modal-add-pump .modal-btn.primary'); });
paso('catálogo: curva incompleta (aviso)', async p => { await fijar(p, '#cat-maker', 'KSB', 'input'); await fijar(p, '#cat-model', 'Etanorm', 'input'); await fijar(p, '#cat-hq', '0\t30', 'input'); await pulsar(p, '#modal-add-pump .modal-btn.primary'); });
paso('catálogo: guardar bomba', async p => {
  await fijar(p, '#cat-hq', '0\t45\n100\t40\n200\t30\n300\t15\n350\t0', 'input'); await fijar(p, '#cat-pq', '0\t15\n200\t18\n350\t22', 'input');
  await fijar(p, '#cat-stock', '3', 'input'); await fijar(p, '#cat-pump-notes', 'Nueva <script>x</script>', 'input'); await pulsar(p, '#modal-add-pump .modal-btn.primary');
});
paso('catálogo: segunda bomba sin stock', async p => {
  await pulsar(p, '#modal-catalog button:has-text("+ Nueva bomba")'); await fijar(p, '#cat-maker', 'Grundfos', 'input'); await fijar(p, '#cat-model', 'CM3-5', 'input');
  await fijar(p, '#cat-stock', '0', 'input'); await fijar(p, '#cat-hq', '0\t50\n50\t45\n100\t30', 'input'); await pulsar(p, '#modal-add-pump .modal-btn.primary');
});
paso('catálogo: buscar', async p => { await fijar(p, '#cat-search', 'grund', 'input'); await fijar(p, '#cat-search', 'zzz', 'input'); await fijar(p, '#cat-search', '', 'input'); });
paso('catálogo: editar', async p => { await pulsar(p, '#catalog-list button:has-text("✏") >> nth=0'); await fijar(p, '#cat-stock', '7', 'input'); await pulsar(p, '#modal-add-pump .modal-btn.primary'); });
paso('catálogo: exportar', async p => ({ descarga: pubDescarga(GUARDADOS, 'catalogo', await descargar(p, () => p.click('#modal-catalog button:has-text("💾 Exportar catálogo")'))) }));
paso('catálogo: borrar una bomba', async p => { await pulsar(p, '#catalog-list button:has-text("✕") >> nth=1'); });
paso('catálogo: importar el archivo exportado', async p => {
  await p.locator('input[type=file][onchange*="importCatalog"]').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: GUARDADOS.catalogo.buf }); await pausa(p, 250);
});
paso('catálogo: importar un archivo que no es catálogo', async p => {
  await p.locator('input[type=file][onchange*="importCatalog"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"no":"es lista"}') }); await pausa(p, 250);
});
paso('catálogo: cerrar', async p => { await pulsar(p, '#modal-catalog .modal-footer .modal-btn'); });

paso('abrir un archivo que no es proyecto', async p => {
  await p.locator('input[type=file][onchange*="loadProject"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('esto no es json') }); await pausa(p, 250);
});
paso('estado final', async p => { await pausa(p, 100); }, { captura: true });

function pubDescarga(almacen, clave, d) { almacen[clave] = d; return { nombre: d.nombre, bytes: d.bytes, sha: d.sha }; }

// ── Ejecución de una versión ──────────────────────────────────────────────────────────────────────────────────────────────────
async function correr(browser, base, ruta, etiqueta, externas) {
  const ctx = await nuevoContexto(browser, base, { externas });
  const p = await ctx.newPage();
  const dialogos = [], consola = [], errores = [];
  p.on('dialog', d => { dialogos.push(d.type() + ': ' + d.message()); d.accept(); });
  // Los «Failed to load resource» son las tipografías que esta prueba bloquea a propósito; cualquier otro aviso o error cuenta.
  p.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) consola.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errores.push(e.message));
  for (const k of Object.keys(GUARDADOS)) delete GUARDADOS[k];
  await p.goto(base + ruta);
  const fotos = [];
  for (const ps of PASOS) {
    const nDial = dialogos.length;
    let extra = null, fallo = null;
    try { extra = (await ps.fn(p)) || null; } catch (e) { fallo = String(e.message).split('\n')[0]; }
    const foto = await p.evaluate(FOTO);
    foto.dialogos = dialogos.slice(nDial).join('\n');
    foto.extra = JSON.stringify(extra);
    foto.fallo = fallo || '';
    if (ps.captura) {
      await p.mouse.move(700, 885); await pausa(p, 700);        // saca el mouse de los botones y deja terminar las transiciones de color (hover, cartelitos)
      const png = await p.screenshot({ animations: 'disabled', caret: 'hide' });
      foto.captura = sha(png); foto.png = png;
      if (process.env.HYDRA_GUARDAR_CAPTURAS) fs.writeFileSync(path.join(process.env.HYDRA_GUARDAR_CAPTURAS, etiqueta + '-' + fotos.length + '.png'), png);
    }
    fotos.push(foto);
  }
  const sinRed = ctx.__sinRed.slice();
  await ctx.close();
  return { fotos, consola, errores, sinRed };
}

function primeraDiferencia(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = s => JSON.stringify(s.slice(Math.max(0, i - 60), i + 100));
  return 'posición ' + i + '\n      original: ' + ctx(a) + '\n      nuevo   : ' + ctx(b);
}

async function main() {
  const srv = await servir(RAIZ);
  const browser = await lanzar();
  let diferencias = 0, comparaciones = 0;
  const capturas = { identicas: 0, fracciones: [] };
  const vistas = new Set();
  try {
    const orig = await correr(browser, srv.url, '/versiones/hydra_v25.html', 'v25', true);
    const nuevo = await correr(browser, srv.url, '/index.html', 'repo', false);
    for (let i = 0; i < PASOS.length; i++) {
      const a = orig.fotos[i], b = nuevo.fotos[i];
      const malas = [];
      for (const k of ['dom', 'valores', 'lienzos', 'estado', 'dialogos', 'extra', 'fallo', 'captura']) {
        if (a[k] === undefined && b[k] === undefined) continue;
        comparaciones++;
        if (k === 'captura') {
          if (a.captura === b.captura) { capturas.identicas++; continue; }
          const c = await compararImagenes(browser, a.png, b.png);
          const fr = c.mismoTamano ? c.distintos / c.total : 1;
          capturas.fracciones.push({ paso: i + 1, fr });
          if (!c.mismoTamano || fr > MAX_PIXELES_DISTINTOS) malas.push([k, c.mismoTamano ? (100 * fr).toFixed(1) + ' % de píxeles distintos' : 'tamaños distintos']);
          continue;
        }
        let x = normalizar(a[k]), y = normalizar(b[k]);
        for (const [clave, patron, reemplazo] of IGNORAR) if (clave === k) { x = x.replace(patron, reemplazo); y = y.replace(patron, reemplazo); }
        for (const [clave, patron, , reemplazo] of ESPERADAS) if (clave === k) y = y.replace(patron, reemplazo === undefined ? '' : reemplazo);
        if (x !== y) malas.push([k, primeraDiferencia(x, y)]);
      }
      if (malas.length) {
        diferencias += malas.length;
        console.log('✗ paso ' + (i + 1) + ' «' + PASOS[i].nombre + '»: difiere ' + malas.map(m => m[0]).join(', '));
        for (const [k, d] of malas) {
          const firma = k + d.replace(/posición \d+/, '');
          if (vistas.has(firma)) continue;          // la misma diferencia se arrastra a los pasos siguientes: se muestra una sola vez
          vistas.add(firma); console.log('    · ' + k + ' — ' + d);
        }
      }
    }
    console.log('Capturas de pantalla: ' + capturas.identicas + ' idénticas byte a byte · ' + capturas.fracciones.length + ' con cifras distintas' + (capturas.fracciones.length
      ? ' (' + capturas.fracciones.map(r => 'paso ' + r.paso + ': ' + (100 * r.fr).toFixed(2) + ' % de píxeles').join('; ') + ')' : '') + '.');
    const huellas = [];
    for (const f of orig.fotos) if (f.extra && f.extra !== 'null') huellas.push(JSON.parse(f.extra).descarga);
    console.log('Pasos: ' + PASOS.length + ' · comparaciones: ' + comparaciones + ' · diferencias: ' + diferencias);
    console.log('Archivos descargados con el mismo nombre: ' + huellas.map(h => h.nombre).join(', '));
    console.log('Diálogos en el recorrido: ' + orig.fotos.reduce((s, f) => s + (f.dialogos ? f.dialogos.split('\n').length : 0), 0));
    // Consola y errores: tienen que coincidir y, en el sitio nuevo, ser cero salvo lo esperado del propio recorrido (archivo inválido, etc.)
    const cA = JSON.stringify(orig.consola.concat(orig.errores)), cB = JSON.stringify(nuevo.consola.concat(nuevo.errores));
    comparaciones++;
    if (cA !== cB) { diferencias++; console.log('✗ consola/errores difieren\n   original: ' + cA + '\n   nuevo   : ' + cB); }
    else console.log('Consola y errores iguales en ambos (' + orig.consola.length + ' avisos, ' + orig.errores.length + ' errores de página).');
    if (nuevo.sinRed.length) { diferencias++; console.log('✗ el sitio nuevo pidió recursos externos:', nuevo.sinRed); }
    else console.log('El sitio nuevo no pidió ningún recurso de internet.');
  } finally {
    await browser.close(); await srv.cerrar();
  }
  console.log(diferencias === 0 ? 'EQUIVALENCIA DE PANTALLA: OK' : 'EQUIVALENCIA DE PANTALLA: HAY DIFERENCIAS');
  process.exit(diferencias === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
