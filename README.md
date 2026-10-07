# Hydra — calculadora de redes hidráulicas

Editor en pantalla y solver de redes de tuberías: tanques, nodos con demanda, tuberías, bombas (curva H-Q, caudal fijo o presión fija), válvulas, equipos y retenciones. Calcula cargas, presiones, caudales, velocidades y pérdidas con Newton-Raphson (Jacobiano analítico, búsqueda de línea y continuación adaptativa) y fricción de Colebrook-White / Hagen-Poiseuille; arma la curva del sistema de cada bomba, el golpe de ariete (Joukowsky), la lista de materiales, y exporta memoria de cálculo en PDF, planilla Excel y proyecto en JSON.

Es un **sitio estático**: no hay servidor, ni compilación, ni internet en uso (las librerías y tipografías están en `libs/`). Se puede abrir con doble clic en `index.html` o publicar tal cual en GitHub Pages.

Versión de la aplicación: **v26**. Versión del repositorio: **1.1.0**. La 1.0.0 fue la v25 pasada a sitio estático sin tocar ningún cálculo; la 1.1.0 corrige el motor para que los valores sean realistas (ver «Cambios de cálculo en v26»).

## Estructura

```
index.html            marcado de la pantalla y ORDEN DE CARGA de los scripts (única lista; los tests la leen de acá)
css/estilos.css       estilos
js/
  guarda.js           primer script: avisa en pantalla si falta un archivo, una librería o los estilos, o si algo falla al arrancar
  datos/              constantes y tablas: gravedad, agua (ρ, ν por temperatura), diámetros y rugosidades, accesorios y curvas K-apertura
  nucleo/             MOTOR DE CÁLCULO, sin DOM ni estado global: fricción, accesorios, materiales, bombas, álgebra, solver, curva del sistema,
                      ariete, aplicación de resultados y validación de archivos importados
  estado.js           estado de la aplicación (red, fluido, deshacer/rehacer) y fábricas de nodos y arcos
  ui/                 pantalla: lienzo SVG, propiedades, listas, resultados, gráfico H-Q, botón Calcular, eventos
  io/                 exportar PDF / Excel / PNG, guardar y abrir proyecto, catálogo de bombas
  arranque.js         último script: red de ejemplo y marca «lista»
libs/                 jsPDF, jsPDF-AutoTable, SheetJS y tipografías IBM Plex (con licencias y huellas en libs/VERSIONES.md)
versiones/            hydra_v25.html: el archivo único original, sin tocar (la v26 es `index.html` con `js/` y `css/`)
tests/                unitarias, contraste con Python, prueba de pantalla y comparación con v25
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

**Versiones nuevas.** Antes de cambiar la aplicación, copiá el estado actual a `versiones/` con su número y marcá el commit con una etiqueta (`git tag v27`). El archivo principal conserva su nombre (`index.html`).

## Verificación

```
node tests/correr_todo.js                 unitarias del motor + contraste con Python
node tests/correr_todo.js --e2e           + prueba de pantalla (Chromium)
node tests/correr_todo.js --equivalencia  + comparación con v25 (motor y pantalla)
node tests/correr_todo.js --todo          todo (varios minutos)
```

Requisitos: Node 18 o más; para la pantalla, `npm install` (instala Playwright; después `npx playwright install chromium` si el navegador no está); para el contraste, Python 3 con `numpy` y `scipy`. Si falta algo, el paso se informa como **FALLA** (nada se omite en silencio).

| Prueba | Qué comprueba | Resultado |
|---|---|---|
| `tests/unit/test_nucleo.js` | Motor sin pantalla (carga en un contexto vacío): utilidades, propiedades del agua, fricción (laminar, transición, Colebrook), accesorios, materiales, bombas, álgebra, golpe de ariete, solver contra soluciones analíticas (bisección), entradas inválidas, nodos sin salida, bombas sin caudal o con caudal inverso y 40 redes aleatorias con balance de masa | 69 correctas, 0 con error |
| `tests/ref/` (`gen_casos.js` + `ref.py`) | 75 redes (a mano y aleatorias; 74 las resuelve el motor, la otra da el error explícito de bomba con caudal inverso) contra una implementación independiente en Python (numpy/scipy, tablas reescritas aparte): residuo de las ecuaciones independientes en la solución del motor y solución obtenida desde cero | 74 comparadas. Turbulentas: carga ≤ 1,04e-8 m, caudal ≤ 2,75e-9 (relativo). Transición (6): carga ≤ 1,25e-9 m. Laminares (7): carga ≤ 1,73e-10 m |
| `tests/e2e/pantalla.js` | Carga limpia por http y por `file://` sin pedir nada a internet; aviso de carga con el sitio roto a propósito; archivos de proyecto y catálogo hostiles (contra v25); textos extremos; exportar PDF y Excel; material, diámetro nominal y resultados (v26) | 24 correctas, 0 con error |
| `tests/equivalencia/motor.js` | 150 redes aleatorias (semilla fija) en v25 y en el repo, en tres niveles: **exacto** en lo que la v26 no tocó (K de accesorios, bombas, agua, ariete), **con tolerancia** en el solver (tolerancia 1e-9 en las dos) y `pipeCalc()` suelto en turbulento | 429 comparaciones exactas y 2.927 de `pipeCalc()`, 0 diferencias; solver: 59 redes comparadas (peor diferencia 4,2e-7 m de carga y 1,9e-7 relativo de caudal), 9 con tramos Re < 4000 aparte, 34 redes que ahora resuelve el motor nuevo y v25 no, 0 que v25 resolvía y el nuevo no (7 redes se descartan por tardar más de 4 s en v25) |
| `tests/equivalencia/pantalla.js` | Recorrido de 106 pasos en v25 y en el repo con **todo número enmascarado**: estructura del HTML, campos, estado, diálogos, archivos descargados y capturas | 749 comparaciones, 0 diferencias; capturas: 2 idénticas byte a byte y 5 con cifras distintas (como mucho 0,69 % de píxeles); consola sin avisos ni errores en ambas |

