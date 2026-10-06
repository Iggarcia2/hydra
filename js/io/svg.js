// js/io/svg.js
'use strict';
/* Exportación del lienzo como archivo SVG. */

// Export PNG
function exportPNG() {
  const svgEl = document.getElementById('net-svg');
  const xml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml],{type:'image/svg+xml'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'red_hidraulica.svg';
  a.click();
}
