// js/ui/eventos.js
'use strict';
/* Conexión de eventos de la barra de modos y de los selectores de etiquetas/colores. */

document.getElementById('mode-select')?.addEventListener('click',()=>setMode('select'));
document.getElementById('mode-node')?.addEventListener('click',()=>setMode('node'));
document.getElementById('mode-arc')?.addEventListener('click',()=>setMode('arc'));
document.getElementById('mode-pan')?.addEventListener('click',()=>setMode('pan'));

// node/arc type buttons: handled by inline onclick attrs — no addEventListener needed

document.getElementById('color-by')?.addEventListener('change', ()=>renderNetwork());
document.getElementById('arc-label')?.addEventListener('change', ()=>renderNetwork());
document.getElementById('node-label')?.addEventListener('change', ()=>renderNetwork());

// sb-tab: handled by inline onclick attrs
// res-tab: handled by inline onclick attrs (showResPane)

// SVG defs: already defined in HTML — no runtime insertion needed