**Qué compara la equivalencia con v25 desde la v26.** Hasta la 1.0.0 comparaba de forma exacta cada número; desde la v26 el cálculo cambió a propósito, así que la prueba se partió en dos. *Motor:* en lo que no se tocó (accesorios, bombas, agua, tabla de ariete salvo la columna nueva «Material») sigue siendo comparación exacta, y el solver se compara con una tolerancia fina en el dominio donde v25 era correcto; quedan fuera, y se cuentan aparte, las redes con tramos laminares o de transición (la ley de fricción cambió) y los caudales que v25 informaba mal en retenciones contra la corriente. También se exige que el motor nuevo resuelva **todo lo que resolvía v25** (y se cuenta lo que ahora resuelve de más). *Pantalla:* se enmascaran los números y se comparan las estructuras; las diferencias esperadas (material en el panel, columna «Material», diámetros SCH 40, etc.) están listadas una por una en el propio test con su motivo, y cualquier otra cuenta como diferencia. Las capturas se comparan píxel a píxel con un umbral de 5 % de píxeles distintos (el contenido numérico cambia).

## Cambios de cálculo en v26

Pedido: que los valores sean realistas. Cada cambio tiene su prueba en `tests/unit/test_nucleo.js` y el resultado completo se contrasta con la implementación independiente en Python. Lo que v25 distorsionaba, de mayor a menor efecto sobre los números:

