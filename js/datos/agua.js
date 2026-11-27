// js/datos/agua.js
'use strict';
/* Propiedades del agua (0–100 °C con presión de vapor) y biblioteca de fluidos canónicos de bibliografía universitaria
   (Robert L. Mott Apéndices A–B, Yunus A. Çengel Tablas A-3/A-9, Frank M. White Tablas A.1/A.3). */

// Formato: [T (°C), rho (kg/m³), nu (m²/s), Pv (Pa)]
const WATER_TABLE = [
  [0,   999.8, 1.787e-6,   611],
  [4,  1000.0, 1.567e-6,   813],
  [5,   999.9, 1.518e-6,   872],
  [10,  999.7, 1.307e-6,  1228],
  [15,  999.1, 1.138e-6,  1705],
  [20,  998.2, 1.004e-6,  2339],
  [25,  997.0, 0.893e-6,  3169],
  [30,  995.7, 0.801e-6,  4246],
  [40,  992.2, 0.658e-6,  7384],
  [50,  988.1, 0.553e-6, 12350],
  [60,  983.2, 0.475e-6, 19940],
  [70,  977.8, 0.414e-6, 31190],
  [80,  971.8, 0.365e-6, 47390],
  [90,  965.3, 0.326e-6, 70140],
  [100, 958.4, 0.294e-6,101325]
];

// Módulo de elasticidad volumétrica por defecto del agua a 20 °C [Pa]
const K_WATER = 2.1e9;

// Biblioteca de fluidos estándar frecuentes en parciales y ejercicios de libros de texto.
// Cada entrada almacena ρ [kg/m³], μ [Pa·s], ν = μ/ρ [m²/s], Pv [Pa] y módulo volumétrico K [Pa].
const FLUID_PRESETS = [
  {id:'water_4c',     group:'Aguas de referencia', label:'Agua a 4 °C (SG = 1.000 · Mott Ap. A)',       rho:1000.0, mu:1.567e-3,  nu:1.567e-6,     pv_pa:813,   bulk_pa:2.05e9},
  {id:'seawater_20c', group:'Aguas de referencia', label:'Agua de mar 3.5% a 20 °C (White Tab. A.3)',   rho:1025.0, mu:1.070e-3,  nu:1.043902e-6,  pv_pa:2290,  bulk_pa:2.34e9},
  {id:'gasoline_20c', group:'Hidrocarburos',       label:'Gasolina / Nafta a 20 °C (White Tab. A.3)',   rho:680.0,  mu:2.920e-4,  nu:4.294118e-7,  pv_pa:55000, bulk_pa:1.30e9},
  {id:'kerosene_20c', group:'Hidrocarburos',       label:'Queroseno a 20 °C (White Tab. A.3)',          rho:804.0,  mu:1.920e-3,  nu:2.388060e-6,  pv_pa:3100,  bulk_pa:1.60e9},
  {id:'kerosene_25c', group:'Hidrocarburos',       label:'Queroseno a 25 °C (Mott Ap. B)',              rho:823.0,  mu:1.640e-3,  nu:1.992710e-6,  pv_pa:3500,  bulk_pa:1.60e9},
  {id:'crude_20c',    group:'Hidrocarburos',       label:'Petróleo crudo medio a 20 °C (White Tab. A.3)',rho:856.0, mu:7.200e-3,  nu:8.411215e-6,  pv_pa:12000, bulk_pa:1.50e9},
  {id:'methanol_25c', group:'Alcoholes y químicos',label:'Alcohol metílico a 25 °C (Mott Ej. 11.1)',    rho:789.0,  mu:5.600e-4,  nu:7.097592e-7,  pv_pa:16900, bulk_pa:0.83e9},
  {id:'ethanol_25c',  group:'Alcoholes y químicos',label:'Alcohol etílico a 25 °C (Mott Ap. B)',        rho:787.0,  mu:1.000e-3,  nu:1.270648e-6,  pv_pa:7870,  bulk_pa:0.90e9},
  {id:'benzene_25c',  group:'Alcoholes y químicos',label:'Benceno a 25 °C (Mott Ap. B)',                rho:876.0,  mu:6.030e-4,  nu:6.883562e-7,  pv_pa:12700, bulk_pa:1.05e9},
  {id:'ccl4_25c',     group:'Alcoholes y químicos',label:'Tetracloruro de carbono a 25 °C (Mott Ap. B)',rho:1590.0, mu:9.100e-4,  nu:5.723270e-7,  pv_pa:15200, bulk_pa:1.10e9},
  {id:'glycol_20c',   group:'Glicoles y aceites',  label:'Etilenglicol puro a 20 °C (White Tab. A.3)',  rho:1117.0, mu:2.140e-2,  nu:1.915846e-5,  pv_pa:12,    bulk_pa:2.70e9},
  {id:'glycol_25c',   group:'Glicoles y aceites',  label:'Etilenglicol puro a 25 °C (Mott Ap. B)',      rho:1100.0, mu:1.620e-2,  nu:1.472727e-5,  pv_pa:16,    bulk_pa:2.70e9},
  {id:'sae10w_20c',   group:'Glicoles y aceites',  label:'Aceite SAE 10W a 20 °C (White Tab. A.3)',     rho:870.0,  mu:0.104,     nu:1.195402e-4,  pv_pa:1,     bulk_pa:1.50e9},
  {id:'sae30_20c',    group:'Glicoles y aceites',  label:'Aceite SAE 30 a 20 °C (White Tab. A.3)',      rho:891.0,  mu:0.290,     nu:3.254770e-4,  pv_pa:1,     bulk_pa:1.50e9},
  {id:'oil_cengel',   group:'Glicoles y aceites',  label:'Aceite pesado a 20 °C (Çengel Ej. 8-1)',      rho:888.0,  mu:0.800,     nu:9.009009e-4,  pv_pa:1,     bulk_pa:1.50e9},
  {id:'mil5606_40c',  group:'Glicoles y aceites',  label:'Fluido hidráulico MIL-H-5606 a 40 °C (Mott)', rho:845.0,  mu:8.450e-3,  nu:1.000000e-5,  pv_pa:10,    bulk_pa:1.65e9},
  {id:'glycerin_20c', group:'Fluidos especiales',  label:'Glicerina a 20 °C (White Tab. A.3)',          rho:1260.0, mu:1.490,     nu:1.182540e-3,  pv_pa:1,     bulk_pa:4.35e9},
  {id:'glycerin_40c', group:'Fluidos especiales',  label:'Glicerina a 40 °C (Çengel Tab. A-3)',         rho:1252.0, mu:0.3073,    nu:2.454473e-4,  pv_pa:1,     bulk_pa:4.30e9},
  {id:'mercury_20c',  group:'Fluidos especiales',  label:'Mercurio a 20 °C (White Tab. A.3)',           rho:13550.0,mu:1.530e-3,  nu:1.129151e-7,  pv_pa:0.16,  bulk_pa:2.50e10}
];
