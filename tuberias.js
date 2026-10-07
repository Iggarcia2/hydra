// js/datos/tuberias.js
'use strict';
/* Diámetros interiores y espesores (acero SCH 40), rugosidad y módulo de Young por material. */

// D = diámetro interior [mm]; t = espesor de pared [mm]. Acero ASME B36.10M, Schedule 40: D = OD − 2·t (DN500 quedó en 477,9) con OD = 33,4 / 48,26 / 60,33 / 73,03 / 88,9 / 114,3 / 141,3 / 168,28 / 219,08 / 273,05 / 323,85 / 355,6 / 406,4 / 457,2 / 508 / 609,6.
// [v26] En v25 los interiores de DN350, DN400, DN450 y DN600 no eran de Schedule 40 (el de DN400 daba 428 mm, más que su diámetro exterior de
// 406,4 mm): la pérdida de carga de esos diámetros salía muy por debajo de la real (va con D⁵). Valores corregidos: 333,35 / 381,0 / 428,65 / 574,65.
const DN_LIST = [
  {label:'DN600 / 24"', D:574.65, t:17.48},{label:'DN500 / 20"', D:477.9, t:15.09},
  {label:'DN450 / 18"', D:428.65, t:14.27},{label:'DN400 / 16"', D:381.0, t:12.70},
  {label:'DN350 / 14"', D:333.35, t:11.13},{label:'DN300 / 12"', D:303.2, t:10.31},
  {label:'DN250 / 10"', D:254.5, t:9.27}, {label:'DN200 / 8"',  D:202.7, t:8.18},
  {label:'DN150 / 6"',  D:154.1, t:7.11}, {label:'DN125 / 5"',  D:128.2, t:6.55},
  {label:'DN100 / 4"',  D:102.3, t:6.02}, {label:'DN80 / 3"',   D:77.9,  t:5.49},
  {label:'DN65 / 2.5"', D:62.7,  t:5.16}, {label:'DN50 / 2"',   D:52.5,  t:3.91},
  {label:'DN40 / 1.5"', D:40.9,  t:3.68}, {label:'DN25 / 1"',   D:26.6,  t:3.38},
  {label:'Personalizado…', D:null}
];

// Material de la tubería: rugosidad absoluta ε [mm] y módulo de Young E [Pa] (este último solo interviene en el golpe de ariete).
// [v26] E va con cada material. En v25 vivía en otra tabla (E_YOUNG) con claves que no coincidían con estos nombres, así que todo
// material usaba el módulo del acero; además «PVC / HDPE» juntaba dos materiales con módulos 4 veces distintos (3 y 0,8 GPa).
const MATERIALS = [
  {label:'Acero inoxidable',  eps:0.015,  E:200e9},
  {label:'Acero carbono',     eps:0.046,  E:200e9},
  {label:'Acero galvanizado', eps:0.150,  E:200e9},
  {label:'PVC',               eps:0.0015, E:3e9},
  {label:'HDPE',              eps:0.0015, E:0.8e9},
  {label:'Cobre',             eps:0.0015, E:120e9},
  {label:'Fundición gris',    eps:0.260,  E:170e9},
];
// Módulo de Young que se usa cuando el material del tramo no se puede determinar (acero: del lado conservador, da la mayor sobrepresión).
const E_ACERO = 200e9;
