// js/ui/calculo.js
'use strict';
/* Botón Calcular: lee las opciones de pantalla, llama al motor, aplica los resultados y redibuja. */

function runSolver() {
  setSolverStatus('idle', 'Calculando…');
  // [v19 FIX] Antes, solveNetwork() (que puede tardar de milisegundos a varios segundos si el
  // objetivo pedido está lejos del punto de operación conocido) arrancaba en la misma tarea de
  // JS que acababa de pintar "Calculando…" — el navegador nunca llega a pintar ese cartel antes
  // de quedar bloqueado, así que la pantalla se ve exactamente igual (sin ningún mensaje nuevo)
  // durante todo el cálculo. Para el usuario eso es indistinguible de "no converge". El
  // setTimeout(...,10) cede el control al navegador un instante para que SÍ pinte el cartel
  // antes de arrancar el cálculo pesado. No cambia el resultado ni le pone límite de tiempo al
  // cálculo — sigue corriendo hasta terminar, ahora con aviso visible mientras tanto.
  setTimeout(_runSolverHeavy, 10);
}
// [repo] Tolerancia e iteraciones máximas que el usuario tipeó en el panel de Fluido (el motor aplica los valores por defecto si no son números).
function leerOpcionesSolver() {
  return {
    tol:     document.getElementById('solver-tol').value,
    maxIter: document.getElementById('solver-maxiter').value,
  };
}
function _runSolverHeavy() {
  try {
    const red = redActual();
    const result = solveNetwork(red, leerOpcionesSolver());
    state.results = result;
    if (result.ok) {
      aplicarResultados(state.nodes, state.arcs, result);
      // Validar roles de tanques
      const roleWarnings = advertenciasRolTanque(state.nodes, state.arcs);
      if (roleWarnings.length)
        setSolverStatus('err', result.msg + ' · ROL ⚠ ' + roleWarnings.join('; '));
      else
        setSolverStatus('ok', result.msg);
      // [v18] Curva de sistema por bomba, calculada una sola vez acá (no en cada redibujado
      // del gráfico) — misma curva rigurosa para pantalla y PDF, en los tres modos de bomba.
      _sysCurveCache = {};
      for (const a of state.arcs) {
        if (a.type === 'pump') _sysCurveCache[a.id] = computeSystemCurve(red, a);
      }
    } else {
      // [FIX] limpiar resultados obsoletos para no mostrar valores previos como válidos
      limpiarResultados(state.nodes, state.arcs);
      setSolverStatus('err', result.msg);
      _sysCurveCache = {};
    }
  } catch(e) {
    setSolverStatus('err', 'Error en solver: ' + e.message);
  }
  renderNetwork();
  renderResults();
  renderSidebarLists();
}

function setSolverStatus(type, msg) {
  const el = document.getElementById('solver-status');
  el.className = 'solver-status ' + type;
  el.textContent = msg;
}
