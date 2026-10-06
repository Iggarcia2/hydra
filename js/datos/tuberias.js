// js/datos/tuberias.js
'use strict';
/* Diámetros interiores (SCH 40), rugosidades por material y módulo de Young por material. */

const DN_LIST = [
  {label:'DN600 / 24"', D:603.225},{label:'DN500 / 20"', D:477.9},
  {label:'DN450 / 18"', D:454.025},{label:'DN400 / 16"', D:428.0},
  {label:'DN350 / 14"', D:347.7}, {label:'DN300 / 12"', D:303.2},
  {label:'DN250 / 10"', D:254.5}, {label:'DN200 / 8"',  D:202.7},
  {label:'DN150 / 6"',  D:154.1}, {label:'DN125 / 5"',  D:128.2},
  {label:'DN100 / 4"',  D:102.3}, {label:'DN80 / 3"',   D:77.9},
  {label:'DN65 / 2.5"', D:62.7},  {label:'DN50 / 2"',   D:52.5},
  {label:'DN40 / 1.5"', D:40.9},  {label:'DN25 / 1"',   D:26.6},
  {label:'Personalizado…', D:null}
];

const MATERIALS = [
  {label:'Acero inoxidable',  eps:0.015 },
  {label:'Acero carbono',     eps:0.046 },
  {label:'Acero galvanizado', eps:0.150 },
  {label:'PVC / HDPE',        eps:0.0015},
  {label:'Cobre',             eps:0.0015},
  {label:'Fundición gris',    eps:0.260 },
];

// Módulo de Young por material [Pa]  (usa el mismo key que MATERIALS)
const E_YOUNG = {
  'Acero'        : 200e9,
  'Hierro fund.' : 170e9,
  'PVC'          :   3e9,
  'HDPE'         :   0.8e9,
  'Cobre'        : 120e9,
  'Concreto'     :  30e9,
};
