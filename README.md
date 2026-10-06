# Hydra — calculadora de redes hidráulicas

Editor en pantalla y solver de redes de tuberías: tanques, nodos con demanda, tuberías, bombas (curva H-Q, caudal fijo o presión fija), válvulas, equipos y retenciones. Calcula cargas, presiones, caudales, velocidades y pérdidas con Newton-Raphson (Jacobiano analítico, búsqueda de línea y continuación adaptativa) y fricción de Colebrook-White / Hagen-Poiseuille; arma la curva del sistema de cada bomba, el golpe de ariete (Joukowsky), la lista de materiales, y exporta memoria de cálculo en PDF, planilla Excel y proyecto en JSON.

Es un **sitio estático**: no hay servidor, ni compilación, ni internet en uso (las librerías y tipografías están en `libs/`). Se puede abrir con doble clic en `index.html` o publicar tal cual en GitHub Pages.

Versión de la aplicación: **v25** (la del archivo único original). Versión del repositorio: **1.0.0** (reorganización y endurecimiento; los cálculos no cambian, ver «Cambios respecto de v25»).

## Estructura

```
index.html            marcado de la pantalla y ORDEN DE CARGA de los scripts (única lista; los tests la leen de acá)
css/estilos.css       estilos
js/
  guarda.js           primer script: avisa en pantalla si falta un archivo, una librería o los estilos, o si algo falla al arrancar
  datos/              constantes y tablas: gravedad, agua (ρ, ν por temperatura), diámetros y rugosidades, accesorios y curvas K-apertura
  nucleo/             MOTOR DE CÁLCULO, sin DOM ni estado global: fricción, accesorios, bombas, álgebra, solver, curva del sistema, ariete,
                      aplicación de resultados y validación de archivos importados
  estado.js           estado de la aplicación (red, fluido, deshacer/rehacer) y fábricas de nodos y arcos
  ui/                 pantalla: lienzo SVG, propiedades, listas, resultados, gráfico H-Q, botón Calcular, eventos
  io/                 exportar PDF / Excel / PNG, guardar y abrir proyecto, catálogo de bombas
  arranque.js         último script: red de ejemplo y marca «lista»
libs/                 jsPDF, jsPDF-AutoTable, SheetJS y tipografías IBM Plex (con licencias y huellas en libs/VERSIONES.md)
versiones/            hydra_v25.html: el archivo único original, sin tocar
tests/                unitarias, contraste con Python, prueba de pantalla y equivalencia con v25
```

**Por qué scripts clásicos y no módulos.** Los scripts se cargan en orden y comparten el mismo ámbito global (`const`, `let` y `function` de nivel superior se ven entre archivos), igual que en el archivo único. Por eso los `onclick="..."` del HTML siguen funcionando y el sitio abre con doble clic (`file://`), donde los módulos ES no cargan. A cambio, **el orden de `index.html` importa**: cada archivo solo puede usar en el momento de la carga lo que definieron los anteriores (dentro de las funciones, que corren después, no hay restricción).

**El motor no sabe de la pantalla.** `js/datos/` y `js/nucleo/` reciben todo por parámetro: `solveNetwork(red, opc)` con `red = {nodes, arcs, fluid:{rho, nu}}` y `opc = {tol, maxIter}`; `pipeCalc(dH, arc, fluid)`; `computeSystemCurve(red, bomba)`; `calcArieteTramo(arc, fluid, P_bar)`. Los tests lo prueban cargándolo en un contexto de Node vacío: si un archivo del motor nombrara `document`, `window` o `state`, la carga fallaría.

## Usarlo

- **En tu computadora:** abrí `index.html` con doble clic.
- **Con servidor local (opcional):** `python -m http.server 8000` en esta carpeta y abrí `http://localhost:8000/`.
- **Calcular:** botón ▶ Calcular o tecla Enter. Atajos: S selección, N nodo, A arco, P mover vista, Supr borrar, Ctrl+Z / Ctrl+Y deshacer y rehacer, Ctrl+0 ajustar vista.

## Publicar en GitHub Pages

1. En GitHub: **New repository** → nombre `hydra`, público, sin README ni `.gitignore` (ya vienen en la carpeta).
2. En la página del repositorio vacío: **uploading an existing file** y arrastrá el contenido de la carpeta `hydra` **de a una carpeta por vez** (`css`, `js`, `libs`, `tests`, `versiones`) y después los archivos sueltos de la raíz. GitHub admite hasta 100 archivos por carga: controlá el contador antes de confirmar con **Commit changes**. Tienen que quedar subidos `.nojekyll` y `.gitignore` (archivos con punto adelante).
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)` → Save.
4. En uno o dos minutos queda en `https://<tu-usuario>.github.io/hydra/`.

`.nojekyll` evita que GitHub procese el sitio con Jekyll (ignoraría carpetas que empiezan con guion bajo y retrasaría la publicación).

