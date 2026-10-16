/* Fleet entry point for the current viewer; watching is not a run command. */
(() => {
  const $ = id => document.getElementById(id);
  const originalEvent = handleLiveEvent;
  handleLiveEvent = function(event) {
    const handlers = { watch_frame: applyWatchFrame, watch_cursor: applyWatchCursor, watch_click: applyWatchClick, watch_ended: handleWatchEnded };
    if (handlers[event?.type]) handlers[event.type](event.data);
    else originalEvent(event);
  };
  let returnFocus;
  window.openFleetWatch = async profile => {
    if (!WorkspaceFormRules.canWatch(profile)) return;
    returnFocus = document.activeElement;
    try {
      await openWatch('session', profile.session.run_id, profile.name);
      if ($('watch-modal').style.display !== 'flex') return;
      document.querySelector('.app-container').inert = true;
      $('watch-feedback').textContent = previewBridgeActive
        ? 'Sandbox viewer preview. No live browser is connected here; the desktop app supplies the actual stream. Closing this view does not stop the run.'
        : 'Read-only live view. Closing this view does not stop the run.';
      if (previewBridgeActive) $('watch-status').textContent = 'Preview only · live frames require the desktop bridge';
      $('btn-close-watch').focus();
    } catch (error) {
      watchState.active = null;
      $('watch-modal').style.display = 'flex';
      $('watch-feedback').textContent = `Could not open the live view: ${error.message}`;
      $('btn-close-watch').focus();
    }
  };
  const originalClose = closeWatch;
  closeWatch = async function() {
    try { await originalClose(); }
    finally { document.querySelector('.app-container').inert = false; if (returnFocus?.isConnected) returnFocus.focus(); }
  };
  ['btn-close-watch', 'btn-close-watch-secondary', 'btn-stop-watch'].forEach(id => $(id).addEventListener('click', closeWatch));
  $('watch-modal').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeWatch(); }
    if (event.key !== 'Tab') return;
    const controls = [...$('watch-modal').querySelectorAll('button')].filter(button => !button.disabled);
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
  });
  $('watch-frame').addEventListener('load', () => {
    $('watch-status').textContent = watchState.active ? 'Live view' : 'Stream ended';
    positionWatchCursor();
  });
})();
