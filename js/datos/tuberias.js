// js/datos/tuberias.js
'use strict';
/* Diámetros interiores y espesores normalizados (Acero SCH 40, Acero SCH 80 y Cobre Tipo L), rugosidad y módulo de Young por material. */

// D = diámetro interior [mm]; t = espesor de pared [mm]. Acero ASME B36.10M, Schedule 40: D = OD − 2·t.
const DN_LIST = [
  {label:'DN600 / 24"', D:574.65, t:17.48},{label:'DN500 / 20"', D:477.9, t:15.09},
  {label:'DN450 / 18"', D:428.65, t:14.27},{label:'DN400 / 16"', D:381.0, t:12.70},
  {label:'DN350 / 14"', D:333.35, t:11.13},{label:'DN300 / 12"', D:303.2, t:10.31},
  {label:'DN250 / 10"', D:254.5,  t:9.27}, {label:'DN200 / 8"',  D:202.7, t:8.18},
  {label:'DN150 / 6"',  D:154.1,  t:7.11}, {label:'DN125 / 5"',  D:128.2, t:6.55},
  {label:'DN100 / 4"',  D:102.3,  t:6.02}, {label:'DN80 / 3"',   D:77.9,  t:5.49},
  {label:'DN65 / 2.5"', D:62.7,   t:5.16}, {label:'DN50 / 2"',   D:52.5,  t:3.91},
  {label:'DN40 / 1.5"', D:40.9,   t:3.68}, {label:'DN25 / 1"',   D:26.6,  t:3.38},
  {label:'Personalizado…', D:null}
];

// Series adicionales frecuentes en parciales de Robert Mott y Çengel (ASME B36.10M Schedule 80 y ASTM B88 Cobre Tipo L).
const PIPE_SCHEDULES = {
  SCH40: { label: 'Acero ASME B36.10M — Schedule 40', list: DN_LIST },
  SCH80: {
    label: 'Acero ASME B36.10M — Schedule 80',
    list: [
      {label:'DN300 / 12" Sch80', D:288.9, t:17.48},
      {label:'DN250 / 10" Sch80', D:242.9, t:15.09},
      {label:'DN200 / 8" Sch80',  D:193.7, t:12.70},
      {label:'DN150 / 6" Sch80',  D:146.3, t:10.97},
      {label:'DN125 / 5" Sch80',  D:122.3, t:9.53},
      {label:'DN100 / 4" Sch80',  D:97.2,  t:8.56},
      {label:'DN80 / 3" Sch80',   D:73.7,  t:7.62},
      {label:'DN65 / 2.5" Sch80', D:59.0,  t:7.01},
      {label:'DN50 / 2" Sch80',   D:49.3,  t:5.54},
      {label:'DN40 / 1.5" Sch80', D:38.1,  t:5.08},
      {label:'DN25 / 1" Sch80',   D:24.3,  t:4.55},
      {label:'Personalizado…', D:null}
    ]
  },
  CU_L: {
    label: 'Tubing de Cobre ASTM B88 — Tipo L',
    list: [
      {label:'Cu 4" Tipo L',   D:99.2, t:2.79},
      {label:'Cu 3" Tipo L',   D:74.8, t:2.29},
      {label:'Cu 2" Tipo L',   D:50.4, t:1.78},
      {label:'Cu 1.5" Tipo L', D:38.2, t:1.52},
      {label:'Cu 1" Tipo L',   D:26.0, t:1.27},
      {label:'Cu 3/4" Tipo L', D:19.9, t:1.14},
      {label:'Cu 1/2" Tipo L', D:13.8, t:1.02},
      {label:'Personalizado…', D:null}
    ]
  }
};

// Material de la tubería: rugosidad absoluta ε [mm] y módulo de Young E [Pa]
const MATERIALS = [
  {label:'Acero inoxidable',  eps:0.015,  E:200e9},
  {label:'Acero carbono',     eps:0.046,  E:200e9},
  {label:'Acero galvanizado', eps:0.150,  E:200e9},
  {label:'PVC',               eps:0.0015, E:3e9},
  {label:'HDPE',              eps:0.0015, E:0.8e9},
  {label:'Cobre',             eps:0.0015, E:120e9},
  {label:'Fundición gris',    eps:0.260,  E:170e9},
  {label:'Fundición dúctil',  eps:0.240,  E:165e9},
];

const E_ACERO = 200e9;
