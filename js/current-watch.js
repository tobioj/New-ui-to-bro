// Existing source-app watch viewer, copied read-only into the UI sandbox.
const watchState = { active: null, scaleX: 1, scaleY: 1, cursorX: null, cursorY: null, frames: 0 };

async function openWatch(runType, runId, label) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (!api || typeof api.start_watch !== 'function') return;
  const previous = watchState.active;
  const sameRun = Boolean(previous)
    && previous.runType === runType && previous.runId === runId;
  // Arm the matcher before the call: the backend re-seeds watch_cursor while
  // start_watch is in flight, and a late arm would drop that event. Reopening
  // the same run keeps the last cursor position instead of blanking it.
  watchState.active = { runType, runId };
  const result = await api.start_watch(runType, runId);
  if (!result || result.success !== true) {
    watchState.active = previous;
    alert(`Could not open the watch stream: ${(result && result.error) || 'unknown error'}`);
    return;
  }
  watchState.frames = 0;
  if (!sameRun) {
    watchState.cursorX = null;
    watchState.cursorY = null;
  }
  const title = document.getElementById('watch-title');
  if (title) title.innerText = `Watch: ${label || runId}`;
  const status = document.getElementById('watch-status');
  if (status) status.innerText = 'Waiting for frames…';
  const frameCount = document.getElementById('watch-frames');
  if (frameCount) frameCount.innerText = '';
  const frame = document.getElementById('watch-frame');
  if (frame) frame.removeAttribute('src');
  document.getElementById('watch-modal').style.display = 'flex';
  const cursor = document.getElementById('watch-cursor');
  if (cursor) {
    cursor.style.left = '-40px';
    cursor.style.top = '-40px';
    positionWatchCursor();
  }
}

async function closeWatch() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const active = watchState.active;
  watchState.active = null;
  document.getElementById('watch-modal').style.display = 'none';
  if (active && api && typeof api.stop_watch === 'function') {
    await api.stop_watch(active.runType, active.runId);
  }
}

function watchMatches(data) {
  return Boolean(watchState.active)
    && data && data.run_type === watchState.active.runType && data.run_id === watchState.active.runId;
}

function applyWatchFrame(data) {
  if (!watchMatches(data) || !data.data) return;
  const frame = document.getElementById('watch-frame');
  if (!frame) return;
  frame.src = `data:image/jpeg;base64,${data.data}`;
  applyWatchFrameScale(data);
  if (data.cursor_x != null && data.cursor_y != null
      && Number.isFinite(Number(data.cursor_x)) && Number.isFinite(Number(data.cursor_y))) {
    watchState.cursorX = Number(data.cursor_x);
    watchState.cursorY = Number(data.cursor_y);
  }
  watchState.frames += 1;
  const frameCount = document.getElementById('watch-frames');
  if (frameCount) frameCount.innerText = `${watchState.frames} frames`;
  positionWatchCursor();
}

function watchFrameBox() {
  // The image box in stage coordinates; cursor and ripples are positioned
  // against this box, so any modal layout change stays consistent.
  const frame = document.getElementById('watch-frame');
  const stage = document.getElementById('watch-stage');
  if (!frame || !stage) return null;
  const frameRect = frame.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (!frameRect.width || !frameRect.height) return null;
  return {
    x: frameRect.left - stageRect.left,
    y: frameRect.top - stageRect.top,
    width: frameRect.width,
    height: frameRect.height,
  };
}

function applyWatchFrameScale(data) {
  // Scale from the capture's own size: the same space the mouse events are
  // reported in. naturalWidth is async (it lags to the previous image until
  // the new one decodes), which misplaces the cursor for frames around every
  // fullscreen/restore size change.
  const box = watchFrameBox();
  if (!box) return;
  const deviceWidth = Number(data.device_width || 0);
  const deviceHeight = Number(data.device_height || 0);
  watchState.scaleX = deviceWidth > 0 ? box.width / deviceWidth : 1;
  watchState.scaleY = deviceHeight > 0 ? box.height / deviceHeight : watchState.scaleX;
}

function positionWatchCursor() {
  const cursor = document.getElementById('watch-cursor');
  if (!cursor || watchState.cursorX == null) return;
  const box = watchFrameBox();
  if (!box) return;
  cursor.style.left = `${box.x + watchState.cursorX * watchState.scaleX}px`;
  cursor.style.top = `${box.y + watchState.cursorY * watchState.scaleY}px`;
}

function applyWatchCursor(data) {
  if (!watchMatches(data)) return;
  watchState.cursorX = Number(data.x);
  watchState.cursorY = Number(data.y);
  positionWatchCursor();
}

function applyWatchClick(data) {
  if (!watchMatches(data)) return;
  applyWatchCursor(data);
  const stage = document.getElementById('watch-stage');
  const box = watchFrameBox();
  if (!stage || !box) return;
  const ripple = document.createElement('div');
  ripple.className = 'watch-ripple';
  ripple.style.left = `${box.x + Number(data.x) * watchState.scaleX}px`;
  ripple.style.top = `${box.y + Number(data.y) * watchState.scaleY}px`;
  stage.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
}

function handleWatchEnded(data) {
  if (!watchMatches(data)) return;
  watchState.active = null;
  const status = document.getElementById('watch-status');
  if (status) status.innerText = data.reason === 'run_ended' ? 'Run finished — stream closed.' : 'Stream stopped.';
}