1. **Criterio de convergencia.** v25 se detenía cuando el residuo de cada nodo era menor que la tolerancia **en m³/s absolutos**; con la tolerancia por defecto (1e-4 m³/s = 0,36 m³/h) los caudales chicos quedaban con errores del 10–20 % (dos tramos en serie daban 0,09 y 0,21 m³/h; un nodo sin salida recibía 0,35 m³/h «fantasma»). Ahora el error de cada nodo es **relativo** al caudal que circula por él (`|F| / (Σ|Q| + 1e-8 m³/s)`). En la red de ejemplo la carga en J1 pasa de 9,756 m (v25) a 9,761 m.
2. **Fricción continua.** v25 pasaba de 64/Re a Colebrook de golpe en Re = 2300 (con ε/D = 0,0005, f saltaba de 0,0278 a 0,0477, un 72 % más) y entre 2300 y 4000 el caudal podía no tener solución única. Ahora: 64/Re hasta 2300, interpolación lineal en Re entre 64/2300 y Colebrook(4000) en la zona de transición, y Colebrook-White desde 4000. *La zona de transición no tiene una ley única: la interpolación es una convención para que el resultado sea continuo y único, no una medición.*
3. **Flujo laminar exacto.** v25 iteraba 12 veces la fricción (≈ 0,1 % de error respecto de Hagen-Poiseuille) y usaba en el Jacobiano la conductancia turbulenta (`Q/2ΔH`), por lo que con fluidos viscosos (≥ 100 cSt) Newton oscilaba y no convergía. Ahora el caudal laminar sale de la fórmula cerrada (`hf = b·V + a·V²`) y el Jacobiano usa la derivada exacta en laminar y transición.
4. **Rugosidad ε = 0 respetada.** v25 tomaba un 0 (tubo liso) como «falta el dato» y usaba acero (0,046 mm). Ahora un 0 explícito es un tubo liso; el valor por defecto solo se usa cuando el tramo no trae rugosidad. Una rugosidad o un sarro negativos se toman como 0.
5. **Diámetros interiores SCH 40.** v25 tenía mal DN350, DN400, DN450 y DN600 (DN400: 428 mm de interior, más que su diámetro exterior; correcto: 381 mm). Se rehicieron con los diámetros exteriores de ASME B36.10M (D = OD − 2·t; fuente: archtoolbox.com, tabla ASME B36.10M). El espesor de pared ahora sigue al diámetro nominal elegido.
6. **Material y golpe de ariete.** v25 buscaba el módulo de Young con una clave que no existía en la tabla, así que todo material usaba 200 GPa (acero): en PVC o HDPE la celeridad y la sobrepresión salían muy sobreestimadas. Ahora cada material trae su módulo (acero 200 GPa, fundición gris 170, cobre 120, PVC 3, HDPE 0,8) y **PVC y HDPE son dos materiales** (v25 los juntaba con módulos 4 veces distintos). El material se guarda en el tramo; un proyecto de v25 (sin material) lo deduce de la rugosidad y, si no se puede saber cuál es, usa acero (del lado conservador). Aparece en el panel, la lista de materiales, el PDF, el Excel y la tabla de ariete.
7. **Retención contra la corriente.** El solver ya la bloqueaba, pero v25 informaba en la tabla el caudal inverso que habría sin retención (hasta −90 m³/h) y el balance de masa no cerraba. Ahora informa 0.

Redes que v25 no resolvía o resolvía mal:

- **Nodos sin salida** (una derivación tapada, una retención cerrada, una bomba que alimenta un nodo sin consumo): v25 declaraba «Sistema singular» porque la conductancia de un tramo sin diferencia de carga valía 0. Ahora vale su límite laminar (o un piso chico si no hay fricción) y una retención cerrada sigue teniendo una conductancia mínima para el Jacobiano (el caudal informado es 0).
- **Búsqueda de línea más exigente:** el paso de Newton se acepta solo si el residuo baja un 10 % (v25 aceptaba cualquier mejora, por mínima que fuera). Elimina los ciclos de dos iteraciones con tramos muy estrangulados y el caudal fantasma hacia nodos sin salida.
- **Bombas:** la pendiente de la curva de bomba (`pumpHeadDeriv`) daba ~20 veces menos de lo real con caudales menores a 0,5 m³/h (la diferencia central cruzaba el cero), y el Jacobiano ignoraba el signo del caudal (la carga usa |Q|). Con una bomba cerrada contra una retención, Newton no cerraba. Además, una **bomba que no alcanza a vencer al tanque de salida** admite una solución matemática con el agua atravesando la bomba al revés; ahora el solver lo informa como error («Caudal inverso en la bomba …: agregá una retención en serie») en vez de mostrar esos caudales.
- **Curva del sistema:** ya no se vacía por un nodo aislado (sin ningún tramo) en la red.
- **Rugosidad, sarro o longitud negativos:** el panel los rechaza (vuelve al valor anterior; una longitud negativa bloqueaba el tramo en silencio), al abrir un proyecto se corrigen (rugosidad → valor por defecto, sarro → 0) y el motor los toma como 0.

Efecto medido sobre redes aleatorias (300 redes, configuración por defecto de la pantalla: tolerancia 1e-4 y 100 iteraciones): **el motor nuevo resuelve 198 y v25 144** (55 solo el nuevo; 143 las dos). La única red que v25 daba por resuelta y el motor nuevo no es una con una bomba a contraflujo: v25 informaba −238 m³/h por la bomba como resultado válido y ahora es el error explícito. Las otras 101 no las resuelve ninguna de las dos (el generador arma redes extremas a propósito).

