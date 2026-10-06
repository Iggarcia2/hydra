// js/datos/accesorios.js
'use strict';
/* Accesorios (K), curvas K-vs-apertura de válvulas y nombres de tipos de válvula. */

const FITTINGS = [
  {name:'Codo 90° estándar',    k:0.90},{name:'Codo 90° radio largo',k:0.45},
  {name:'Codo 45°',             k:0.40},{name:'Tee — paso directo',  k:0.30},
  {name:'Tee — ramal lateral',  k:1.00},{name:'Válvula compuerta',   k:0.20, curve:'gate'},
  {name:'Válvula esfera',       k:0.05, curve:'ball'},{name:'Válvula mariposa',    k:0.35, curve:'butterfly'},
  {name:'Válvula globo',        k:10.0, curve:'globe'},{name:'Válvula retención',   k:2.00},
  {name:'Filtro / colador',     k:5.00},{name:'Entrada de tanque',   k:0.50},
  {name:'Reductor gradual',     k:0.10},{name:'Expansión gradual',   k:0.20}
];

// [v13] Curvas típicas K vs % apertura para válvulas manuales (gate/ball/butterfly/globe).
// Son valores de referencia orientativos según el comportamiento típico documentado por familia
// de válvula (gate/ball son "quick opening": K se dispara por debajo del 30-40% de apertura;
// globe tiene la curva más gradual por estar diseñada para estrangulamiento). NO son datos de
// un fabricante específico — calibrar con la curva Cv real si se requiere precisión de proyecto.
// Formato: [ [%apertura, K], ... ] de 100% a 10%. 0% (cerrada) siempre bloquea el tramo (K=∞).
const VALVE_OPENING_CURVES = {
  gate:      [[100,0.20],[90,0.40],[75,2],   [50,17], [35,70],[20,300],[10,900]],
  ball:      [[100,0.05],[90,0.08],[75,0.15],[50,1.5],[35,8], [20,60], [10,400]],
  butterfly: [[100,0.35],[90,0.65],[75,2.5], [50,11], [35,40],[20,160],[10,750]],
  globe:     [[100,10],  [90,13],  [75,20],  [50,45], [35,90],[20,220],[10,500]],
};

// [v21] Nombres en espanol de los tipos de valvula -- se usan tanto en el dropdown "Tipo" del
// elemento Valvula dedicado como en la tabla de accesorios del PDF. Las claves coinciden con las
// que ya usa VALVE_OPENING_CURVES / FITTINGS (curve:'gate' etc.) -- una sola fuente de nombres,
// para no repetir la traduccion en dos lugares.
const VALVE_TYPE_LABELS = {
  check: 'Retención', gate: 'Compuerta', ball: 'Esfera', butterfly: 'Mariposa', globe: 'Globo'
};