**Versiones nuevas.** Antes de cambiar la aplicación, copiá el estado actual a `versiones/` con su número y marcá el commit con una etiqueta (`git tag v26`). El archivo principal conserva su nombre (`index.html`).

## Verificación

```
node tests/correr_todo.js                 unitarias del motor + contraste con Python
node tests/correr_todo.js --e2e           + prueba de pantalla (Chromium)
node tests/correr_todo.js --equivalencia  + equivalencia con v25 (motor y pantalla)
node tests/correr_todo.js --todo          todo (varios minutos)
```

Requisitos: Node 18 o más; para la pantalla, `npm install` (instala Playwright; después `npx playwright install chromium` si el navegador no está); para el contraste, Python 3 con `numpy` y `scipy`. Si falta algo, el paso se informa como **FALLA** (nada se omite en silencio).

| Prueba | Qué comprueba | Resultado |
|---|---|---|
| `tests/unit/test_nucleo.js` | Motor sin pantalla (carga en un contexto vacío): utilidades, propiedades del agua, Colebrook y Hagen-Poiseuille, accesorios, bombas, álgebra, golpe de ariete, solver contra soluciones analíticas (bisección), entradas inválidas y 40 redes aleatorias con balance de masa | 56 correctas, 0 con error |
| `tests/ref/` (`gen_casos.js` + `ref.py`) | 68 redes (62 las resuelve el motor) contra una implementación independiente en Python (numpy/scipy, tablas reescritas aparte): el residuo de las ecuaciones independientes y la solución obtenida desde cero | 62 comparadas. Turbulentas: carga ≤ 1,1e-7 m, caudal ≤ 2,1e-7 (relativo). Laminar/transición (3): carga ≤ 1,4e-9 m |
| `tests/e2e/pantalla.js` | Carga limpia por http y por `file://` sin pedir nada a internet; aviso de carga con el sitio roto a propósito; archivos de proyecto y catálogo hostiles (contra v25); textos extremos; exportar PDF y Excel | 23 correctas, 0 con error |
| `tests/equivalencia/motor.js` | 150 redes aleatorias (semilla fija) resueltas por v25 y por el repo, con todos los resultados comparados de forma exacta | 945 comparaciones, 0 diferencias (15 redes se descartan por tardar más de 2 s en v25) |
| `tests/equivalencia/pantalla.js` | Recorrido de 106 pasos en v25 y en el repo: HTML, campos, estado interno, cada `<canvas>`, diálogos, archivos descargados y 7 capturas de pantalla | 749 comparaciones, 0 diferencias; JSON, Excel y PDF idénticos; 7 capturas idénticas byte a byte |

La equivalencia con v25 corre el mismo caso en las dos versiones y compara de forma **exacta** (cada número, incluidos NaN, Infinity y −0): el texto original del archivo único contra los archivos de `js/`, ambos en el mismo motor de JavaScript, de modo que un resultado distinto en el último decimal se vería. En la pantalla compara además el HTML completo, el estado interno, cada `<canvas>`, los diálogos y los archivos descargados (JSON, Excel y PDF idénticos byte a byte con reloj y azar fijos). Las capturas se comparan píxel a píxel y solo se tolera un cambio de hasta 8/255 en un canal (el dibujado de las esquinas redondeadas puede variar ±1 entre dos corridas de la misma versión); cualquier otro cambio cuenta como diferencia y lo que quede bajo el umbral se informa.

## Cambios respecto de v25

El cálculo y la pantalla son equivalentes (ver arriba). Lo que cambió, a propósito:

**Seguridad y validación de datos externos**

- Todo texto que viene de un archivo o del usuario y se inserta en el HTML pasa por `esc()` (campos de propiedades, tablas de resultados, catálogo). En v25 una etiqueta, un id o un «stock» con HTML se ejecutaba como código al abrir un proyecto o importar un catálogo; las pruebas lo demuestran sobre la versión original.
- Abrir un proyecto valida el archivo **antes** de tocar la red: ids enteros y únicos (nodos y arcos comparten el espacio de ids), tipos permitidos, números finitos, arcos unidos a nodos que existen, fluido con ρ y ν positivos, datos del proyecto solo como texto y solo los cinco campos conocidos. Si el archivo es inválido, se avisa con un mensaje claro y la red que había queda intacta (v25 reemplazaba los nodos y recién después revisaba los arcos).
- El motor rechaza datos no finitos (NaN, ±Infinity) con un mensaje que nombra el campo. En v25, un diámetro NaN daba «Convergió en 1 iteración» sobre datos rotos (desde la pantalla no se llegaba a ese caso). `getWaterProps` lanza un error ante una temperatura no numérica en vez de devolver `undefined`.
- Catálogo de bombas: lo guardado en el navegador se valida al leerlo (un valor «null» rompía la pantalla); importar tolera elementos nulos o inválidos y los descarta (en v25, uno solo abortaba toda la importación) y guarda los tipos normalizados.
- **Error de v25 corregido:** con un texto en el buscador del catálogo, ✏ y ✕ actuaban sobre otra bomba (usaban la posición dentro de la lista filtrada). Ahora usan la posición en el catálogo completo.
- Nombres de archivo exportados acotados a 100 caracteres (un nombre larguísimo no se podía guardar).

