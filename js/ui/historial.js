// js/ui/historial.js
'use strict';
/* Deshacer / rehacer: aplica las instantáneas de js/estado.js y redibuja. */

function pushUndo() {
  _undoStack.push(_snap());
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  _redoStack.length = 0;
  _updateUndoBtns();
}

function undo() {
  if (!_undoStack.length) return;
  _redoStack.push(_snap());
  const s = JSON.parse(_undoStack.pop());
  state.nodes = s.nodes; state.arcs = s.arcs;
  clearSelection(); renderNetwork(); renderSidebarLists(); renderProps(); renderResults();
  _updateUndoBtns();
}

function redo() {
  if (!_redoStack.length) return;
  _undoStack.push(_snap());
  const s = JSON.parse(_redoStack.pop());
  state.nodes = s.nodes; state.arcs = s.arcs;
  clearSelection(); renderNetwork(); renderSidebarLists(); renderProps(); renderResults();
  _updateUndoBtns();
}

function _updateUndoBtns() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !_undoStack.length;
  if (r) r.disabled = !_redoStack.length;
}
