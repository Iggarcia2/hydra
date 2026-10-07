// js/datos/agua.js
'use strict';
/* Propiedades del agua: tabla densidad/viscosidad cinemática por temperatura y módulo de elasticidad volumétrica. */

const WATER_TABLE = [
  [5,999.9,1.518e-6],[10,999.7,1.307e-6],[15,999.1,1.138e-6],[20,998.2,1.004e-6],
  [25,997.0,0.893e-6],[30,995.7,0.801e-6],[40,992.2,0.658e-6],[50,988.1,0.553e-6],
  [60,983.2,0.475e-6],[70,977.8,0.414e-6],[80,971.8,0.365e-6],[90,965.3,0.326e-6]
];

// Módulo de elasticidad volumétrica del fluido [Pa]
const K_WATER = 2.1e9;  // agua a 20°C
