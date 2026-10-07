// tests/lib/navegador.js
'use strict';
/* Encuentra Playwright (instalado con `npm install`, o en la ruta indicada por la variable HYDRA_PLAYWRIGHT) y abre Chromium. */
function cargarPlaywright() {
  const candidatos = [process.env.HYDRA_PLAYWRIGHT, 'playwright'].filter(Boolean);
  for (const c of candidatos) { try { return require(c); } catch { /* prueba el siguiente */ } }
  throw new Error('No se encontró Playwright. Ejecutá «npm install» en la carpeta del proyecto (o definí HYDRA_PLAYWRIGHT con la ruta del módulo).');
}
async function lanzar() { return cargarPlaywright().chromium.launch(); }
module.exports = { lanzar };