**Sitio y carga**

- Sin dependencias de internet: jsPDF 2.5.1 y jsPDF-AutoTable 3.8.2 (las mismas versiones que cargaba v25), SheetJS **0.18.5** (v25 cargaba la 0.20.0 desde cdn.sheetjs.com, que no se pudo bajar; Hydra solo escribe Excel y esa API no cambia, ver `libs/VERSIONES.md`), tipografías IBM Plex locales. Chart.js se quitó: v25 lo cargaba y no lo usaba.
- `js/guarda.js` avisa en pantalla si falta un script, una librería o la hoja de estilos, o si algo falla al arrancar (en v25, un archivo faltante dejaba una página a medias sin decir nada). Si solo faltan librerías de exportación, el aviso es ámbar, va abajo y se puede ocultar; exportar muestra un mensaje que lo explica.
- Mensaje dentro de la página si el navegador tiene JavaScript desactivado.

## Hallazgos de v25 que NO se corrigieron

Se dejan como estaban para que los resultados sigan siendo los de v25; cada uno tiene un test que **falla a propósito** si algún día se corrige (para que lo actualices). Para decidir con criterio de ingeniería, no de código:

1. **Retención como «elemento válvula» contra la corriente.** El solver la bloquea (caudal 0) pero la tabla de resultados informa el caudal inverso que habría sin retención (hasta −90 m³/h en un caso de prueba), así que el balance de masa que se ve en los nodos no cierra. El tipo antiguo `check` sí se recorta a cero. Reproducir: tanque A (30 m) → junta J → válvula «Retención» → tanque B (50 m).
2. **Golpe de ariete: módulo de Young.** El material se busca en `E_YOUNG` con una clave (`'Acero carbono'`, `'PVC / HDPE'`, …) que no existe en esa tabla (`'Acero'`, `'PVC'`, …), así que **todo material usa 200 GPa (acero)**. Para PVC/HDPE la celeridad de onda y la sobrepresión salen sobreestimadas (del lado conservador en ΔP, pero no es el valor real).
3. **Fluidos muy viscosos en régimen laminar no convergen** (≈100 cSt o más con tubería chica). El Jacobiano usa la conductancia del régimen turbulento (Q/2ΔH); en laminar la pendiente real es Q/ΔH y Newton oscila. El solver lo informa («No convergió»), no da un resultado falso.
4. **Fricción en la zona de transición.** Por debajo de Re 2300 usa 64/Re y por encima Colebrook, sin interpolar: entre Re 2300 y 4000 el caudal puede no tener una solución única. Además, `pipeCalc` itera 12 veces la fricción: en flujo muy laminar queda a ~0,1 % de la solución cerrada (Hagen-Poiseuille). En turbulento coincide con Colebrook resuelto aparte a 1e-7.
5. **Resultados que dependen de la tolerancia elegida.** Los datos se muestran con la tolerancia que elegiste («Normal» 1e-4 por defecto); para informes, usá «Alta (1e-6)».
6. **El solver no tiene límite de tiempo.** En redes difíciles puede tardar varios segundos (hasta 4,4 s en las pruebas) y la pantalla queda bloqueada mientras calcula.
7. **El catálogo de bombas no se conecta con las bombas de la red:** es un almacén de curvas (guardar, buscar, exportar, importar); para usar una hay que copiar sus puntos al campo de curva de la bomba.
8. **Código que no se usa:** `exportPNG` (`js/io/svg.js`), el diálogo genérico `#modal` (sus botones llaman a `closeModal`/`modalOK`, que no existen), y los botones de modo tienen el manejador dos veces (inline y `addEventListener`), de modo que `setMode` corre dos veces por clic (inocuo).
9. **Los `onclick="..."` en línea impiden una política de seguridad estricta** (`Content-Security-Policy` con `script-src 'self'`). Para endurecer más habría que pasarlos a `addEventListener`.
10. **Constantes de criterio por cotejar con normas o catálogos:** curvas K-apertura de válvulas (orientativas, «no son datos de un fabricante»), K de accesorios, espesor por defecto 6 % del diámetro (≈ Sch40/SDR17), módulo de elasticidad del agua 2,1 GPa, velocidad de referencia de 2 m/s del modelo de equipo.

## Licencias de terceros

jsPDF (MIT), jsPDF-AutoTable (MIT), SheetJS Community Edition (Apache-2.0), IBM Plex (SIL OFL 1.1): textos en `libs/`. La licencia del propio código del repositorio está **por definir**.