## Cambios de la 1.0.0 (seguridad, sitio y carga)

En la 1.0.0 el cálculo no cambió (la equivalencia con v25 era exacta). Lo que cambió, a propósito:

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

## Hallazgos que siguen sin corregirse

Los cinco primeros hallazgos de v25 (retención, módulo de Young, fluidos viscosos, fricción en transición y dependencia de la tolerancia) se corrigieron en la v26 (ver arriba). Quedan estos; para decidir con criterio de ingeniería, no de código:

1. **Curvas K-apertura de las válvulas de compuerta y de esfera, por cotejar.** Son «orientativas» (así lo dice el código) y difieren mucho de los valores publicados. Referencia usada para comparar: la tabla de coeficientes de pérdidas menores de [Engineering ToolBox](https://engineeringtoolbox.com/minor-loss-coefficients-pipes-d_626.html) (valores de texto de mecánica de fluidos), con la apertura como 100 % − fracción cerrada:

   | Válvula y apertura | Publicado (K) | Hydra (K) | Relación |
   |---|---|---|---|
   | Compuerta 100 % | 0,15 | 0,20 | ×1,3 |
   | Compuerta 75 % | 0,26 | 2 | ×8 |
   | Compuerta 50 % | 2,1 | 17 | ×8 |
   | Compuerta 25 % | 17 | 185 | ×11 |
   | Esfera 100 % | 0,05 | 0,05 | igual |
   | Esfera 67 % | 5,5 | 0,31 | ÷18 |
   | Esfera 33 % | 200 | 10,5 | ÷19 |
   | Globo 100 % | 10 | 10 | igual |

   La compuerta estrangulada pierde de más y la esfera estrangulada de menos; abiertas del todo coinciden. **No se cambiaron**: son datos de un criterio (qué referencia o curva de fabricante adoptar), no un error de cálculo. Mariposa 100 % (0,35) es un valor de válvulas grandes; en DN100 ronda 0,8. Con una válvula parcialmente cerrada conviene cargar el K de catálogo del fabricante en «K adicional».
2. **Redes con diferencias de carga muy chicas** (menos de unos 5 cm entre tanques): Newton oscila desde la semilla inicial y el solver informa «No convergió» (falla a la vista, no un resultado falso). Pasaba igual en v25.
3. **El modelo de bomba usa |Q|.** La carga de una bomba se calcula con el caudal absoluto; una bomba que no puede vencer el desnivel se informa como error (ver arriba) y no se modela su comportamiento como turbina o con fuga inversa. Para bloquear el retorno, poné una retención en serie.
4. **El solver no tiene límite de tiempo.** En redes difíciles puede tardar varios segundos (hasta 4,4 s en las pruebas) y la pantalla queda bloqueada mientras calcula.
5. **El catálogo de bombas no se conecta con las bombas de la red:** es un almacén de curvas (guardar, buscar, exportar, importar); para usar una hay que copiar sus puntos al campo de curva de la bomba.
6. **Código que no se usa:** `exportPNG` (`js/io/svg.js`), el diálogo genérico `#modal` (sus botones llaman a `closeModal`/`modalOK`, que no existen), y los botones de modo tienen el manejador dos veces (inline y `addEventListener`), de modo que `setMode` corre dos veces por clic (inocuo).
7. **Los `onclick="..."` en línea impiden una política de seguridad estricta** (`Content-Security-Policy` con `script-src 'self'`). Para endurecer más habría que pasarlos a `addEventListener`.
8. **Otras constantes de criterio por cotejar:** K de accesorios, espesor por defecto 6 % del diámetro (≈ Sch40/SDR17) cuando no se elige diámetro nominal, módulo de elasticidad del agua 2,1 GPa, módulo de la fundición gris 170 GPa (extremo alto del rango 100–170), velocidad de referencia de 2 m/s del modelo de equipo.

## Licencias de terceros

jsPDF (MIT), jsPDF-AutoTable (MIT), SheetJS Community Edition (Apache-2.0), IBM Plex (SIL OFL 1.1): textos en `libs/`. La licencia del propio código del repositorio está **por definir**.
