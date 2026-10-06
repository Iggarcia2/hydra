# Librerías incluidas (sin CDN)

Todo el sitio funciona sin conexión a internet: estas librerías se sirven desde esta carpeta.

| Archivo | Librería | Versión | Origen | SHA-256 |
|---|---|---|---|---|
| `jspdf.umd.min.js` | jsPDF (MIT) | 2.5.1 | paquete npm `jspdf@2.5.1`, `dist/jspdf.umd.min.js` (el mismo archivo que servía cdnjs) | `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875` |
| `jspdf.plugin.autotable.min.js` | jsPDF-AutoTable (MIT) | 3.8.2 | paquete npm `jspdf-autotable@3.8.2`, `dist/jspdf.plugin.autotable.min.js` | `27a9c3b61843c6312b87f142d40fe77c0f0f054c9f3cdeccc4bfd5f3322859c8` |
| `xlsx.full.min.js` | SheetJS Community Edition (Apache-2.0) | 0.18.5 | paquete npm `xlsx@0.18.5`, `dist/xlsx.full.min.js` | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| `fuentes/*.woff2` | IBM Plex Mono e IBM Plex Sans (SIL OFL 1.1) | 5.3.0 | paquetes npm `@fontsource/ibm-plex-mono` y `@fontsource/ibm-plex-sans`, subconjunto latin, pesos 300/400/500/600 | — |

Notas
- La versión original cargaba SheetJS 0.20.0 desde cdn.sheetjs.com. Esa versión no se publica en npm (el último paquete npm oficial es 0.18.5) y el
  entorno de armado no pudo bajarla del CDN de SheetJS. Hydra solo **escribe** Excel (`book_new`, `aoa_to_sheet`, `book_append_sheet`, `writeFile`), una API que no
  cambia entre 0.18.5 y 0.20.0, y no lee archivos Excel (las vulnerabilidades conocidas de 0.18.5 afectan a la lectura). Para pasar a 0.20.x:
  bajar `xlsx.full.min.js` desde https://cdn.sheetjs.com/ y reemplazar el archivo de esta carpeta.
- La versión original cargaba también Chart.js 4.4.1, pero nunca lo usaba (los gráficos H-Q se dibujan con canvas propio), así que no se incluyó.
- `jspdf.umd.min.js` termina con un comentario `sourceMappingURL` hacia un `.map` que no se incluye; solo afecta a las herramientas de desarrollo del navegador.
