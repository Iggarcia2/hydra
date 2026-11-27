// js/nucleo/fluido.js
'use strict';
/* Propiedades del agua por interpolación (ρ, ν y presión de vapor Pv) y búsqueda de fluidos de bibliografía. */

function _interpWaterCol(T, colIdx) {
  if (!Number.isFinite(T)) throw new Error('getWaterProps: la temperatura tiene que ser un número finito');
  const t = WATER_TABLE;
  if (T <= t[0][0]) return t[0][colIdx];
  if (T >= t[t.length - 1][0]) return t[t.length - 1][colIdx];
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i][0] <= T && T <= t[i + 1][0]) {
      const f = (T - t[i][0]) / (t[i + 1][0] - t[i][0]);
      return t[i][colIdx] + f * (t[i + 1][colIdx] - t[i][colIdx]);
    }
  }
  return t[0][colIdx];
}

// Devuelve [rho (kg/m³), nu (m²/s)] — firma idéntica a v26 para compatibilidad total.
function getWaterProps(T) {
  return [_interpWaterCol(T, 1), _interpWaterCol(T, 2)];
}

// Presión de vapor saturado del agua [Pa] a temperatura T [°C] (para verificación de cavitación y NPSHa).
function getWaterVaporPressurePa(T) {
  return _interpWaterCol(T, 3);
}

// Obtiene un fluido predefinido de la biblioteca de parciales por su id, o null si no existe.
function getFluidPreset(id) {
  if (!id || typeof FLUID_PRESETS === 'undefined') return null;
  return FLUID_PRESETS.find(f => f.id === id) || null;
}
