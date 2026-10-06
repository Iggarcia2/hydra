// js/guarda.js
'use strict';
/* Guarda de carga. Es el primer script: si un archivo (script, librería o estilos) no se descarga, o si algo falla mientras la
   aplicación arranca, muestra un aviso claro arriba de la pantalla en lugar de dejar una página a medias que parece
   funcionar. arranque.js (el último script) marca la aplicación como lista.
   No depende de ningún otro archivo ni del CSS; todo el texto se inserta con textContent (sin HTML). */
(function () {
  const fallos = [];        // problemas que impiden usar la aplicación (js/, estilos, errores de arranque)
  const faltanLibs = [];    // librerías de exportación (libs/): la red se calcula igual, pero no se puede exportar a PDF/Excel
  let caja = null;

  function mostrar() {
    const padre = document.body || document.documentElement;
    if (!caja) {
      caja = document.createElement('div');
      caja.setAttribute('role', 'alert');
      padre.appendChild(caja);
    }
    const grave = fallos.length > 0;
    // Grave: franja roja arriba (la aplicación no se puede usar). Solo faltan librerías de exportación: franja ámbar ABAJO y con botón para ocultarla,
    // porque arriba taparía la barra de botones y la aplicación sí funciona.
    caja.style.cssText = 'position:fixed;' + (grave ? 'top:0;' : 'bottom:0;') + 'left:0;right:0;z-index:2147483647;padding:10px 14px;color:#fff;' +
      'font:13px/1.45 system-ui,sans-serif;max-height:50vh;overflow:auto;' +
      (grave ? 'background:#7f1d1d;border-bottom:2px solid #fca5a5' : 'background:#78350f;border-top:2px solid #fcd34d');
    caja.textContent = '';
    const t = document.createElement('strong');
    t.textContent = grave
      ? 'Hydra no pudo iniciar correctamente. No uses los resultados hasta resolverlo.'
      : 'Faltan librerías de exportación: la red se calcula normalmente, pero exportar a PDF o Excel no va a funcionar.';
    caja.appendChild(t);
    fallos.concat(faltanLibs).forEach(function (f) { const d = document.createElement('div'); d.textContent = '· ' + f; caja.appendChild(d); });
    const p = document.createElement('div');
    p.textContent = 'Revisá que la carpeta del proyecto esté completa (index.html junto a css/, js/ y libs/) y recargá la página con Ctrl+F5.';
    caja.appendChild(p);
    if (!grave) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'Ocultar aviso';
      b.style.cssText = 'margin-top:6px;padding:3px 10px;font:inherit;cursor:pointer';
      b.addEventListener('click', function () { caja.style.display = 'none'; });
      caja.appendChild(b);
    }
  }

  function anotar(lista, texto) { if (fallos.indexOf(texto) < 0 && faltanLibs.indexOf(texto) < 0) lista.push(texto); mostrar(); }

  // Fase de captura: los errores de descarga de un <script> no burbujean hasta window.
  window.addEventListener('error', function (ev) {
    if (window.__HYDRA_LISTO__) return;                                   // solo vigila la carga inicial
    const el = ev.target;
    if (el && el !== window && el.tagName === 'SCRIPT') {
      const src = el.getAttribute('src') || '(sin ruta)';
      anotar(/^libs\//.test(src) ? faltanLibs : fallos, 'No se pudo cargar el archivo ' + src + '.');
    } else if (el === window) {
      const donde = ev.filename ? ' [' + String(ev.filename).split('/').slice(-2).join('/') + ':' + ev.lineno + ']' : '';
      anotar(fallos, 'Error al iniciar: ' + (ev.message || 'desconocido') + donde);
    }
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    if (!window.__HYDRA_LISTO__) anotar(fallos, 'Error al iniciar: ' + String(ev.reason && ev.reason.message || ev.reason));
  });

  window.addEventListener('load', function () {
    if (!window.__HYDRA_LISTO__ && !fallos.length) anotar(fallos, 'La aplicación no terminó de iniciar.');
    // Los estilos están en <head> y se piden antes de que corra este script, así que su error de descarga no se puede escuchar:
    // se comprueba el resultado. css/estilos.css define --bg en :root; si no está, no se aplicó (archivo faltante, 404, vacío o tipo MIME erróneo)
    if (!window.getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()) {
      anotar(fallos, 'Los estilos (css/estilos.css) no se aplicaron: la página se vería sin formato.');
    }
  });
})();
