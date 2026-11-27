// js/datos/accesorios.js
'use strict';
/* Accesorios según Crane TP 410 / Robert L. Mott (K = LeD · fT(D) o K geométrico fijo),
   curvas calibradas K-vs-apertura de válvulas y nombres de tipos de válvula. */

// Los primeros 14 elementos conservan su posición histórica para compatibilidad exacta con archivos JSON de v25/v26.
// Si el accesorio define `LeD`, en modo Crane TP 410 (por defecto en v27) su coeficiente es K = LeD · fT(D_mm),
// donde fT es el factor de fricción en turbulencia completa de acero comercial limpio para ese diámetro.
// `k` se conserva como valor clásico orientativo para proyectos heredados que fijen `arc.kMethod = 'fixed'`.
const FITTINGS = [
  {name:'Codo 90° estándar',    k:0.90, LeD:30},
  {name:'Codo 90° radio largo', k:0.45, LeD:20},
  {name:'Codo 45°',             k:0.40, LeD:16},
  {name:'Tee — paso directo',   k:0.30, LeD:20},
  {name:'Tee — ramal lateral',  k:1.00, LeD:60},
  {name:'Válvula compuerta',    k:0.20, LeD:8,   curve:'gate'},
  {name:'Válvula esfera',       k:0.05, LeD:3,   curve:'ball'},
  {name:'Válvula mariposa',     k:0.35, LeD:40,  curve:'butterfly'},
  {name:'Válvula globo',        k:10.0, LeD:340, curve:'globe'},
  {name:'Válvula retención',    k:2.00, LeD:100},
  {name:'Filtro / colador',     k:5.00},
  {name:'Entrada de tanque',    k:0.50},
  {name:'Reductor gradual',     k:0.10},
  {name:'Expansión gradual',    k:0.20},
  {name:'Salida a tanque',      k:1.00},
  {name:'Entrada abocinada',    k:0.04}
];

// [v27] Curvas calibradas K vs % de apertura basadas en bibliografía publicada (Crane TP 410 / Mott Tabla 10.4 / White / Engineering ToolBox)
// para diámetro de referencia DN80–DN100 (fT_ref ≈ 0.017). Cuando el accesorio opera en modo Crane TP 410 y está 100 % abierto usa LeD·fT(D);
// a apertura parcial escala el factor relativo de estrangulamiento K(pct)/K(100%) sobre el K abierto real LeD·fT(D) del diámetro elegido.
// Compuerta (Mott Tabla 10.4): Le/D = 8 (100%), 35 (75%), 160 (50%), 900 (25%) -> K_ref ≈ 0.15, 0.60, 2.7, 15.3.
// Esfera (publicado): 100% -> 0.05, 67% -> 5.5, 33% -> 200.
const VALVE_OPENING_CURVES = {
  gate:      [[100,0.15],[90,0.28],[75,0.60],[50,2.70],[35,7.50],[25,15.3],[10,120]],
  ball:      [[100,0.05],[90,0.15],[75,1.20],[67,5.50],[50,17.0],[33,200], [10,950]],
  butterfly: [[100,0.68],[90,1.10],[75,3.30],[50,14.0],[35,48.0],[20,185], [10,750]],
  globe:     [[100,5.80],[90,7.50],[75,11.5],[50,25.0],[35,52.0],[20,130], [10,320]],
};

// Le/D abierto de referencia en Crane TP 410 para cada familia de válvula con curva
const VALVE_CRANE_LED = {
  gate: 8,
  ball: 3,
  butterfly: 40,
  globe: 340
};

const VALVE_TYPE_LABELS = {
  check: 'Retención', gate: 'Compuerta', ball: 'Esfera', butterfly: 'Mariposa', globe: 'Globo'
};
