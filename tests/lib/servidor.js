// tests/lib/servidor.js
'use strict';
/* Servidor HTTP mínimo (solo lectura) para probar el sitio como lo sirve GitHub Pages. Sirve archivos de una carpeta, nada más. */
const http = require('http'), fs = require('fs'), path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Arranca el servidor en un puerto libre. Devuelve {url, cerrar()}. `raiz` es la carpeta que se publica. */
function servir(raiz) {
  const base = path.resolve(raiz);
  const srv = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let ruta;
    try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (ruta.endsWith('/')) ruta += 'index.html';
    const archivo = path.resolve(base, '.' + ruta);
    if (archivo !== base && !archivo.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }   // nada fuera de la carpeta
    fs.readFile(archivo, (err, datos) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : datos);
    });
  });
  return new Promise((ok, mal) => {
    srv.once('error', mal);
    srv.listen(0, '127.0.0.1', () => ok({ url: 'http://127.0.0.1:' + srv.address().port, cerrar: () => new Promise(r => srv.close(r)) }));
  });
}
module.exports = { servir };
