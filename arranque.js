// js/arranque.js
'use strict';
/* Arranque: se carga al final, cuando todos los módulos ya están definidos. Es la secuencia que el script original ejecutaba en
   mitad del archivo (panel de fluido, red de ejemplo, modo Select). Si algo falla antes de la marca de abajo, js/guarda.js
   muestra el aviso en pantalla. */
document.title = 'Hydra ' + VERSION_APP + ' — Calculadora de Redes Hidráulicas';
document.getElementById('tb-version').textContent = VERSION_APP;
initFluidPanel();
initDefaults();
setMode('select');
window.__HYDRA_LISTO__ = true;                               // lo lee js/guarda.js
