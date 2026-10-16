// ui/js/app.js

let selectedPodId = null;
let currentProfileId = null;
let editingProfileId = null;
const profileRowsById = new Map();
const activeSessions = new Map();
let liveDrawerMinimized = false;
let personasCache = [];
let appInitialized = false;
let appInitializationPromise = null;
let systemStatusInterval = null;
let previewFallbackTimer = null;
let previewBridgeActive = false;
let bridgeWatchdogTimer = null;
let ws = null;
let wsReconnectTimer = null;
let operationsSettings = null;
let restorePreviewToken = null;
let dataMovePreviewToken = null;
let operationsSchedules = [];
let scheduleEditingId = null;
let activationLocked = true;
let selectedUpdatePackagePath = null;
let uninstallPreview = null;

// Command Console (Block E, E1) state
const CONSOLE_BUFFER_LIMIT = 500;
const CONSOLE_HISTORY_LIMIT = 200;
const CONSOLE_SEVERITIES = ['info', 'warning', 'error', 'critical'];
let consoleEvents = [];
let consoleEventIds = new Set();
let consolePaused = false;
let consoleScrollLocked = false;
let consolePendingEvents = 0;
let consoleNextBeforeId = null;
let consoleLoadedOnce = false;
let consolePodFilter = "";
let consoleProfileFilter = "";
let consoleSeverityFilter = "";
let consoleRenderTimer = null;

// Fleet Monitor (Block E, E3) state
const FLEET_CARD_LIMIT = 20;
const FLEET_REFRESH_MS = 60000;
let fleetState = null;
let fleetRenderTimer = null;
let fleetRefreshInterval = null;

// Pulse board (Block E, E2) state
let pulseWarnings = [];
let pulseCounts = { open: 0, unacked: 0, critical: 0 };
let pulseStatusFilter = 'open';
let pulseRefreshTimer = null;

const PULSE_SEVERITY_LABELS = {
  critical: 'CALL ME NOW',
  warning: 'MORNING SUMMARY',
};

// Customization & input layer (Block E, E4) state
let customizationState = null;
let customizationPreview = null;
let podsById = new Map();

// Deploy desk (Block E, E6) state
let dispatchOptions = null;
let dispatchPreview = null;
let dispatches = [];
let deployRefreshTimer = null;

// Manual & local task desk (Block E, E7) state
let localDeskOptions = null;
let manualSessions = [];
let localRuns = [];
let manualRefreshTimer = null;

let delegatedActionsReady = false;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "STOPPED", "CANCELLED", "TIMEOUT"]);


// Desktop Bridge is authoritative. A delayed mock is only allowed for an HTTP(S)
// browser preview, so opening the packaged file URL can never initialize against
// a temporary bridge before Desktop Bridge injects the real one.
window.addEventListener('desktopbridgeready', () => {
  const wasPreviewBridge = previewBridgeActive;
  if (previewFallbackTimer) {
    clearTimeout(previewFallbackTimer);
    previewFallbackTimer = null;
  }
  if (bridgeWatchdogTimer) {
    clearTimeout(bridgeWatchdogTimer);
    bridgeWatchdogTimer = null;
  }
  previewBridgeActive = false;
  console.log("Desktop Bridge bridge interface ready.");
  initApp().then(refreshBridgeData).catch(err => {
    const context = wasPreviewBridge ? "switch from preview bridge" : "initialize Desktop Bridge bridge";
    console.error(`Failed to ${context}:`, err);
    showBridgeInitializationFailure(err);
  });
}, { once: true });

// Fallback for browser preview during local development
document.addEventListener('DOMContentLoaded', schedulePreviewFallback, { once: true });

function schedulePreviewFallback() {
  if (isBridgeReady()) {
    initApp();
    return;
  }

  if (!["http:", "https:"].includes(window.location.protocol)) {
    bridgeWatchdogTimer = setTimeout(() => {
      if (!isBridgeReady() && !appInitialized) {
        showBridgeInitializationFailure(
          new Error("The desktop bridge did not become ready within 8 seconds.")
        );
      }
    }, 8000);
    return;
  }

  previewFallbackTimer = setTimeout(() => {
    if (isBridgeReady() || appInitialized) return;
    console.warn("Running in browser preview mode with a mock bridge.");
    setupMockBridge();
    previewBridgeActive = true;
    initApp();
  }, 750);
}

function isBridgeReady() {
  return (
    typeof window.desktopBridge?.api?.get_system_status === 'function' &&
    typeof window.desktopBridge?.api?.list_pods === 'function'
  );
}

function dismissStartupOverlayIfMotionAbsent() {
  // Resilience: if startup-motion.js failed to load (a dropped request during
  // a busy boot must never brick the window), the overlay has no owner to
  // hide it - do it here once the app is otherwise finished or has failed.
  if (window.WsStartupMotion) return;
  const overlay = document.getElementById('app-startup-motion');
  if (overlay) {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('startup-motion-running');
  document.body.removeAttribute('aria-busy');
  const shell = document.querySelector('.app-container');
  if (shell) shell.inert = false;
}

function showBridgeInitializationFailure(error) {
  window.WsStartupMotion?.cancel?.();
  dismissStartupOverlayIfMotionAbsent();
  console.error("Workspace Controller desktop bridge initialization failed:", error);
  const versionBadge = document.getElementById('app-version-badge');
  const licenseText = document.getElementById('license-tier-text');
  const container = document.getElementById('pod-list-container');
  if (versionBadge) versionBadge.innerText = 'Bridge unavailable';
  if (licenseText) licenseText.innerText = 'Desktop bridge unavailable';
  if (container && !container.children.length) {
    const notice = document.createElement('p');
    notice.className = 'empty-state bridge-error';
    notice.innerText = 'The desktop bridge could not initialize. Close Workspace Controller and restart it from the project environment.';
    container.appendChild(notice);
  }
}

function setupMockBridge() {
  // The representative backend lives in js/bridge-mock.js and installs
  // window.desktopBridge.api at load time. If it did not load (or a real
  // host bridge is present), there is nothing to install here.
  if (!window.desktopBridge?.api) {
    console.warn("No bridge available: neither a host bridge nor the development mock is present.");
  }
}

async function initApp() {
  if (appInitialized) return;
  if (appInitializationPromise) return appInitializationPromise;

  appInitializationPromise = (async () => {
    const reportStartupProgress = (value, label) => window.WsStartupMotion?.setProgress?.(value, label);
    reportStartupProgress(.03, 'Connecting to system');
    setupDelegatedActions();
    setupNavigation();
    setupModals();
    setupProxyUI();
    setupOperationsUI();
    await refreshSystemStatus();
    reportStartupProgress(.10, 'Checking activation');
    const authorized = await refreshAuthStatus();
    if (authorized === false) {
      window.WsStartupMotion?.cancel?.();
      appInitialized = true;
      return;
    }
    reportStartupProgress(.16, 'Preparing workspace');
    window.WsStartupMotion?.start?.();
    await loadPersonas();
    reportStartupProgress(.24, 'Loading pods and profiles');
    await loadPods();
    reportStartupProgress(.40, 'Loading proxy inventory');
    await loadProxies();
    reportStartupProgress(.52, 'Loading workflows');
    await loadWorkflows();
    reportStartupProgress(.66, 'Loading run history');
    await loadWorkflowRuns();
    reportStartupProgress(.75, 'Applying runtime settings');
    await loadRuntimeSettings();
    reportStartupProgress(.84, 'Restoring customization');
    await loadCustomizationInputs();
    reportStartupProgress(.93, 'Connecting live status');
    await connectWebSocket();
    reportStartupProgress(.98, 'Finalizing workspace');

    if (!systemStatusInterval) {
      systemStatusInterval = setInterval(refreshSystemStatus, 6000);
    }
    appInitialized = true;
    window.applyMissionRoute?.();
    reportStartupProgress(1, 'Workspace ready');
    await window.WsStartupMotion?.finish?.();
    dismissStartupOverlayIfMotionAbsent();
  })();

  try {
    await appInitializationPromise;
  } finally {
    appInitializationPromise = null;
  }
}

async function refreshBridgeData({ preserveActivationModal = false } = {}) {
  await refreshSystemStatus();
  const authorized = await refreshAuthStatus({ preserveActivationModal });
  if (!authorized) return;
  await loadPersonas();
  await loadPods();
  await loadProxies();
  await loadWorkflows();
  await loadWorkflowRuns();
  await loadRuntimeSettings();
  if (document.getElementById('operations-tab')?.classList.contains('active')) {
    await loadOperationsOverview();
  }
  await connectWebSocket();
}

async function connectWebSocket() {
  try {
    if (!window.desktopBridge || !window.desktopBridge.api.get_ws_info) return;
    if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    const wsInfo = await window.desktopBridge.api.get_ws_info();
    if (!wsInfo.port || !wsInfo.token) {
      wsReconnectTimer = setTimeout(connectWebSocket, 2000);
      return;
    }

    const wsUrl = `ws://127.0.0.1:${wsInfo.port}/ws?token=${encodeURIComponent(wsInfo.token)}`;
    console.log(`Connecting to Workspace Controller WebSocket server on loopback port ${wsInfo.port}.`);
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      console.log("WebSocket connected. Subscribed to live telemetry & events.");
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleLiveEvent(payload);
      } catch (err) {
        console.error("Error parsing WebSocket event:", err);
      }
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
      console.error("WebSocket connection error:", err);
    };
  } catch (err) {
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  }
}

function handleLiveEvent(evt) {
  if (!evt || !evt.type || !evt.data) return;

  if (evt.type === "telemetry_update") {
    if (evt.data && evt.data.concurrency) {
      document.getElementById('stat-concurrency').innerText = evt.data.concurrency;
    }
  } else if (evt.type === "step_progress") {
    const data = evt.data;
    let s = activeSessions.get(data.session_id);
    if (!s) {
      s = {
        id: data.session_id,
        persona: data.label || "Session",
        type: data.kind || "WARMER",
        totalSteps: data.total_steps || 1,
        completedSteps: 0,
        status: "RUNNING",
        desc: ""
      };
      activeSessions.set(data.session_id, s);
    }
    s.completedSteps = data.step_index + 1;
    s.totalSteps = data.total_steps || s.totalSteps;
    s.desc = `${data.action.toUpperCase()}: ${data.description || ''}`;
    s.status = "RUNNING";
    renderActiveSessions();
  } else if (evt.type === "session_status") {
    const data = evt.data;
    handleFleetSessionEvent(data);
    if (String(data.session_id || "").startsWith("manual-")) scheduleManualRefresh();
    const s = activeSessions.get(data.session_id);
    if (s) {
      s.status = data.status;
      if (data.error) s.desc = `Error: ${data.error}`;
      renderActiveSessions();
    }
    if (["COMPLETED", "FAILED", "STOPPED", "CANCELLED"].includes(data.status)) {
      setTimeout(() => {
        if (selectedPodId) selectPod(selectedPodId);
      }, 1500);
    }
  } else if (typeof evt.type === "string" && evt.type.startsWith("run.")) {
    handleConsoleLiveEvent(evt);
    handleFleetLiveEvent(evt);
  } else if (evt.type === "dispatch_update") {
    scheduleDeployRefresh();
  } else if (evt.type === "warning_update") {
    updatePulseBadge(evt.data?.counts);
    schedulePulseBoardRefresh();
  } else if (evt.type === "report_invalidated") {
    scheduleReportingRefresh();
  }
}


function renderActiveSessions() {
  const container = document.getElementById('live-sessions-container');
  const drawer = document.getElementById('live-session-drawer');
  const countSpan = document.getElementById('active-sessions-count');
  const restoreButton = document.getElementById('btn-restore-drawer');
  const restoreCount = document.getElementById('restore-sessions-count');
  if (!container || !drawer) return;

  const runningCount = Array.from(activeSessions.values())
    .filter(session => !TERMINAL_STATUSES.has(String(session.status).toUpperCase())).length;
  if (countSpan) countSpan.innerText = runningCount;
  if (restoreCount) restoreCount.innerText = runningCount ? `${runningCount} live` : `${activeSessions.size} recent`;
  if (restoreButton) restoreButton.hidden = activeSessions.size === 0 || !liveDrawerMinimized;

  if (activeSessions.size === 0) {
    drawer.style.display = 'none';
    return;
  }

  drawer.style.display = liveDrawerMinimized ? 'none' : 'block';
  const previousScroll = container.scrollTop;
  container.innerHTML = "";

  activeSessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = "live-session-card";

    const pct = s.totalSteps > 0 ? Math.min(100, Math.round((s.completedSteps / s.totalSteps) * 100)) : 5;
    const isTerminal = ["COMPLETED", "FAILED", "STOPPED", "CANCELLED", "TIMEOUT"].includes(s.status);
    const badgeClass = s.status ? `badge-${s.status.toLowerCase()}` : 'badge-running';

    card.innerHTML = `
      <div class="live-session-header">
        <div class="live-session-title">
          ${!isTerminal ? '<span class="pulse-indicator"></span>' : ''}
          <h4>${escapeHtml(s.persona)} <span class="live-session-type">${escapeHtml((s.type || "SESSION").toUpperCase())}</span></h4>
          <span class="badge ${badgeClass}">${escapeHtml(s.status)}</span>
        </div>
        ${!isTerminal ? '<button class="btn btn-danger-outline btn-sm" data-action="stop-session" type="button">Stop</button>' : ''}
      </div>
      <div class="progress-track" role="progressbar" aria-label="${escapeAttribute(s.persona)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <div class="progress-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="live-session-body">
        <span>Step ${s.completedSteps} of ${s.totalSteps}</span>
        <p class="live-step-desc">${escapeHtml(s.desc || 'Executing plan...')}</p>
      </div>
    `;
    const stopButton = card.querySelector('[data-action="stop-session"]');
    if (stopButton) stopButton.dataset.sessionId = String(s.id);
    container.appendChild(card);
  });
  container.scrollTop = previousScroll;
}

window.stopSpecificSession = async function(sessionId) {
  try {
    await window.desktopBridge.api.stop_session(sessionId);
    const s = activeSessions.get(sessionId);
    if (s) {
      s.status = "STOPPED";
      s.desc = "Session stopped by operator.";
      renderActiveSessions();
    }
  } catch (err) {
    console.error("Failed to stop session:", err);
  }
};


// ==========================================================================
// Command Console (Block E, E1)
// ==========================================================================

const CONSOLE_TYPE_LABELS = {
  'run.session_state': 'STATE',
  'run.action': 'ACTION',
  'run.navigation': 'NAV',
  'run.challenge': 'CHALLENGE',
  'run.retry': 'RETRY',
  'run.error': 'ERROR',
  'run.manual': 'MANUAL',
};

function consoleShortId(value) {
  return value ? String(value).slice(0, 8) : 'Ã¢â‚¬â€';
}

function handleConsoleLiveEvent(evt) {
  const data = evt.data || {};
  const event = {
    id: null,
    event_id: data.event_id || `live-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: data.timestamp || new Date().toISOString(),
    event_type: evt.type,
    severity: CONSOLE_SEVERITIES.includes(data.severity) ? data.severity : 'info',
    session_id: data.session_id || null,
    run_type: data.run_type || null,
    profile_id: data.profile_id || null,
    pod_id: data.pod_id || null,
    message: data.message || '',
    payload: consoleExtractPayload(data),
  };
  storeConsoleEvent(event);
  scheduleConsoleRender();
}

function consoleExtractPayload(data) {
  const payload = {};
  const reserved = ['event_id', 'timestamp', 'severity', 'session_id', 'run_type', 'profile_id', 'pod_id', 'message'];
  Object.keys(data).forEach(key => {
    if (!reserved.includes(key)) payload[key] = data[key];
  });
  return payload;
}

function storeConsoleEvent(event) {
  if (!event || !event.event_id || consoleEventIds.has(event.event_id)) return false;
  consoleEventIds.add(event.event_id);
  consoleEvents.push(event);
  consoleEvents.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  while (consoleEvents.length > CONSOLE_BUFFER_LIMIT) {
    const removed = consoleEvents.pop();
    if (removed) consoleEventIds.delete(removed.event_id);
  }
  return true;
}

function consoleRowPassesFilters(event) {
  if (consolePodFilter && event.pod_id !== consolePodFilter) return false;
  if (consoleProfileFilter && event.profile_id !== consoleProfileFilter) return false;
  if (consoleSeverityFilter && event.severity !== consoleSeverityFilter) return false;
  return true;
}

function scheduleConsoleRender() {
  if (consolePaused || consoleScrollLocked) {
    consolePendingEvents += 1;
    updateConsolePendingBadge();
    return;
  }
  clearTimeout(consoleRenderTimer);
  consoleRenderTimer = setTimeout(() => renderConsoleStream(), 60);
}

function updateConsolePendingBadge() {
  const badge = document.getElementById('console-pending');
  if (!badge) return;
  if (consolePendingEvents > 0) {
    badge.style.display = 'inline-flex';
    badge.innerText = `${consolePendingEvents} new`;
  } else {
    badge.style.display = 'none';
  }
}

function consoleFormatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour12: false });
}

function buildConsoleRow(event) {
  const row = document.createElement('tr');
  row.className = `console-row console-sev-${event.severity}`;
  const time = document.createElement('span');
  time.className = 'console-time mono';
  time.innerText = consoleFormatTime(event.timestamp);
  const sev = document.createElement('span');
  sev.className = `badge console-badge console-badge-${event.severity}`;
  sev.innerText = event.severity.toUpperCase();
  const type = document.createElement('span');
  type.className = 'console-type';
  type.innerText = CONSOLE_TYPE_LABELS[event.event_type] || event.event_type;
  const profile = document.createElement('span');
  profile.className = 'console-profile mono';
  profile.innerText = consoleShortId(event.profile_id);
  profile.title = event.profile_id || 'No profile recorded';
  const message = document.createElement('span');
  message.className = 'console-message';
  message.innerText = event.message || '(no message)';
  message.title = event.message || '';
  const metaBits = [];
  if (event.run_type) metaBits.push(event.run_type);
  if (event.session_id) metaBits.push(`session ${consoleShortId(event.session_id)}`);
  if (event.payload && Object.keys(event.payload).length) metaBits.push(JSON.stringify(event.payload));
  const meta = document.createElement('span');
  meta.className = 'console-meta';
  meta.innerText = metaBits.join(' Ã‚Â· ');
  meta.title = meta.innerText;
  [time, sev, type, message, profile, meta].forEach(value => {
    const cell = document.createElement('td');
    cell.appendChild(value);
    row.appendChild(cell);
  });
  return row;
}

function updateConsoleChips() {
  const chipsEl = document.getElementById('console-profile-chips');
  if (!chipsEl) return;
  const profiles = new Map();
  consoleEvents.forEach(event => {
    if (event.profile_id) profiles.set(event.profile_id, (profiles.get(event.profile_id) || 0) + 1);
  });
  chipsEl.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `console-chip${consoleProfileFilter ? '' : ' active'}`;
  allChip.dataset.consoleProfile = '';
  allChip.setAttribute('aria-pressed', String(!consoleProfileFilter));
  allChip.innerText = 'All profiles';
  chipsEl.appendChild(allChip);
  Array.from(profiles.keys()).sort().forEach(profileId => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `console-chip${consoleProfileFilter === profileId ? ' active' : ''}`;
    chip.dataset.consoleProfile = profileId;
    chip.setAttribute('aria-pressed', String(consoleProfileFilter === profileId));
    chip.innerText = `${consoleShortId(profileId)} (${profiles.get(profileId)})`;
    chip.title = profileId;
    chipsEl.appendChild(chip);
  });
}

function updateConsoleSeverityChips() {
  document.querySelectorAll('[data-console-severity]').forEach(chip => {
    const selected = (chip.dataset.consoleSeverity || '') === consoleSeverityFilter;
    chip.classList.toggle('active', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
}

function renderConsoleStream() {
  const streamEl = document.getElementById('console-stream');
  if (!streamEl) return;
  const table = streamEl.querySelector('table');
  const body = table?.tBodies[0];
  if (!table || !body) return;
  consolePendingEvents = 0;
  updateConsolePendingBadge();
  updateConsoleChips();
  const visible = consoleEvents.filter(consoleRowPassesFilters);
  body.replaceChildren();
  streamEl.querySelector('.console-empty')?.remove();
  table.hidden = !visible.length;
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'console-empty';
    empty.innerText = consoleLoadedOnce
      ? 'No events match the current filters.'
      : 'Waiting for events. Live run activity streams here as runs execute.';
    streamEl.appendChild(empty);
    return;
  }
  visible.forEach(event => body.appendChild(buildConsoleRow(event)));
}

function toggleConsolePause() {
  consolePaused = !consolePaused;
  const button = document.getElementById('btn-console-pause');
  if (button) button.innerText = consolePaused ? 'Resume stream' : 'Pause stream';
  if (!consolePaused) renderConsoleStream();
  else updateConsolePendingBadge();
}

async function refreshConsolePodOptions() {
  const select = document.getElementById('console-pod-filter');
  const api = window.desktopBridge && window.desktopBridge.api;
  if (!select || typeof api?.list_pods !== 'function') return;
  try {
    const pods = await api.list_pods();
    const current = consolePodFilter;
    select.innerHTML = '<option value="">All pods</option>';
    (pods || []).forEach(pod => {
      const option = document.createElement('option');
      option.value = pod.id;
      option.innerText = pod.name;
      select.appendChild(option);
    });
    select.value = current;
  } catch (err) {
    console.error("Failed to load console pod filter:", err);
  }
}

async function loadConsoleHistory(older = false, force = false) {
  const feedback = document.getElementById('console-feedback');
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_console_events !== 'function') return;
  if (older && !consoleNextBeforeId) return;
  const filters = {};
  if (consolePodFilter) filters.pod_id = consolePodFilter;
  if (consoleProfileFilter) filters.profile_id = consoleProfileFilter;
  if (consoleSeverityFilter) filters.severity = consoleSeverityFilter;
  try {
    const result = await api.get_console_events(
      filters, CONSOLE_HISTORY_LIMIT, older ? consoleNextBeforeId : null
    );
    if (!result.success) throw new Error(result.error || 'Console history unavailable.');
    if (!older || force) {
      consoleEvents = [];
      consoleEventIds = new Set();
    }
    (result.events || []).forEach(event => storeConsoleEvent(event));
    consoleNextBeforeId = result.next_before_id || null;
    consoleLoadedOnce = true;
    const meta = document.getElementById('console-page-meta');
    if (meta) {
      meta.innerText = `${result.total || 0} recorded events Ã‚Â· showing ${consoleEvents.length}${consoleNextBeforeId ? '' : ' Ã‚Â· oldest loaded'}`;
    }
    const olderButton = document.getElementById('btn-console-older');
    if (olderButton) olderButton.disabled = !consoleNextBeforeId;
    if (feedback) feedback.innerText = '';
    renderConsoleStream();
  } catch (err) {
    if (feedback) {
      feedback.innerText = `Could not load console history: ${err.message || err}`;
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

function activateConsoleTab() {
  if (consoleLoadedOnce) return;
  refreshConsolePodOptions();
  loadConsoleHistory(false, true);
}

function setupConsoleUI() {
  document.getElementById('btn-console-pause')?.addEventListener('click', toggleConsolePause);
  document.getElementById('btn-console-older')?.addEventListener('click', () => loadConsoleHistory(true));
  document.getElementById('btn-console-refresh')?.addEventListener('click', () => loadConsoleHistory(false, true));
  document.getElementById('btn-console-clear')?.addEventListener('click', () => {
    consoleEvents = [];
    consoleEventIds = new Set();
    consolePendingEvents = 0;
    renderConsoleStream();
  });
  document.getElementById('console-pod-filter')?.addEventListener('change', (event) => {
    consolePodFilter = event.target.value || '';
    renderConsoleStream();
  });
  document.getElementById('console-pending')?.addEventListener('click', () => {
    consoleScrollLocked = false;
    const streamEl = document.getElementById('console-stream');
    if (streamEl) streamEl.scrollTop = 0;
    renderConsoleStream();
  });
  const streamEl = document.getElementById('console-stream');
  streamEl?.addEventListener('scroll', () => {
    const locked = streamEl.scrollTop > 48;
    if (locked !== consoleScrollLocked) {
      consoleScrollLocked = locked;
      if (!locked) renderConsoleStream();
      else updateConsolePendingBadge();
    }
  });
  document.getElementById('console-tab')?.addEventListener('click', (event) => {
    const ProfileChip = event.target.closest('[data-console-profile]');
    if (ProfileChip) {
      consoleProfileFilter = ProfileChip.dataset.consoleProfile || '';
      renderConsoleStream();
      return;
    }
    const severityChip = event.target.closest('[data-console-severity]');
    if (severityChip) {
      consoleSeverityFilter = severityChip.dataset.consoleSeverity || '';
      updateConsoleSeverityChips();
      renderConsoleStream();
    }
  });
}


// ==========================================================================
// Fleet Monitor (Block E, E3)
// ==========================================================================

function fleetBucketBadgeClass(bucket) {
  if (bucket === 'active') return 'badge-running';
  if (bucket === 'eligible') return 'badge-completed';
  if (bucket === 'quarantined') return 'badge-failed';
  return 'badge-queued';
}

function fleetActivityLine(profile) {
  const activity = window.FleetPresentation.activityContext(profile);
  return activity.timestamp ? `${consoleFormatTime(activity.timestamp)} Ã‚Â· ${activity.message}` : activity.message;
}

async function loadFleetOverview() {
  const feedback = document.getElementById('fleet-feedback');
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_fleet_overview !== 'function') return;
  try {
    const result = await api.get_fleet_overview();
    if (!result.success) throw new Error(result.error || 'Fleet snapshot unavailable.');
    fleetState = result;
    renderFleet();
    if (feedback) feedback.innerText = '';
  } catch (err) {
    if (feedback) {
      feedback.innerText = `Could not load fleet state: ${err.message || err}`;
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

function renderFleet() {
  if (!fleetState) return;
  const summary = fleetState.summary || {};
  const tile = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };
  tile('fleet-count-active', summary.active || 0);
  tile('fleet-count-onboarding', summary.Onboarding || 0);
  tile('fleet-count-eligible', summary.eligible || 0);
  tile('fleet-count-quarantined', summary.quarantined || 0);
  tile('fleet-count-blocked', summary.blocked || 0);

  const resources = fleetState.resources || {};
  const resourcesEl = document.getElementById('fleet-resources');
  if (resourcesEl) {
    const bits = [`Browsers ${resources.active_browsers ?? 0}/${resources.browser_limit ?? 0}`];
    if (resources.cpu_percent != null) bits.push(`CPU ${Math.round(resources.cpu_percent)}%`);
    if (resources.memory_used_percent != null) bits.push(`RAM ${Math.round(resources.memory_used_percent)}%`);
    if (resources.memory_available_mb != null) bits.push(`${resources.memory_available_mb} MB free`);
    bits.push(`synced ${consoleFormatTime(fleetState.generated_at)}`);
    resourcesEl.innerText = `Resources: ${bits.join(' Ã‚Â· ')}`;
  }

  const container = document.getElementById('fleet-container');
  if (!container) return;
  container.innerHTML = '';
  const profiles = fleetState.profiles || [];
  if (!profiles.length && !(fleetState.pods || []).length) {
    const empty = document.createElement('p');
    empty.className = 'console-empty';
    empty.innerText = 'No profiles exist yet. Create a pod and generate profiles to populate the fleet.';
    container.appendChild(empty);
    return;
  }
  profiles.forEach(profile => {
    const error = window.FleetPresentation.errorContext(profile);
    window.MissionControl?.setDetails(`fleet:${profile.profile_id}`, {
      title: profile.name,
      subtitle: `${profile.pod_name || 'No pod'} Ã‚Â· ${String(profile.bucket || 'unknown').toUpperCase()}`,
      rows: [
        ['Score / onboarding', `${Math.round(Number(profile.trust_score || 0) * 100)}% Ã‚Â· ${window.FleetPresentation.OnboardingHours(profile.onboarding_hours)}`],
        ['Readiness rules', profile.gate_message || 'No gate result'],
        ['Placement', profile.placement ? [profile.placement.name, profile.placement.city].filter(Boolean).join(' Ã‚Â· ') : 'No region bound'],
        ['Current activity', fleetActivityLine(profile)],
        ['Latest session', profile.session ? `${profile.session.status} Ã‚Â· ${profile.session.actions_completed || 0} actions` : 'No session'],
        [error.kind === 'past' ? 'Past error (later run completed)' : 'Last recorded error', error.error ? `${error.error.timestamp ? `${consoleFormatTime(error.error.timestamp)} Ã‚Â· ` : ''}${error.error.message}` : 'None recorded'],
        ['Next scheduled', profile.next_scheduled_at ? consoleFormatTime(profile.next_scheduled_at) : 'None'],
      ],
    });
  });
  if (profiles.length <= FLEET_CARD_LIMIT) buildFleetCards(container, profiles);
  else buildFleetTable(container, profiles);
}

function buildFleetCards(container, profiles) {
  container.className = 'fleet-grid';
  profiles.forEach(profile => {
    const card = document.createElement('article');
    card.className = `fleet-card fleet-bucket-${profile.bucket}`;
    const header = document.createElement('header');
    header.className = 'fleet-card-header';
    const name = document.createElement('h4');
    name.innerText = profile.name;
    name.title = profile.profile_id;
    const badge = document.createElement('span');
    badge.className = `badge ${fleetBucketBadgeClass(profile.bucket)}`;
    badge.innerText = String(profile.bucket || '').toUpperCase();
    const headerActions = document.createElement('div');
    headerActions.className = 'fleet-header-actions';
    headerActions.appendChild(badge);
    headerActions.insertAdjacentHTML('beforeend', window.MissionControl?.eyeButton(`fleet:${profile.profile_id}`, `View ${profile.name} context`) || '');
    header.append(name, headerActions);

    const activity = document.createElement('p');
    activity.className = 'fleet-activity';
    activity.innerText = fleetActivityLine(profile);
    activity.title = activity.innerText;

    const stats = document.createElement('div');
    stats.className = 'fleet-stats';
    [
      `Trust ${Math.round((profile.trust_score || 0) * 100)}%`,
      `Onboarding ${window.FleetPresentation.OnboardingHours(profile.onboarding_hours)}`,
      String(profile.device_type || 'Ã¢â‚¬â€').toUpperCase(),
      profile.session ? `${profile.session.status} Ã‚Â· ${profile.session.actions_completed || 0} actions` : 'No session',
    ].forEach(text => {
      const item = document.createElement('span');
      item.innerText = text;
      stats.appendChild(item);
    });

    const footer = document.createElement('footer');
    footer.className = 'fleet-card-footer';
    const placement = document.createElement('span');
    placement.className = 'fleet-placement';
    placement.innerText = profile.placement ? `${profile.placement.name} Ã‚Â· ${profile.placement.city}` : 'No region bound';
    const podTag = document.createElement('span');
    podTag.className = 'fleet-pod';
    podTag.innerText = profile.pod_name || '';
    const errorEl = document.createElement('span');
    errorEl.className = `fleet-error${profile.last_error ? ' has-error' : ''}`;
    errorEl.innerText = profile.last_error ? `Last error: ${profile.last_error.message}` : 'No errors recorded';
    errorEl.title = errorEl.innerText;
    footer.append(placement, podTag, errorEl);

    card.append(header, activity, stats, footer);
    container.appendChild(card);
  });
}

function buildFleetTable(container, profiles) {
  container.className = 'monitor-table-wrap';
  const table = document.createElement('table');
  table.className = 'data-table monitor-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['profile', 'Pod', 'State', 'Trust', 'Onboarding', 'Activity', 'Last error', 'Placement', 'Session', 'Details'].forEach(label => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.innerText = label;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  const body = document.createElement('tbody');
  profiles.forEach(profile => {
    const row = document.createElement('tr');
    [
      profile.name,
      profile.pod_name || 'Ã¢â‚¬â€',
      String(profile.bucket || '').toUpperCase(),
      `${Math.round((profile.trust_score || 0) * 100)}%`,
      window.FleetPresentation.OnboardingHours(profile.onboarding_hours),
      profile.activity && profile.activity.message ? profile.activity.message : 'Ã¢â‚¬â€',
      profile.last_error ? profile.last_error.message : 'Ã¢â‚¬â€',
      profile.placement ? `${profile.placement.name} Ã‚Â· ${profile.placement.city}` : 'No region bound',
      profile.session ? `${profile.session.status} Ã‚Â· ${profile.session.actions_completed || 0} actions` : 'Ã¢â‚¬â€',
    ].forEach(value => {
      const td = document.createElement('td');
      td.innerText = value;
      row.appendChild(td);
    });
    const detail = document.createElement('td');
    detail.innerHTML = window.MissionControl?.eyeButton(`fleet:${profile.profile_id}`, `View ${profile.name} context`) || '';
    row.appendChild(detail);
    body.appendChild(row);
  });
  table.append(head, body);
  container.appendChild(table);
}

function scheduleFleetRender() {
  clearTimeout(fleetRenderTimer);
  fleetRenderTimer = setTimeout(renderFleet, 150);
}

function handleFleetLiveEvent(evt) {
  if (!fleetState || !Array.isArray(fleetState.profiles)) return;
  const data = evt.data || {};
  const profile = fleetState.profiles.find(item => item.profile_id === data.profile_id);
  if (!profile) return;
  if (evt.type || data.message) {
    profile.activity = {
      timestamp: data.timestamp || new Date().toISOString(),
      event_type: evt.type,
      severity: data.severity || 'info',
      message: data.message || '',
      session_id: data.session_id || null,
    };
  }
  if ((data.severity === 'error' || data.severity === 'critical') && data.message) {
    profile.last_error = {
      timestamp: data.timestamp || new Date().toISOString(),
      severity: data.severity,
      message: data.message,
    };
  }
  scheduleFleetRender();
}

function handleFleetSessionEvent(data) {
  if (!fleetState || !Array.isArray(fleetState.profiles) || !data) return;
  const profile = fleetState.profiles.find(item => item.session && item.session.run_id === data.session_id);
  if (!profile) return;
  profile.session.status = data.status;
  if (String(data.status || '').toUpperCase() === 'COMPLETED') profile.session.completed_at = data.timestamp || new Date().toISOString();
  profile.active = ['QUEUED', 'RUNNING', 'RECOVERING', 'PAUSED'].includes(String(data.status || '').toUpperCase());
  scheduleFleetRender();
}

function setupFleetUI() {
  document.getElementById('btn-fleet-refresh')?.addEventListener('click', () => loadFleetOverview());
  if (!fleetRefreshInterval) {
    fleetRefreshInterval = setInterval(() => {
      if (document.getElementById('monitor-tab')?.classList.contains('active')) loadFleetOverview();
    }, FLEET_REFRESH_MS);
  }
}


// ==========================================================================
// Pulse board (Block E, E2)
// ==========================================================================

function pulseEntityLabel(warning) {
  if (warning.entity_label) return warning.entity_label;
  return `${warning.entity_type} ${consoleShortId(warning.entity_id)}`;
}

function updatePulseBadge(counts) {
  if (counts) pulseCounts = counts;
  const badge = document.getElementById('pulse-badge');
  const countEl = document.getElementById('pulse-badge-count');
  if (!badge || !countEl) return;
  const unacked = pulseCounts.unacked || 0;
  countEl.innerText = String(unacked);
  badge.style.display = unacked > 0 ? 'inline-flex' : 'none';
  badge.classList.toggle('has-critical', (pulseCounts.critical || 0) > 0);
  badge.title = unacked
    ? `${unacked} unacknowledged warning(s) Ã¢â‚¬â€ ${pulseCounts.critical || 0} critical`
    : 'No open warnings';
}

async function refreshPulseCounts() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_warnings !== 'function') return;
  try {
    const result = await api.get_warnings('open', 1);
    if (result.success) updatePulseBadge(result.counts);
  } catch (err) {
    console.error('Failed to refresh Pulse counts:', err);
  }
}

async function loadPulseBoard() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('pulse-feedback');
  if (typeof api?.get_warnings !== 'function') return;
  try {
    const result = await api.get_warnings(pulseStatusFilter, 200);
    if (!result.success) throw new Error(result.error || 'Pulse board unavailable.');
    pulseWarnings = result.warnings || [];
    updatePulseBadge(result.counts);
    renderPulseBoard();
    if (feedback) feedback.innerText = '';
  } catch (err) {
    if (feedback) {
      feedback.innerText = `Could not load warnings: ${err.message || err}`;
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

function renderPulseBoard() {
  const board = document.getElementById('pulse-board');
  const countsEl = document.getElementById('pulse-counts');
  if (!board) return;
  if (countsEl) {
    countsEl.innerText = `${pulseCounts.unacked || 0} unacknowledged Ã‚Â· ${pulseCounts.critical || 0} critical Ã‚Â· ${pulseCounts.open || 0} open`;
  }
  board.innerHTML = '';
  if (!pulseWarnings.length) {
    const empty = document.createElement('p');
    empty.className = 'console-empty';
    empty.innerText = pulseStatusFilter === 'open'
      ? 'Nothing needs attention right now.'
      : 'No warnings in this view.';
    board.appendChild(empty);
    return;
  }
  pulseWarnings.forEach(warning => {
    const card = document.createElement('article');
    card.className = `pulse-card pulse-sev-${warning.severity}`
      + (warning.ack ? ' pulse-acked' : '')
      + (warning.resolved_at ? ' pulse-resolved' : '');
    const header = document.createElement('header');
    header.className = 'pulse-card-header';
    const title = document.createElement('h4');
    title.innerText = `${PULSE_SEVERITY_LABELS[warning.severity] || String(warning.severity).toUpperCase()} Ã‚Â· ${warning.title}`;
    const entity = document.createElement('span');
    entity.className = 'pulse-entity mono';
    entity.innerText = pulseEntityLabel(warning);
    entity.title = `${warning.entity_type}: ${warning.entity_id}`;
    header.append(title, entity);

    const reason = document.createElement('p');
    reason.className = 'pulse-reason';
    reason.innerText = warning.reason || '';

    const meta = document.createElement('p');
    meta.className = 'pulse-meta';
    const bits = [
      `first seen ${consoleFormatTime(warning.first_seen)}`,
      `last ${consoleFormatTime(warning.last_seen)}`,
    ];
    if (warning.ack) bits.push(`acked ${consoleFormatTime(warning.ack_at)}`);
    if (warning.resolved_at) bits.push(`resolved ${consoleFormatTime(warning.resolved_at)}`);
    meta.innerText = bits.join(' Ã‚Â· ');

    const actions = document.createElement('div');
    actions.className = 'pulse-actions';
    if (!warning.resolved_at) {
      const goto = document.createElement('button');
      goto.className = 'btn btn-secondary btn-sm';
      goto.type = 'button';
      goto.dataset.action = 'pulse-goto';
      goto.dataset.pulseTab = pulseTabForEntity(warning.entity_type);
      goto.innerText = 'Open';
      actions.appendChild(goto);
      if (!warning.ack) {
        const ackButton = document.createElement('button');
        ackButton.className = 'btn btn-primary btn-sm';
        ackButton.type = 'button';
        ackButton.dataset.action = 'ack-warning';
        ackButton.dataset.warningId = warning.id;
        ackButton.innerText = 'Acknowledge';
        actions.appendChild(ackButton);
      } else {
        const acked = document.createElement('span');
        acked.className = 'badge badge-completed';
        acked.innerText = 'ACKED';
        actions.appendChild(acked);
      }
    }
    card.append(header, reason, meta, actions);
    board.appendChild(card);
  });
}

function pulseTabForEntity(entityType) {
  if (entityType === 'profile') return 'monitor-tab';
  if (entityType === 'session') return 'console-tab';
  if (entityType === 'pod') return 'pods-tab';
  if (entityType === 'schedule') return 'operations-tab';
  if (entityType === 'dispatch') return 'deploy-tab';
  return 'system-tab';
}

async function ackPulseWarning(warningId) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.ack_warning !== 'function') return;
  try {
    await api.ack_warning(warningId);
    await loadPulseBoard();
  } catch (err) {
    console.error('Failed to acknowledge warning:', err);
  }
}

async function ackAllPulseWarnings() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.ack_all_warnings !== 'function') return;
  try {
    await api.ack_all_warnings();
    await loadPulseBoard();
  } catch (err) {
    console.error('Failed to acknowledge all warnings:', err);
  }
}

function schedulePulseBoardRefresh() {
  clearTimeout(pulseRefreshTimer);
  pulseRefreshTimer = setTimeout(() => {
    refreshPulseCounts();
    if (document.getElementById('alerts-tab')?.classList.contains('active')) loadPulseBoard();
  }, 300);
}

function pulseGoTo(tabId) {
  document.querySelector(`[data-tab="${tabId}"]`)?.click();
}

function setupPulseUI() {
  document.getElementById('btn-pulse-refresh')?.addEventListener('click', () => loadPulseBoard());
  document.getElementById('btn-pulse-ack-all')?.addEventListener('click', () => ackAllPulseWarnings());
  document.getElementById('pulse-status-filter')?.addEventListener('change', (event) => {
    pulseStatusFilter = event.target.value || 'open';
    loadPulseBoard();
  });
  document.getElementById('pulse-badge')?.addEventListener('click', () => pulseGoTo('alerts-tab'));
  refreshPulseCounts();
}


// ==========================================================================
// Customization & input layer (Block E, E4)
// ==========================================================================

const CUSTOMIZE_PATTERN_TOKENS = /{(pod|archetype|index|region)(?::([^}]*))?}/g;

function customizationSlug(value) {
  return String(value || 'pod').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pod';
}

async function loadCustomizationInputs(view = null) {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('customize-feedback');
  if (typeof api?.get_customization_inputs !== 'function') return;
  try {
    const bundle = await api.get_customization_inputs();
    if (!bundle.success) throw new Error(bundle.error || 'Customization inputs unavailable.');
    customizationState = bundle;
    customizationPreview = null;
    renderCustomizationForm(view);
    setCustomizationApplyEnabled(false);
    if (feedback) feedback.innerText = '';
  } catch (err) {
    if (feedback) {
      feedback.innerText = `Could not load customization inputs: ${err.message || err}`;
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

function renderCustomizationForm(view = null) {
  if (!customizationState) return;
  const inputs = customizationState.inputs || {};
  const options = customizationState.options || {};

  const container = document.getElementById('customize-campaign-list');
  if (container && (!view || view === 'campaigns')) {
    container.innerHTML = '';
    if (!(options.pods || []).length) {
      const empty = document.createElement('p');
      empty.className = 'console-empty';
      empty.innerText = 'No pods exist yet Ã¢â‚¬â€ create one to configure campaign targets.';
      container.appendChild(empty);
    } else {
      options.pods.forEach(pod => container.appendChild(buildCampaignRow(pod, inputs, options)));
    }
  }

  if (!view || view === 'sessions') {
    const mix = inputs.session_mix || {};
    setCustomizationValue('mix-warmer-ratio', mix.warmer_ratio);
    setCustomizationValue('mix-target-ratio', mix.target_ratio);
    setCustomizationValue('mix-warmer-min', mix.warmer_duration_minutes?.[0]);
    setCustomizationValue('mix-warmer-max', mix.warmer_duration_minutes?.[1]);
    setCustomizationValue('mix-target-min', mix.target_duration_minutes?.[0]);
    setCustomizationValue('mix-target-max', mix.target_duration_minutes?.[1]);
    setCustomizationValue('mix-max-day', mix.max_sessions_per_profile_per_day);
  }

  if (!view || view === 'rhythm') {
    const rhythm = inputs.rhythm || {};
    setCustomizationValue('rhythm-start', rhythm.active_window_start);
    setCustomizationValue('rhythm-end', rhythm.active_window_end);
    setCustomizationValue('rhythm-timezone', rhythm.timezone);
    const activeDays = new Set(rhythm.active_days || []);
    document.querySelectorAll('[data-rhythm-day]').forEach(chip => {
      const selected = activeDays.has(chip.dataset.rhythmDay);
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
  }

  if (!view || view === 'personas') {
    const personas = inputs.personas || {};
    setCustomizationValue('personas-mode', personas.assignment_mode);
    renderPersonaPool(personas.default_pool || []);
  }

  if (!view || view === 'naming') {
    const naming = inputs.naming || {};
    setCustomizationValue('naming-pattern', naming.profile_pattern);
    setCustomizationValue('naming-run-prefix', naming.run_prefix);
  }
}

function setCustomizationValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function buildCustomizationField(labelText, fieldName, options) {
  const group = document.createElement('div');
  group.className = 'form-group';
  const label = document.createElement('label');
  label.innerText = labelText;
  const input = document.createElement('input');
  input.className = 'input-field';
  input.dataset.customizeField = fieldName;
  input.value = options.value || '';
  if (options.placeholder) input.placeholder = options.placeholder;
  group.append(label, input);
  return group;
}

function buildCampaignRow(pod, inputs, options) {
  const item = (inputs.campaign || []).find(entry => entry.pod_id === pod.id) || { pod_id: pod.id };
  const row = document.createElement('div');
  row.className = 'customize-pod-row';
  row.dataset.podId = pod.id;

  const header = document.createElement('div');
  header.className = 'customize-pod-header';
  const title = document.createElement('h4');
  title.innerText = `${pod.name} (${pod.profile_count || 0} profile(s))`;
  header.appendChild(title);
  row.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'form-row-2 customize-pod-grid';
  grid.appendChild(buildCustomizationField('Target URL', 'url', {
    value: item.target_url || pod.target_url || '',
    placeholder: 'https://youtube.com/@channel',
  }));

  const regionGroup = document.createElement('div');
  regionGroup.className = 'form-group';
  const regionLabel = document.createElement('label');
  regionLabel.innerText = 'Region placement';
  const regionSelect = document.createElement('select');
  regionSelect.className = 'input-field';
  regionSelect.dataset.customizeField = 'region_id';
  const unchanged = document.createElement('option');
  unchanged.value = '';
  unchanged.innerText = 'Unchanged';
  regionSelect.appendChild(unchanged);
  (options.regions || []).forEach(region => {
    const option = document.createElement('option');
    option.value = region.id;
    option.innerText = `${region.name} Ã¢â‚¬â€ ${region.city}`;
    regionSelect.appendChild(option);
  });
  regionSelect.value = item.region_id || '';
  regionGroup.append(regionLabel, regionSelect);
  grid.appendChild(regionGroup);

  grid.appendChild(buildCustomizationField('Channel targets (comma-separated)', 'channels', {
    value: (item.channels || []).join(', '),
    placeholder: '@channel, @secondchannel',
  }));
  grid.appendChild(buildCustomizationField('Video targets (comma-separated)', 'videos', {
    value: (item.videos || []).join(', '),
    placeholder: 'dQw4w9WgXcQ',
  }));
  row.appendChild(grid);

  if ((options.workflows || []).length) {
    const syncGroup = document.createElement('div');
    syncGroup.className = 'form-group';
    const syncLabel = document.createElement('label');
    syncLabel.innerText = 'Write the allowlists into these workflows';
    syncGroup.appendChild(syncLabel);
    const syncList = document.createElement('div');
    syncList.className = 'customize-sync-list';
    options.workflows.forEach(workflow => {
      const label = document.createElement('label');
      label.className = 'check-row customize-sync-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.customizeField = 'sync_workflow_ids';
      checkbox.value = workflow.id;
      checkbox.checked = (item.sync_workflow_ids || []).includes(workflow.id);
      const text = document.createElement('span');
      text.textContent = `${workflow.name} (${workflow.channel_count} ch Ã‚Â· ${workflow.video_count} vid)`;
      label.append(checkbox, text);
      syncList.appendChild(label);
    });
    syncGroup.appendChild(syncList);
    row.appendChild(syncGroup);
  }
  return row;
}

function renderPersonaPool(entries) {
  const container = document.getElementById('personas-pool');
  if (!container) return;
  container.innerHTML = '';
  entries.forEach(entry => container.appendChild(buildPoolRow(entry)));
}

function buildPoolRow(entry) {
  const row = document.createElement('div');
  row.className = 'persona-pool-row';
  const select = document.createElement('select');
  select.className = 'input-field';
  select.dataset.poolKey = 'key';
  (customizationState?.options?.personas || []).forEach(persona => {
    const option = document.createElement('option');
    option.value = persona.key;
    option.innerText = persona.name;
    select.appendChild(option);
  });
  if (entry && entry.key) select.value = entry.key;
  const weight = document.createElement('input');
  weight.className = 'input-field persona-pool-weight';
  weight.type = 'number';
  weight.min = '0.1';
  weight.step = '0.1';
  weight.value = entry && entry.weight !== undefined ? entry.weight : 1.0;
  weight.dataset.poolKey = 'weight';
  const remove = document.createElement('button');
  remove.className = 'btn btn-secondary btn-sm icon-square-btn';
  remove.type = 'button';
  remove.dataset.action = 'persona-pool-remove';
  remove.setAttribute('aria-label', 'Remove persona from pool');
  remove.title = 'Remove persona from pool';
  remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  row.append(select, weight, remove);
  return row;
}

function collectCustomizationPayload() {
  const previous = customizationState?.inputs || {};
  const campaign = [];
  document.querySelectorAll('.customize-pod-row').forEach(row => {
    const channels = row.querySelector('[data-customize-field="channels"]')?.value || '';
    const videos = row.querySelector('[data-customize-field="videos"]')?.value || '';
    const sync = Array.from(row.querySelectorAll('[data-customize-field="sync_workflow_ids"]:checked'))
      .map(checkbox => checkbox.value);
    campaign.push({
      pod_id: row.dataset.podId,
      target_url: row.querySelector('[data-customize-field="url"]')?.value.trim() || null,
      region_id: row.querySelector('[data-customize-field="region_id"]')?.value || null,
      channels: channels.split(',').map(item => item.trim()).filter(Boolean),
      videos: videos.split(',').map(item => item.trim()).filter(Boolean),
      sync_workflow_ids: sync,
    });
  });
  const intValue = (id, fallback) => {
    const parsed = parseInt(document.getElementById(id)?.value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const days = Array.from(document.querySelectorAll('[data-rhythm-day].active'))
    .map(chip => chip.dataset.rhythmDay);
  const pool = [];
  document.querySelectorAll('#personas-pool .persona-pool-row').forEach(row => {
    const key = row.querySelector('[data-pool-key="key"]')?.value;
    const weight = parseFloat(row.querySelector('[data-pool-key="weight"]')?.value);
    if (key) pool.push({ key, weight: Number.isFinite(weight) ? weight : 1.0 });
  });
  return {
    campaign,
    session_mix: {
      warmer_ratio: intValue('mix-warmer-ratio', 3),
      target_ratio: intValue('mix-target-ratio', 1),
      warmer_duration_minutes: [intValue('mix-warmer-min', 20), intValue('mix-warmer-max', 45)],
      target_duration_minutes: [intValue('mix-target-min', 10), intValue('mix-target-max', 30)],
      max_sessions_per_profile_per_day: intValue('mix-max-day', 4),
    },
    rhythm: {
      active_window_start: document.getElementById('rhythm-start')?.value || '09:00',
      active_window_end: document.getElementById('rhythm-end')?.value || '23:00',
      active_days: days,
      timezone: document.getElementById('rhythm-timezone')?.value.trim() || '',
    },
    personas: {
      assignment_mode: document.getElementById('personas-mode')?.value || 'rule',
      default_pool: pool,
      pod_pools: previous.personas?.pod_pools || {},
    },
    naming: {
      profile_pattern: document.getElementById('naming-pattern')?.value.trim() || '',
      run_prefix: document.getElementById('naming-run-prefix')?.value.trim() || '',
    },
  };
}

function setCustomizationApplyEnabled(enabled) {
  const button = document.getElementById('btn-customize-apply');
  if (button) button.disabled = !enabled;
}

function renderCustomizationErrors(errors) {
  const node = document.getElementById('customize-errors');
  if (!node) return;
  node.innerHTML = '';
  node.style.color = 'var(--color-danger)';
  if (!errors || !errors.length) {
    node.innerText = '';
    return;
  }
  const list = document.createElement('ul');
  list.className = 'preview-list error-list';
  errors.forEach(error => {
    const item = document.createElement('li');
    item.innerText = `${error.field}: ${error.reason}`;
    list.appendChild(item);
  });
  node.appendChild(list);
}

function renderCustomizationEffects(effects, applied) {
  const card = document.getElementById('customize-preview-card');
  const node = document.getElementById('customize-effects');
  if (!card || !node) return;
  node.innerHTML = '';
  const line = text => {
    const item = document.createElement('p');
    item.className = 'customize-effect-line';
    item.innerText = text;
    node.appendChild(item);
  };
  (applied || []).forEach(entry => {
    if (entry.kind === 'pod_target_url') line(`Applied: pod target Ã¢â€ â€™ ${entry.value}`);
    else if (entry.kind === 'pod_region') line(`Applied: pod region Ã¢â€ â€™ ${entry.value}`);
    else if (entry.kind === 'workflow_allowlists') line(`Applied: workflow allowlists (${entry.channels} channel(s), ${entry.videos} video(s))`);
  });
  if (effects) {
    (effects.pod_changes || []).forEach(change => {
      if (change.target_url) line(`${change.name}: target ${change.target_url.from || '(none)'} Ã¢â€ â€™ ${change.target_url.to}`);
      if (change.region) line(`${change.name}: region Ã¢â€ â€™ ${change.region.label}`);
    });
    (effects.workflow_writes || []).forEach(write => {
      line(`${write.workflow_name}: allowlists Ã¢â€ Â ${write.channels.length} channel(s), ${write.videos.length} video(s)`);
    });
    line(`${effects.affected_profiles || 0} profile(s) inherit the new pod region.`);
    if ((effects.naming_examples || []).length) {
      line(`Names render as: ${effects.naming_examples.join(' Ã‚Â· ')}`);
    }
    const window = effects.next_window;
    if (window) {
      const fmt = value => value ? new Date(value).toLocaleString() : 'Ã¢â‚¬â€';
      line(window.is_open_now
        ? `Within the active window until ${fmt(window.closes_at)} (${window.timezone})`
        : `Next active window: ${fmt(window.opens_at)} Ã¢â€ â€™ ${fmt(window.closes_at)} (${window.timezone})`);
    }
  }
  card.style.display = 'block';
}

async function previewCustomization() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.preview_customization_inputs !== 'function') return;
  const payload = collectCustomizationPayload();
  const result = await api.preview_customization_inputs(payload);
  customizationPreview = result;
  if (!result.valid) {
    renderCustomizationErrors(result.errors || []);
    const card = document.getElementById('customize-preview-card');
    if (card) card.style.display = 'none';
    setCustomizationApplyEnabled(false);
    return;
  }
  renderCustomizationErrors([]);
  renderCustomizationEffects(result.effects, []);
  setCustomizationApplyEnabled(true);
}

async function applyCustomization() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('customize-feedback');
  if (typeof api?.apply_customization_inputs !== 'function') return;
  const payload = customizationPreview?.normalized || collectCustomizationPayload();
  const result = await api.apply_customization_inputs(payload);
  if (!result.success) {
    renderCustomizationErrors(result.errors || []);
    return;
  }
  renderCustomizationErrors([]);
  renderCustomizationEffects(result.effects || customizationPreview?.effects, result.applied || []);
  setCustomizationApplyEnabled(false);
  customizationState = { ...customizationState, inputs: result.inputs || payload };
  if (feedback) {
    feedback.innerText = `Applied ${(result.applied || []).length} change(s).`;
    feedback.style.color = 'var(--color-success, #22c55e)';
  }
}

function setupCustomizationUI() {
  document.getElementById('btn-customize-reload')?.addEventListener('click', () => {
    const view = document.getElementById('customize-tab')?.dataset.customizeView || 'campaigns';
    if (view === 'visibility') return window.WindowVisibility?.reload();
    if (view === 'safeguards') return loadSpendGuard();
    return loadCustomizationInputs(view);
  });
  document.getElementById('btn-customize-preview')?.addEventListener('click', () => previewCustomization());
  document.getElementById('btn-customize-apply')?.addEventListener('click', () => applyCustomization());
  document.getElementById('btn-personas-add')?.addEventListener('click', () => {
    const container = document.getElementById('personas-pool');
    if (container) container.appendChild(buildPoolRow(null));
  });
  document.getElementById('rhythm-days')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-rhythm-day]');
    if (chip) chip.setAttribute('aria-pressed', String(chip.classList.toggle('active')));
  });
}

// -- Consumers: the input layer is only real where it is read ---------------

function applySessionDurationDefault(sessionType) {
  const mix = customizationState?.inputs?.session_mix;
  const input = document.getElementById('session-duration-input');
  if (!input || !mix) return;
  const range = sessionType === 'target' ? mix.target_duration_minutes : mix.warmer_duration_minutes;
  if (Array.isArray(range) && range.length === 2) {
    input.value = Math.round((Number(range[0]) + Number(range[1])) / 2);
  }
}

function suggestProfileName() {
  const input = document.getElementById('profile-name-input');
  const pattern = customizationState?.inputs?.naming?.profile_pattern;
  if (!input || input.value.trim() || !pattern) return;
  const pod = podsById.get(selectedPodId);
  const index = ((pod && pod.profile_count) || 0) + 1;
  input.value = renderPatternClient(pattern, {
    pod: customizationSlug(pod?.name),
    archetype: 'profile',
    index,
    region: '',
  });
}

function renderPatternClient(pattern, values) {
  return pattern.replace(CUSTOMIZE_PATTERN_TOKENS, (match, token, spec) => {
    if (token === 'index') {
      const index = Number(values.index || 1);
      return spec && /^0\d*d$/.test(spec) ? String(index).padStart(2, '0') : String(index);
    }
    const value = values[token];
    return value === undefined || value === null ? '' : String(value);
  });
}


// ==========================================================================
// Deploy desk (Block E, E6)
// ==========================================================================

async function loadDeployTab() {
  const feedback = document.getElementById('deploy-feedback');
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_dispatch_options !== 'function') return;
  try {
    const [options, listing] = await Promise.all([api.get_dispatch_options(), api.list_dispatches(50)]);
    if (options.success) {
      dispatchOptions = options;
      renderDispatchComposerOptions();
    }
    if (listing.success) {
      dispatches = listing.dispatches || [];
      renderDeployments();
    }
    if (feedback) feedback.innerText = '';
  } catch (err) {
    if (feedback) {
      feedback.innerText = `Could not load deploy desk: ${err.message || err}`;
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

function renderDispatchComposerOptions() {
  if (!dispatchOptions) return;
  const workflowSelect = document.getElementById('dispatch-workflow-select');
  if (workflowSelect) {
    workflowSelect.innerHTML = '';
    // Wired 2026-10-10: the Session Mix inputs drive a session_mix dispatch
    // (Onboarding + target sessions by parts, durations from the bands).
    const mixOption = document.createElement('option');
    mixOption.value = '__session_mix__';
    mixOption.innerText = 'Session mix Ã¢â‚¬â€ Onboarding + target sessions by parts';
    workflowSelect.appendChild(mixOption);
    (dispatchOptions.workflows || []).forEach(workflow => {
      const option = document.createElement('option');
      option.value = workflow.id;
      option.innerText = workflow.provider_targeted ? `${workflow.name} (provider-targeted)` : workflow.name;
      workflowSelect.appendChild(option);
    });
  }
  const podSelect = document.getElementById('dispatch-target-pod');
  if (podSelect) {
    podSelect.innerHTML = '';
    (dispatchOptions.pods || []).forEach(pod => {
      const option = document.createElement('option');
      option.value = pod.id;
      option.innerText = `${pod.name} (${pod.profile_count} profile(s))`;
      podSelect.appendChild(option);
    });
  }
  const profileSelect = document.getElementById('dispatch-target-profiles');
  if (profileSelect) {
    profileSelect.innerHTML = '';
    (dispatchOptions.profiles || []).forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.innerText = profile.name;
      profileSelect.appendChild(option);
    });
  }
  const regionSelect = document.getElementById('dispatch-region');
  if (regionSelect) {
    regionSelect.innerHTML = '';
    (dispatchOptions.regions || []).forEach(region => {
      const option = document.createElement('option');
      option.value = region.id;
      option.innerText = `${region.name} Ã¢â‚¬â€ ${region.city}`;
      regionSelect.appendChild(option);
    });
  }
  const countrySelect = document.getElementById('dispatch-country');
  if (countrySelect) {
    countrySelect.innerHTML = '';
    (dispatchOptions.countries || []).forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.innerText = code;
      countrySelect.appendChild(option);
    });
  }
  const defaults = dispatchOptions.defaults || {};
  const defaultsNote = document.getElementById('dispatch-defaults-note');
  if (defaultsNote) {
    const concurrency = Math.max(1, Number(operationsSettings?.max_concurrency) || Number(defaults.max_concurrent_sessions) || 2);
    const show = (name, value) => { defaultsNote.querySelector(`[data-dispatch-limit="${name}"]`).textContent = value; };
    show('concurrency', String(concurrency));
    show('pacing', defaults.stagger_seconds == null ? 'Ã¢â‚¬â€' : `${defaults.stagger_seconds} s`);
    show('jitter', defaults.jitter_seconds == null ? 'Jitter unavailable' : defaults.jitter_seconds ? `Up to ${defaults.jitter_seconds} s jitter` : 'No jitter');
    show('daily-cap', defaults.per_profile_daily_cap == null ? 'Ã¢â‚¬â€' : `${defaults.per_profile_daily_cap} / profile`);
  }
  syncDispatchFieldVisibility();
}

function syncDispatchFieldVisibility() {
  const targetMode = document.getElementById('dispatch-target-mode')?.value || 'pod';
  toggleElementDisplay('dispatch-pod-group', targetMode === 'pod');
  toggleElementDisplay('dispatch-profiles-group', targetMode === 'profiles');
  const placementMode = document.getElementById('dispatch-placement-mode')?.value || 'inherit';
  toggleElementDisplay('dispatch-region-group', placementMode === 'metro');
  toggleElementDisplay('dispatch-country-group', placementMode === 'country');
  const cadenceMode = document.getElementById('dispatch-cadence-mode')?.value || 'now';
  toggleElementDisplay('dispatch-start-group', cadenceMode !== 'now');
  toggleElementDisplay('dispatch-interval-group', cadenceMode === 'recurring');
}

function toggleElementDisplay(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function collectDispatchPayload() {
  const intValue = (id, fallback) => {
    const parsed = parseInt(document.getElementById(id)?.value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const targetMode = document.getElementById('dispatch-target-mode')?.value || 'pod';
  const targets = targetMode === 'pod'
    ? { mode: 'pod', pod_id: document.getElementById('dispatch-target-pod')?.value || null }
    : {
        mode: 'profiles',
        profile_ids: Array.from(document.getElementById('dispatch-target-profiles')?.selectedOptions || [])
          .map(option => option.value),
      };
  const placementMode = document.getElementById('dispatch-placement-mode')?.value || 'inherit';
  const placement = { mode: placementMode };
  if (placementMode === 'metro') placement.region_id = document.getElementById('dispatch-region')?.value || null;
  if (placementMode === 'country') placement.country_code = document.getElementById('dispatch-country')?.value || null;
  const cadenceMode = document.getElementById('dispatch-cadence-mode')?.value || 'now';
  const cadence = { mode: cadenceMode };
  if (cadenceMode !== 'now') {
    const local = document.getElementById('dispatch-start-at')?.value;
    if (local) cadence.start_at = new Date(local).toISOString();
  }
  if (cadenceMode === 'recurring') cadence.interval_minutes = intValue('dispatch-interval-minutes', 60);
  const jobChoice = document.getElementById('dispatch-workflow-select')?.value || '';
  const job = jobChoice === '__session_mix__'
    ? { type: 'session_mix' }
    : { type: 'workflow', workflow_id: jobChoice };
  return {
    name: document.getElementById('dispatch-name')?.value.trim() || 'Untitled dispatch',
    job,
    targets,
    placement,
    cadence,
    budget: {
      max_concurrent_sessions: Math.max(1, Number(operationsSettings?.max_concurrency) || Number(dispatchOptions?.defaults?.max_concurrent_sessions) || 2),
    },
  };
}

function renderDispatchErrors(errors) {
  const node = document.getElementById('dispatch-errors');
  if (!node) return;
  node.innerHTML = '';
  node.style.color = 'var(--color-danger)';
  if (!errors || !errors.length) {
    node.innerText = '';
    return;
  }
  const list = document.createElement('ul');
  list.className = 'preview-list error-list';
  errors.forEach(error => {
    const item = document.createElement('li');
    item.innerText = `${error.field}: ${error.reason}`;
    list.appendChild(item);
  });
  node.appendChild(list);
}

function renderDispatchPlan(plan) {
  const card = document.getElementById('dispatch-preview-card');
  const node = document.getElementById('dispatch-plan');
  if (!card || !node) return;
  node.innerHTML = '';
  const line = (text, className) => {
    const item = document.createElement('p');
    item.className = className || 'dispatch-plan-line';
    item.innerText = text;
    node.appendChild(item);
  };
  line(`Job: ${plan.job?.workflow_name || plan.job?.workflow_id}`, 'dispatch-plan-heading');
  line(`${plan.included} of ${plan.targets_total} target(s) included Ã‚Â· placement ${plan.placement?.label}`);
  (plan.excluded || []).forEach(entry => {
    line(`Excluded: ${entry.profile_name} Ã¢â‚¬â€ ${entry.excluded_reason}`);
  });
  if ((plan.admission_timeline || []).length) {
    line('Admission timeline (estimated, jitter averaged):', 'dispatch-plan-heading');
    plan.admission_timeline.forEach(entry => {
      line(`  ${entry.profile_name} Ã¢â‚¬â€ t+${entry.at_seconds}s`);
    });
    if (plan.included > plan.admission_timeline.length) {
      line(`  Ã¢â‚¬Â¦ and ${plan.included - plan.admission_timeline.length} more`);
    }
  }
  const preflight = plan.admission_preflight || {};
  const refusals = preflight.expected_refusals || [];
  if (refusals.length) {
    line(`Admission preflight: ${refusals.length} of ${preflight.checked} included target(s) expect refusal Ã¢â‚¬â€ a routed dispatch sends every target through a region-matched exit.`, 'dispatch-plan-heading');
    refusals.slice(0, 6).forEach(row => line(`  ${row.profile_name} Ã¢â‚¬â€ ${row.reason}`));
    if (refusals.length > 6) line(`  Ã¢â‚¬Â¦ and ${refusals.length - 6} more`);
  }
  const cadence = plan.cadence || {};
  const cadenceBits = [`cadence ${cadence.mode}`];
  if (cadence.planned_start_at) cadenceBits.push(`start ${new Date(cadence.planned_start_at).toLocaleString()}`);
  if (cadence.interval_minutes) cadenceBits.push(`every ${cadence.interval_minutes}m`);
  line(cadenceBits.join(' Ã‚Â· '));
  (cadence.next_occurrences || []).forEach((stamp, index) => {
    line(`  occurrence ${index + 1}: ${new Date(stamp).toLocaleString()}`);
  });
  const budget = plan.budget || {};
  line(`Budget: max ${budget.max_concurrent_sessions} concurrent Ã‚Â· stagger ${budget.stagger_seconds}s Ã‚Â· jitter Ã‚Â±${budget.jitter_seconds}s Ã‚Â· cap ${budget.per_profile_daily_cap}/profile/day`);
  if (plan.mix) {
    const mix = plan.mix;
    line(`Session mix: warmer ${mix.warmer_ratio} : target ${mix.target_ratio} parts Ã‚Â· warmer ${(mix.warmer_minutes || []).join('Ã¢â‚¬â€œ')} min Ã‚Â· target ${(mix.target_minutes || []).join('Ã¢â‚¬â€œ')} min`);
    line(`  Planned sessions: ${mix.warmer_sessions ?? 0} Onboarding Ã‚Â· ${mix.target_sessions ?? 0} target`);
    (mix.assignments || []).slice(0, 10).forEach(item => {
      const suffix = item.downgraded_reason ? ` (downgraded from target Ã¢â‚¬â€ ${item.downgraded_reason})` : '';
      line(`  ${item.profile_name} Ã¢â‚¬â€ ${item.session_type === 'target' ? 'target watch' : 'Onboarding'}${suffix}`);
    });
  }
  const spend = plan.spend_estimate || {};
  if (spend.estimated_gb_per_day !== null && spend.estimated_gb_per_day !== undefined) {
    const cost = spend.estimated_cost_per_day !== null && spend.estimated_cost_per_day !== undefined
      ? ` Ã‚Â· Ã¢â€°Ë† $${Number(spend.estimated_cost_per_day).toFixed(4)}`
      : '';
    line(`Spend projection: Ã¢â€°Ë† ${Number(spend.estimated_gb_per_day).toFixed(3)} GB per day for the included targets${cost}${spend.price_basis ? ` (${spend.price_basis})` : ''}`);
  }
  line(`Spend: ${spend.note || 'pending'}`);
  const guard = spend.guard || {};
  const guardBits = [];
  if (guard.fleet_daily_gb != null) guardBits.push(`fleet ${guard.fleet_daily_gb} GB/day`);
  if (guard.fleet_daily_usd != null) guardBits.push(`fleet $${guard.fleet_daily_usd}/day`);
  if (guard.profile_daily_gb != null) guardBits.push(`profile ${guard.profile_daily_gb} GB/day`);
  if (guard.profile_daily_usd != null) guardBits.push(`profile $${guard.profile_daily_usd}/day`);
  if (guard.run_ceiling_mb != null) guardBits.push(`run ceiling ${guard.run_ceiling_mb} MB`);
  if (guardBits.length) line(`Spend guard: ${guardBits.join(' Ã‚Â· ')}`);
  if (!plan.provider_routing_enabled) {
    line('Provider routing is disabled (B1): provider-targeted workflows are refused until Session 2.');
  }
  card.style.display = 'block';
}

async function previewDispatch() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.preview_dispatch !== 'function') return;
  const payload = collectDispatchPayload();
  const result = await api.preview_dispatch(payload);
  dispatchPreview = result;
  if (!result.valid) {
    renderDispatchErrors(result.errors || []);
    toggleElementDisplay('dispatch-preview-card', false);
    setDispatchConfirmEnabled(false);
    return;
  }
  renderDispatchErrors([]);
  renderDispatchPlan(result.plan);
  setDispatchConfirmEnabled(true);
}

function setDispatchConfirmEnabled(enabled) {
  const button = document.getElementById('btn-dispatch-confirm');
  if (button) button.disabled = !enabled;
}

async function confirmDispatch() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('deploy-feedback');
  if (typeof api?.create_dispatch !== 'function') return;
  const payload = dispatchPreview?.normalized || collectDispatchPayload();
  const result = await api.create_dispatch(payload);
  if (!result.success) {
    renderDispatchErrors(result.errors || []);
    return;
  }
  renderDispatchErrors([]);
  setDispatchConfirmEnabled(false);
  let message = `Dispatch created: ${result.dispatch.name} (${result.dispatch.state}).`;
  if ((result.dispatch.cadence?.mode || 'now') === 'now') {
    const launched = await api.launch_dispatch(result.dispatch.id);
    if (launched.success) message += ' Deploying now.';
  }
  await loadDeployTab();
  if (feedback) {
    feedback.innerText = message;
    feedback.style.color = 'var(--color-success, #22c55e)';
  }
}

function dispatchStateBadgeClass(state) {
  if (state === 'RUNNING') return 'badge-running';
  if (state === 'COMPLETED') return 'badge-completed';
  if (state === 'FAILED') return 'badge-failed';
  if (state === 'CANCELLED') return 'badge-stopped';
  return 'badge-queued';
}

function renderDeployments() {
  const body = document.getElementById('deployments-body');
  if (!body) return;
  body.innerHTML = '';
  if (!dispatches.length) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--color-text-muted);">No dispatches yet Ã¢â‚¬â€ compose one above.</td></tr>';
    return;
  }
  dispatches.forEach(dispatch => {
    const row = document.createElement('tr');
    const progress = dispatch.progress || {};
    // Quiet run outcomes (the spend-guard ceiling stop is the loud one) stay
    // visible: surface the persisted stop attribution so the row never reads
    // "COMPLETED" while hiding a stopped run; fall back to raw statuses for
    // dispatches recorded before the attribution field existed.
    const runStops = Array.isArray(dispatch.outcome?.run_stops) ? dispatch.outcome.run_stops : null;
    const stopEntries = runStops
      ? runStops.map(entry => ({
        status: String(entry.status || 'STOPPED'),
        label: entry.error_class ? ` (${String(entry.error_class).replace(/_/g, ' ')})` : '',
        detail: entry.reason || '',
      }))
      : Object.values(dispatch.outcome?.run_statuses || {})
        .filter(status => status && status !== 'COMPLETED')
        .map(status => ({ status, label: '', detail: '' }));
    const stopGroups = new Map();
    stopEntries.forEach(entry => {
      const key = `${entry.status}${entry.label}`;
      const group = stopGroups.get(key) || { status: entry.status, label: entry.label, count: 0, details: [] };
      group.count += 1;
      if (entry.detail) group.details.push(entry.detail);
      stopGroups.set(key, group);
    });
    let runBits = '';
    stopGroups.forEach(group => {
      const color = group.status === 'FAILED' ? 'var(--color-danger)' : 'var(--color-warning, #e7bc72)';
      const title = group.details.length ? ` title="${escapeAttribute(group.details.join(' | '))}"` : '';
      runBits += ` \u00b7 <span style="color:${color};"${title}>${group.count} run${group.count > 1 ? 's' : ''} ${escapeHtml(group.status)}${escapeHtml(group.label)}</span>`;
    });
    const badge = `<span class="badge ${dispatchStateBadgeClass(dispatch.state)}">${escapeHtml(dispatch.state)}</span>`;
    const placement = dispatch.placement || {};
    const placementLabel = placement.mode === 'metro'
      ? `Metro ${placement.region_id || ''}`
      : placement.mode === 'country' ? `Country ${placement.country_code || ''}`
      : 'Inherit';
    const cadence = dispatch.cadence || {};
    const cadenceLabel = cadence.mode === 'recurring'
      ? `Recurring ${cadence.interval_minutes || '?'}m`
      : cadence.mode === 'window' ? `Window ${consoleFormatTime(cadence.start_at)}`
      : 'Now';
    row.innerHTML = `
      <td>${escapeHtml(dispatch.name)}</td>
      <td>${escapeHtml(dispatch.job?.workflow_name || dispatch.job?.workflow_id || 'Ã¢â‚¬â€')}</td>
      <td>${badge}</td>
      <td><small>${progress.admitted || 0}/${progress.total || 0} admitted Ã‚Â· ${progress.skipped || 0} skipped Ã‚Â· ${progress.failures || 0} failed${runBits}</small></td>
      <td>${escapeHtml(placementLabel)}</td>
      <td>${escapeHtml(cadenceLabel)}</td>
      <td><small>${escapeHtml(consoleFormatTime(dispatch.created_at))}</small></td>
      <td class="deploy-actions-cell"></td>`;
    const actionsCell = row.querySelector('.deploy-actions-cell');
    if (dispatch.state === 'PLANNED') {
      const deployButton = document.createElement('button');
      deployButton.className = 'btn btn-primary btn-sm';
      deployButton.type = 'button';
      deployButton.dataset.action = 'launch-dispatch';
      deployButton.dataset.dispatchId = dispatch.id;
      deployButton.innerText = 'Deploy now';
      actionsCell.appendChild(deployButton);
    }
    if (dispatch.state === 'PLANNED' || dispatch.state === 'RUNNING') {
      const cancelButton = document.createElement('button');
      cancelButton.className = 'btn btn-danger-outline btn-sm deploy-cancel';
      cancelButton.type = 'button';
      cancelButton.dataset.action = 'cancel-dispatch';
      cancelButton.dataset.dispatchId = dispatch.id;
      cancelButton.innerText = 'Cancel';
      actionsCell.appendChild(cancelButton);
    }
    body.appendChild(row);
  });
}

async function launchDispatchById(dispatchId) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.launch_dispatch !== 'function') return;
  await api.launch_dispatch(dispatchId);
  await loadDeployTab();
}

async function cancelDispatchById(dispatchId) {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('deploy-feedback');
  if (typeof api?.cancel_dispatch !== 'function') return;
  const result = await api.cancel_dispatch(dispatchId);
  await loadDeployTab();
  if (feedback) {
    feedback.innerText = result.success ? 'Dispatch cancelled.' : (result.error || 'Cancel refused.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
}

function scheduleDeployRefresh() {
  clearTimeout(deployRefreshTimer);
  deployRefreshTimer = setTimeout(() => {
    if (document.getElementById('deploy-tab')?.classList.contains('active')) loadDeployTab();
  }, 400);
}

function setupDeployUI() {
  document.getElementById('btn-deploy-reload')?.addEventListener('click', () => loadDeployTab());
  document.getElementById('btn-dispatch-preview')?.addEventListener('click', () => previewDispatch());
  document.getElementById('btn-dispatch-confirm')?.addEventListener('click', () => confirmDispatch());
  ['dispatch-target-mode', 'dispatch-placement-mode', 'dispatch-cadence-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', syncDispatchFieldVisibility);
  });
}


// ==========================================================================
// Manual & local task desk (Block E, E7)
// ==========================================================================

let localTasksPreviewValid = false;

async function loadManualTab() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_local_desk_options !== 'function') return;
  try {
    const options = await api.get_local_desk_options();
    if (options.success) {
      localDeskOptions = options;
      renderManualProfileOptions();
    }
    const sessions = await api.list_manual_sessions();
    if (sessions.success) manualSessions = sessions.sessions || [];
    const runs = await api.list_local_runs();
    if (runs.success) localRuns = runs.runs || [];
    renderManualSessions();
    renderLocalRuns();
  } catch (err) {
    console.error('Failed to load manual desk:', err);
  }
}

function renderManualProfileOptions() {
  const profiles = localDeskOptions?.profiles || [];
  ['manual-profile-select', 'local-profile-select'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.innerText = `${profile.name}${profile.pod_name ? ` (${profile.pod_name})` : ''}`;
      select.appendChild(option);
    });
    if (current) select.value = current;
  });
}

async function openManualBrowser() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('manual-feedback');
  if (typeof api?.launch_manual_session !== 'function') return;
  const profileId = document.getElementById('manual-profile-select')?.value;
  const url = document.getElementById('manual-url-input')?.value.trim() || '';
  if (!profileId) {
    if (feedback) feedback.innerText = 'Pick a profile first.';
    return;
  }
  const result = await api.launch_manual_session(profileId, url);
  if (feedback) {
    feedback.innerText = result.success ? result.message : (result.error || 'Could not open the browser.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
  await loadManualTab();
}

async function useScratchProfile() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('manual-feedback');
  if (typeof api?.ensure_scratch_profile !== 'function') return;
  const result = await api.ensure_scratch_profile();
  if (!result.success) {
    if (feedback) {
      feedback.innerText = result.error || 'Scratch profile unavailable.';
      feedback.style.color = 'var(--color-danger)';
    }
    return;
  }
  const options = await api.get_local_desk_options();
  if (options.success) {
    localDeskOptions = options;
    if (!(localDeskOptions.profiles || []).some(profile => profile.id === result.profile_id)) {
      localDeskOptions.profiles.unshift({
        id: result.profile_id,
        name: localDeskOptions.scratch?.profile_name || 'Scratch Browser',
        pod_id: null,
        pod_name: localDeskOptions.scratch?.pod_name || 'Local Scratch',
      });
    }
    renderManualProfileOptions();
    const manualSelect = document.getElementById('manual-profile-select');
    const localSelect = document.getElementById('local-profile-select');
    if (manualSelect) manualSelect.value = result.profile_id;
    if (localSelect) localSelect.value = result.profile_id;
  }
  if (feedback) {
    feedback.innerText = result.created ? 'Scratch profile created and selected.' : 'Scratch profile selected.';
    feedback.style.color = 'var(--color-success, #22c55e)';
  }
}

async function closeManualSession(sessionId) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.close_manual_session !== 'function') return;
  await api.close_manual_session(sessionId);
  await loadManualTab();
}

function renderManualSessions() {
  const body = document.getElementById('manual-sessions-body');
  if (!body) return;
  body.innerHTML = '';
  if (!manualSessions.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:18px; color:var(--color-text-muted);">No manual sessions yet.</td></tr>';
    return;
  }
  manualSessions.forEach(session => {
    const row = document.createElement('tr');
    const badgeClass = session.status === 'OPEN' ? 'badge-running'
      : session.status === 'CLOSED' ? 'badge-completed'
      : session.status === 'FAILED' ? 'badge-failed' : 'badge-stopped';
    row.innerHTML = `
      <td><span class="mono">${escapeHtml(session.session_id)}</span></td>
      <td>${escapeHtml(session.profile_name || session.profile_id)}</td>
      <td>${escapeHtml(session.url)}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(session.status)}</span></td>
      <td><small>${escapeHtml(consoleFormatTime(session.opened_at))}</small></td>
      <td class="manual-actions-cell"></td>`;
    const actionsCell = row.querySelector('.manual-actions-cell');
    if (session.status === 'OPEN' || session.status === 'OPENING') {
      const closeButton = document.createElement('button');
      closeButton.className = 'btn btn-danger-outline btn-sm';
      closeButton.type = 'button';
      closeButton.dataset.action = 'close-manual';
      closeButton.dataset.sessionId = session.session_id;
      closeButton.innerText = 'Close';
      actionsCell.appendChild(closeButton);
    }
    body.appendChild(row);
  });
}

async function previewLocalTasks() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('local-run-feedback');
  const previewEl = document.getElementById('local-task-preview');
  if (typeof api?.preview_local_tasks !== 'function') return;
  const targetUrl = document.getElementById('local-target-url')?.value.trim() || '';
  const tasks = document.getElementById('local-tasks-input')?.value || '';
  const result = await api.preview_local_tasks(targetUrl, tasks);
  localTasksPreviewValid = Boolean(result.valid);
  const runButton = document.getElementById('btn-local-run');
  if (runButton) runButton.disabled = !localTasksPreviewValid;
  if (!result.valid) {
    if (feedback) {
      feedback.innerText = 'Task list needs attention.';
      feedback.style.color = 'var(--color-danger)';
    }
    if (previewEl) {
      previewEl.style.display = 'block';
      previewEl.innerText = (result.errors || []).map(error => `line ${error.line}: ${error.reason}`).join('\n');
    }
    return;
  }
  if (feedback) {
    feedback.innerText = 'Task list valid.';
    feedback.style.color = 'var(--color-success, #22c55e)';
  }
  if (previewEl) {
    previewEl.style.display = 'block';
    previewEl.innerText = `${(result.tasks || []).length} task(s): `
      + (result.tasks || []).map(task => `${task.action}${task.argument ? ` ${task.argument}` : ''}`).join(' Ã‚Â· ');
  }
}

async function runLocalTasks() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('local-run-feedback');
  if (typeof api?.run_local_tasks !== 'function' || !localTasksPreviewValid) return;
  const profileId = document.getElementById('local-profile-select')?.value;
  const targetUrl = document.getElementById('local-target-url')?.value.trim() || '';
  const tasks = document.getElementById('local-tasks-input')?.value || '';
  const result = await api.run_local_tasks(profileId, targetUrl, tasks);
  if (feedback) {
    const reasons = (result.errors || [{ reason: result.error }]).map(item => item.reason).filter(Boolean);
    feedback.innerText = result.success ? result.message : (reasons.join(' Ã‚Â· ') || 'Could not start the run.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
  if (result.success) {
    localTasksPreviewValid = false;
    const runButton = document.getElementById('btn-local-run');
    if (runButton) runButton.disabled = true;
  }
  await loadManualTab();
}

async function cancelLocalRunById(runId) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.cancel_local_run !== 'function') return;
  await api.cancel_local_run(runId);
  await loadManualTab();
}

async function openLocalRunArtifacts(artifactsDir) {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (!artifactsDir || typeof api?.open_local_path !== 'function') return;
  await api.open_local_path(artifactsDir);
}

function renderLocalRuns() {
  const body = document.getElementById('local-runs-body');
  if (!body) return;
  body.innerHTML = '';
  if (!localRuns.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:18px; color:var(--color-text-muted);">No local runs yet.</td></tr>';
    return;
  }
  localRuns.forEach(run => {
    const row = document.createElement('tr');
    const badgeClass = run.status === 'RUNNING' ? 'badge-running'
      : run.status === 'COMPLETED' ? 'badge-completed'
      : run.status === 'FAILED' ? 'badge-failed' : 'badge-stopped';
    row.innerHTML = `
      <td><span class="mono table-id-full" title="${escapeAttribute(run.id)}">${escapeHtml(String(run.id))}</span></td>
      <td>${escapeHtml(run.profile_name || run.profile_id)}</td>
      <td>${escapeHtml(run.target_url || 'Ã¢â‚¬â€')}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(run.status)}</span></td>
      <td><small>${run.passed || 0}/${run.task_count || 0} passed</small></td>
      <td><small>${escapeHtml(consoleFormatTime(run.created_at))}</small></td>
      <td class="local-run-actions-cell"></td>`;
    const actionsCell = row.querySelector('.local-run-actions-cell');
    if (run.artifacts_dir) {
      const revealButton = document.createElement('button');
      revealButton.className = 'btn btn-secondary btn-sm';
      revealButton.type = 'button';
      revealButton.dataset.action = 'open-local-run';
      revealButton.dataset.artifactsDir = run.artifacts_dir;
      revealButton.innerText = 'Artifacts';
      actionsCell.appendChild(revealButton);
    }
    if (run.status === 'RUNNING' || run.status === 'QUEUED') {
      const cancelButton = document.createElement('button');
      cancelButton.className = 'btn btn-danger-outline btn-sm local-run-cancel';
      cancelButton.type = 'button';
      cancelButton.dataset.action = 'cancel-local-run';
      cancelButton.dataset.runId = run.id;
      cancelButton.innerText = 'Cancel';
      actionsCell.appendChild(cancelButton);
    }
    body.appendChild(row);
  });
}

function scheduleManualRefresh() {
  clearTimeout(manualRefreshTimer);
  manualRefreshTimer = setTimeout(() => {
    if (document.getElementById('manual-tab')?.classList.contains('active')) loadManualTab();
  }, 400);
}

function setupManualUI() {
  document.getElementById('btn-manual-reload')?.addEventListener('click', () => loadManualTab());
  document.getElementById('btn-manual-open')?.addEventListener('click', () => openManualBrowser());
  document.getElementById('btn-manual-scratch')?.addEventListener('click', () => useScratchProfile());
  document.getElementById('btn-local-preview')?.addEventListener('click', () => previewLocalTasks());
  document.getElementById('btn-local-run')?.addEventListener('click', () => runLocalTasks());
  setInterval(() => {
    if (document.getElementById('manual-tab')?.classList.contains('active')) loadManualTab();
  }, 15000);
}


// ==========================================================================
// Workspace portability (Block E, E8)
// ==========================================================================

let wsPreviewToken = null;

async function exportWorkspace() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('ws-export-feedback');
  if (typeof api?.export_workspace !== 'function') return;
  const passphrase = document.getElementById('ws-export-passphrase')?.value || '';
  const includeProfiles = Boolean(document.getElementById('ws-include-profiles')?.checked);
  if ((passphrase || '').length < 12) {
    if (feedback) {
      feedback.innerText = 'The export passphrase must be at least 12 characters.';
      feedback.style.color = 'var(--color-danger)';
    }
    return;
  }
  let outputPath = null;
  if (operationsSettings?.ask_export_location !== false) {
    const chosen = await api.choose_save_path(
      `Workspace Controller-workspace-${new Date().toISOString().slice(0, 10)}.workspace`,
      operationsSettings?.export_destination || '',
      ['Workspace Controller workspace (*.workspace)']
    );
    if (chosen?.cancelled) return;
    if (chosen?.success) outputPath = chosen.path;
  }
  if (feedback) {
    feedback.innerText = 'Exporting workspaceÃ¢â‚¬Â¦';
    feedback.style.color = 'var(--color-text-muted)';
  }
  const result = await api.export_workspace(passphrase, includeProfiles, outputPath);
  if (feedback) {
    feedback.innerText = result.success
      ? `${result.message} (${Math.round((result.size_bytes || 0) / 1024)} KB)`
      : (result.error || 'Export failed.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
}

async function chooseWorkspaceImport() {
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.choose_open_file !== 'function') return;
  const chosen = await api.choose_open_file(
    '', ['Workspace Controller workspace (*.workspace)', 'All files (*.*)']
  );
  if (!chosen.success) return;
  const input = document.getElementById('ws-import-path');
  if (input) input.value = chosen.path;
}

async function previewWorkspaceImport() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('ws-export-feedback');
  const summary = document.getElementById('ws-preview-summary');
  const confirmButton = document.getElementById('btn-ws-confirm');
  if (typeof api?.preview_workspace_import !== 'function') return;
  const archivePath = document.getElementById('ws-import-path')?.value.trim() || '';
  const passphrase = document.getElementById('ws-import-passphrase')?.value || '';
  if (!archivePath || !passphrase) {
    if (feedback) {
      feedback.innerText = 'Choose a workspace file and enter its passphrase first.';
      feedback.style.color = 'var(--color-danger)';
    }
    return;
  }
  const result = await api.preview_workspace_import(archivePath, passphrase, 'replace');
  wsPreviewToken = result.valid ? result.preview_token : null;
  if (confirmButton) confirmButton.disabled = !result.valid;
  if (!result.valid) {
    if (feedback) {
      feedback.innerText = (result.errors || [{ reason: 'Preview failed.' }]).map(item => item.reason).join(' ');
      feedback.style.color = 'var(--color-danger)';
    }
    if (summary) summary.innerText = '';
    return;
  }
  const counts = result.manifest?.counts || {};
  const lines = [
    `Workspace created ${result.manifest?.created_at || 'unknown'} Ã‚Â· app ${result.manifest?.app_version || '?'}`,
    Object.entries(counts).map(([key, value]) => `${key}: ${value}`).join(' Ã‚Â· '),
    result.manifest?.includes_profiles ? 'Profiles & cookies archive included.' : 'Profiles & cookies not included.',
    result.target?.populated
      ? `This install will be replaced (${Object.entries(result.target.counts || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}); pre-import backup Ã¢â€ â€™ ${result.target.will_backup_to}.`
      : 'Fresh install Ã¢â‚¬â€ nothing to replace.',
  ];
  if (feedback) {
    feedback.innerText = 'Preview valid Ã¢â‚¬â€ review and confirm.';
    feedback.style.color = 'var(--color-success, #22c55e)';
  }
  if (summary) summary.innerText = lines.join('\n');
}

async function confirmWorkspaceImport() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('ws-export-feedback');
  if (typeof api?.import_workspace !== 'function' || !wsPreviewToken) return;
  const archivePath = document.getElementById('ws-import-path')?.value.trim() || '';
  const passphrase = document.getElementById('ws-import-passphrase')?.value || '';
  const result = await api.import_workspace(archivePath, passphrase, wsPreviewToken);
  wsPreviewToken = null;
  const confirmButton = document.getElementById('btn-ws-confirm');
  if (confirmButton) confirmButton.disabled = true;
  if (feedback) {
    feedback.innerText = result.success ? result.message : (result.error || 'Import failed.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
}

function setupWorkspaceUI() {
  document.getElementById('btn-ws-export')?.addEventListener('click', () => exportWorkspace());
  document.getElementById('btn-ws-choose-import')?.addEventListener('click', () => chooseWorkspaceImport());
  document.getElementById('btn-ws-preview')?.addEventListener('click', () => previewWorkspaceImport());
  document.getElementById('btn-ws-confirm')?.addEventListener('click', () => confirmWorkspaceImport());
}


function setupNavigation() {
  const routes = {
    'pods-tab': ['operate', 'pods', 'Pods & Profiles', () => loadPods()],
    'workflows-tab': ['operate', 'workflows', 'YouTube Workflows', () => Promise.all([loadWorkflows(), loadWorkflowRuns()])],
    'deploy-tab': ['operate', 'deployments', 'Deployments', () => loadDeployTab()],
    'manual-tab': ['operate', 'manual', 'Manual Tasks', () => loadManualTab()],
    'monitor-tab': ['monitor', 'fleet', 'Fleet Monitor', () => loadFleetOverview()],
    'alerts-tab': ['monitor', 'pulse', 'Pulse', () => loadPulseBoard()],
    'console-tab': ['monitor', 'console', 'Command Console', () => activateConsoleTab()],
    'reports-tab': ['monitor', 'reports', 'Run Reports', () => loadReportingDashboard()],
    'customize-tab': ['configure', 'customization', 'Customization', () => loadCustomizationInputs()],
    'proxies-tab': ['configure', 'proxies', 'Proxy Inventory', () => loadProxies()],
    'operations-tab': ['system', 'operations', 'Operations', () => loadOperationsOverview()],
    'system-tab': ['system', 'health', 'System Health', () => loadOperationsOverview()],
  };
  const navItems = [...document.querySelectorAll('.nav-item')];
  const tabForPath = new Map(Object.entries(routes).map(([tabId, route]) => [`${route[0]}/${route[1]}`, tabId]));
  const activate = tabId => {
    const route = routes[tabId];
    const target = document.getElementById(tabId);
    if (!route || !target) return;
    navItems.forEach(item => {
      const selected = item.dataset.tab === tabId;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    document.body.classList.toggle('operations-active', tabId === 'operations-tab');
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane === target));
    document.querySelector('.content-scroll').scrollTop = 0;
    document.getElementById('view-title').textContent = route[2];
    document.querySelector('.topbar-eyebrow').textContent = route[0];
    window.MissionControl?.closeInfo();
    Promise.resolve(route[3]()).catch(error => console.error(`Could not load ${route[2]}:`, error));
  };
  const applyHashRoute = () => {
    const path = location.hash.replace(/^#\/?/, '');
    const operationsRoot = 'system/operations';
    const isOperationsRoute = path === operationsRoot || path.startsWith(`${operationsRoot}/`);
    const tabId = isOperationsRoute ? 'operations-tab' : (tabForPath.get(path) || (routes[path] ? path : 'pods-tab'));
    if (!path) {
      location.replace(`${location.pathname}${location.search}#/operate/pods`);
      return;
    }
    if (isOperationsRoute && document.getElementById('operations-tab')?.classList.contains('active')) {
      document.querySelector('.content-scroll').scrollTop = 0;
      window.MissionControl?.closeInfo();
    } else {
      activate(tabId);
    }
    if (isOperationsRoute) {
      window.MissionControl?.setOperationsView(path.slice(operationsRoot.length + 1) || 'overview');
    }
  };
  window.applyMissionRoute = applyHashRoute;
  navItems.forEach(button => button.addEventListener('click', () => {
    const route = routes[button.dataset.tab];
    if (!route) return;
    const nextHash = `#/${route[0]}/${route[1]}`;
    if (location.hash === nextHash) activate(button.dataset.tab);
    else location.hash = nextHash;
  }));
  window.addEventListener('hashchange', () => { if (appInitialized) applyHashRoute(); });
}

async function loadPersonas() {
  try {
    if (!window.desktopBridge || !window.desktopBridge.api.list_personas) return;
    personasCache = await window.desktopBridge.api.list_personas();
    const select = document.getElementById('session-persona-select');
    select.innerHTML = "";
    const group = document.createElement('optgroup');
    group.label = 'Personas';
    personasCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = `persona:${p.key}`;
      opt.innerText = `${p.name} (${p.categories.slice(0, 2).join(', ')})`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  } catch (err) {
    console.error("Failed to load personas:", err);
  }
}

async function refreshAuthStatus({ preserveActivationModal = false } = {}) {
  try {
    if (!window.desktopBridge || !window.desktopBridge.api.get_auth_status) return true;
    const auth = await window.desktopBridge.api.get_auth_status();
    const pill = document.getElementById('license-tier-text');
    const licensePill = document.getElementById('license-pill');
    const modal = document.getElementById('license-modal');
    const closeButton = document.getElementById('btn-close-license-modal');
    const cancelButton = document.getElementById('btn-cancel-license');
    const requestCode = document.getElementById('activation-request-code');
    const feedback = document.getElementById('license-feedback');
    activationLocked = !auth.authenticated;
    if (requestCode) requestCode.innerText = auth.request_code || 'Unavailable';

    if (!auth.activation_required && auth.authenticated) {
      pill.innerText = "Development access";
      pill.style.color = "var(--accent-primary, #38bdf8)";
      if (licensePill) {
        licensePill.title = "Source development mode is active";
        licensePill.style.cursor = "pointer";
      }
      if (modal && !preserveActivationModal) modal.style.display = 'none';
    } else if (auth.authenticated) {
      pill.innerText = "Device activated";
      pill.style.color = "var(--success, #10b981)";
      if (licensePill) {
        licensePill.title = "View device activation";
        licensePill.style.cursor = "pointer";
      }
      if (modal && !preserveActivationModal) modal.style.display = 'none';
    } else {
      pill.innerText = "Activation required";
      pill.style.color = "var(--warning, #f59e0b)";
      if (licensePill) {
        licensePill.title = "Activate this device";
        licensePill.style.cursor = "pointer";
      }
      if (feedback) feedback.innerText = auth.message || 'Enter the token issued for this device.';
      if (modal) modal.style.display = 'flex';
    }
    if (closeButton) closeButton.style.display = activationLocked ? 'none' : 'grid';
    if (cancelButton) cancelButton.style.display = activationLocked ? 'none' : 'inline-flex';
    document.body.classList.toggle('activation-gate-visible', Boolean(modal && modal.style.display !== 'none'));
    return Boolean(auth.authenticated);
  } catch (err) {
    console.error("Failed to check auth status:", err);
    return false;
  }
}

function playActivationFold(modal) {
  if (!modal || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const card = modal.querySelector('.activation-modal');
  return new Promise(resolve => {
    let fallbackTimer;
    const finish = () => {
      clearTimeout(fallbackTimer);
      card.removeEventListener('animationend', onAnimationEnd);
      resolve();
    };
    const onAnimationEnd = event => {
      if (event.target === card && event.animationName === 'activationFoldAway') finish();
    };
    card.addEventListener('animationend', onAnimationEnd);
    fallbackTimer = setTimeout(finish, 2100);
    modal.classList.add('activation-folding');
    document.body.classList.add('activation-opening');
  });
}

function setupModals() {
  // Pod modal
  const podModal = document.getElementById('create-pod-modal');
  document.getElementById('btn-open-create-pod').addEventListener('click', () => {
    podModal.style.display = 'flex';
  });
  document.getElementById('btn-close-pod-modal').addEventListener('click', () => {
    podModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-pod').addEventListener('click', () => {
    podModal.style.display = 'none';
  });
  document.getElementById('btn-submit-pod').addEventListener('click', async () => {
    const name = document.getElementById('pod-name-input').value.trim();
    const target = document.getElementById('pod-target-input').value.trim();
    if (!name) return alert("Pod name is required.");
    await window.desktopBridge.api.create_pod(name, target);
    podModal.style.display = 'none';
    document.getElementById('pod-name-input').value = "";
    document.getElementById('pod-target-input').value = "";
    await loadPods();
  });

  // Profile modal
  const profileModal = document.getElementById('create-profile-modal');

  // Region catalogue (roadmap B2): region drives timezone, locale and the proxy
  // pool. Absent in mocked UI harnesses, so the picker degrades to "unavailable"
  // rather than throwing when the modal opens.
  async function loadRegions() {
    const select = document.getElementById('profile-region-select');
    if (!select) return;
    const api = window.desktopBridge && window.desktopBridge.api;
    if (!api || typeof api.list_regions !== 'function') {
      select.innerHTML = '<option value="">Region unavailable</option>';
      return;
    }
    const result = await api.list_regions();
    const regions = (result && result.regions) || [];
    select.innerHTML = '';
    if (!regions.length) {
      select.innerHTML = '<option value="">No regions available</option>';
      return;
    }
    regions.forEach(region => {
      const option = document.createElement('option');
      option.value = region.id;
      option.innerText = `${region.name} (${region.timezone})`;
      select.appendChild(option);
    });
  }

  function resetProfileModalToCreate() {
    editingProfileId = null;
    document.getElementById('create-profile-title').innerText = 'Add Profile to Pod';
    document.getElementById('btn-submit-profile').innerText = 'Generate Profile';
    document.getElementById('profile-device-select').disabled = false;
    document.getElementById('profile-device-hint').hidden = true;
    document.getElementById('profile-region-select').disabled = false;
    document.getElementById('profile-region-hint').hidden = true;
    document.getElementById('profile-quality-select').value = '';
  }
  document.getElementById('btn-open-create-profile').addEventListener('click', async () => {
    resetProfileModalToCreate();
    await loadRegions();
    suggestProfileName();
    profileModal.style.display = 'flex';
  });
  document.getElementById('btn-close-profile-modal').addEventListener('click', () => {
    profileModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-profile').addEventListener('click', () => {
    profileModal.style.display = 'none';
  });
  document.getElementById('btn-submit-profile').addEventListener('click', async () => {
    const name = document.getElementById('profile-name-input').value.trim();
    const device = document.getElementById('profile-device-select').value;
    const region = document.getElementById('profile-region-select').value || null;
    const playbackQuality = document.getElementById('profile-quality-select').value;
    if (!name) return alert("Profile name is required.");
    if (!selectedPodId) return alert("No pod selected.");
    const result = editingProfileId
      ? await window.desktopBridge.api.update_profile(editingProfileId, name, region, playbackQuality)
      : await window.desktopBridge.api.create_profile(selectedPodId, name, device, region, playbackQuality);
    if (!result || result.success !== true) {
      return alert(`Could not ${editingProfileId ? 'update' : 'create'} profile: ${(result && result.error) || "unknown error"}`);
    }
    editingProfileId = null;
    profileModal.style.display = 'none';
    document.getElementById('profile-name-input').value = "";
    await selectPod(selectedPodId);
    await loadPods();
  });

  // Session Launch Modal
  const sessionModal = document.getElementById('launch-session-modal');
  document.getElementById('btn-close-session-modal').addEventListener('click', () => {
    sessionModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-session').addEventListener('click', () => {
    sessionModal.style.display = 'none';
  });
  document.getElementById('session-type-select').addEventListener('change', syncSessionModeFields);
  document.getElementById('btn-submit-session').addEventListener('click', async () => {
    await submitLaunchSession();
  });

  // Offline activation modal
  const licenseModal = document.getElementById('license-modal');
  document.getElementById('license-pill')?.addEventListener('click', async () => {
    await refreshAuthStatus();
    licenseModal.style.display = 'flex';
    document.body.classList.add('activation-gate-visible');
  });
  document.getElementById('btn-close-license-modal')?.addEventListener('click', () => {
    if (!activationLocked) {
      licenseModal.style.display = 'none';
      document.body.classList.remove('activation-gate-visible');
    }
  });
  document.getElementById('btn-cancel-license')?.addEventListener('click', () => {
    if (!activationLocked) {
      licenseModal.style.display = 'none';
      document.body.classList.remove('activation-gate-visible');
    }
  });
  document.getElementById('btn-copy-activation-request')?.addEventListener('click', async () => {
    const value = document.getElementById('activation-request-code').innerText.trim();
    const feedback = document.getElementById('license-feedback');
    try {
      await navigator.clipboard.writeText(value);
      feedback.innerText = 'Device request code copied.';
      feedback.style.color = 'var(--success)';
    } catch (err) {
      feedback.innerText = 'Select the request code and copy it manually.';
      feedback.style.color = 'var(--warning)';
    }
  });
  document.getElementById('btn-submit-license')?.addEventListener('click', async () => {
    const key = document.getElementById('license-key-input').value.trim();
    if (!key) return alert("Please enter the device activation token.");
    const activate = window.desktopBridge.api.activate_token || window.desktopBridge.api.save_license_key;
    const submitButton = document.getElementById('btn-submit-license');
    submitButton.disabled = true;
    let res;
    try {
      res = await activate(key);
      if (!res || typeof res !== 'object') throw new Error('Activation returned no result.');
    } catch (error) {
      res = { success: false, message: error?.message || 'Activation failed. Please try again.' };
    }
    const feedback = document.getElementById('license-feedback');
    feedback.innerText = res.message;
    feedback.style.color = res.success ? "var(--success)" : "var(--danger)";
    if (res.success) {
      const confirmed = await refreshAuthStatus({ preserveActivationModal: true });
      if (!confirmed) {
        feedback.innerText = 'Activation could not be confirmed. Please retry.';
        feedback.style.color = 'var(--danger)';
        submitButton.disabled = false;
        return;
      }
      activationLocked = false;
      document.getElementById('license-key-input').value = '';
      const folding = playActivationFold(licenseModal);
      const refresh = refreshBridgeData({ preserveActivationModal: true });
      const [, refreshResult] = await Promise.allSettled([folding, refresh]);
      if (refreshResult.status === 'rejected') console.error('Could not refresh after activation:', refreshResult.reason);
      licenseModal.style.display = 'none';
      document.body.classList.remove('activation-gate-visible');
      licenseModal.classList.remove('activation-folding');
      document.body.classList.remove('activation-opening');
      submitButton.disabled = false;
      if (!systemStatusInterval) systemStatusInterval = setInterval(refreshSystemStatus, 6000);
      window.applyMissionRoute?.();
      document.getElementById('view-title')?.focus?.({ preventScroll: true });
    } else {
      submitButton.disabled = false;
    }
  });

  // Minimize drawer
  const closeDrawerBtn = document.getElementById('btn-close-drawer');
  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', () => {
      liveDrawerMinimized = true;
      renderActiveSessions();
    });
  }
  document.getElementById('btn-restore-drawer')?.addEventListener('click', () => {
    liveDrawerMinimized = false;
    renderActiveSessions();
    window.dispatchEvent(new Event('resize'));
  });


  // Export Backup
  const exportBtn = document.getElementById('btn-export-backup');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const pass = document.getElementById('backup-passphrase-input').value;
      const feedback = document.getElementById('backup-feedback');
      if (!pass || pass.length < 12) {
        feedback.innerText = "Error: Passphrase must be at least 12 characters long.";
        feedback.style.color = "var(--danger)";
        return;
      }
      feedback.innerText = "Exporting profiles to encrypted archive...";
      feedback.style.color = "var(--text-muted)";
      let outputPath = null;
      if (operationsSettings?.ask_export_location !== false) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const chosen = await window.desktopBridge.api.choose_save_path(
          `Workspace Controller-profiles-${timestamp}.Workspace Controller`,
          operationsSettings?.export_destination || '',
          ['Workspace Controller profile archive (*.Workspace Controller)']
        );
        if (chosen.cancelled) {
          feedback.innerText = 'Export cancelled; no archive was created.';
          return;
        }
        if (!chosen.success) {
          feedback.innerText = `Export location failed: ${chosen.error}`;
          feedback.style.color = "var(--danger)";
          return;
        }
        outputPath = chosen.path;
      }
      const res = await window.desktopBridge.api.export_backup(pass, outputPath);
      if (res.success) {
        feedback.innerText = `Backup exported successfully: ${res.path} (${res.profiles_count} profiles)`;
        feedback.style.color = "var(--success)";
      } else {
        feedback.innerText = `Export failed: ${res.error}`;
        feedback.style.color = "var(--danger)";
      }
    });
  }

  document.getElementById('btn-choose-restore-backup')?.addEventListener('click', async () => {
    const chosen = await window.desktopBridge.api.choose_open_file(
      operationsSettings?.export_destination || '',
      ['Workspace Controller profile archive (*.Workspace Controller)']
    );
    if (chosen.success) document.getElementById('restore-path-input').value = chosen.path;
  });

  // Preview Restore Backup
  const restorePreviewBtn = document.getElementById('btn-preview-restore-backup');
  if (restorePreviewBtn) {
    restorePreviewBtn.addEventListener('click', async () => {
      const pass = document.getElementById('backup-passphrase-input').value;
      const archivePath = document.getElementById('restore-path-input').value.trim();
      const feedback = document.getElementById('backup-feedback');
      const summary = document.getElementById('restore-preview-summary');
      const restoreButton = document.getElementById('btn-restore-backup');
      restorePreviewToken = null;
      restoreButton.disabled = true;
      if (!archivePath || !pass || pass.length < 12) {
        feedback.innerText = "Enter an archive path and a passphrase of at least 12 characters.";
        feedback.style.color = "var(--danger)";
        return;
      }
      feedback.innerText = "Validating archive without changing local dataÃ¢â‚¬Â¦";
      const result = await window.desktopBridge.api.preview_restore_backup(archivePath, pass);
      if (!result.success) {
        feedback.innerText = result.error;
        feedback.style.color = "var(--danger)";
        return;
      }
      restorePreviewToken = result.preview_token;
      summary.innerText = `${result.profiles_to_add} profiles will be added; ${result.profiles_to_overwrite} will be overwritten; ${result.locked_profiles.length} are locked.`;
      feedback.innerText = result.can_restore ? "Preview complete. Review the changes, then confirm restore." : "Restore cannot proceed until the reported blockers are resolved.";
      feedback.style.color = result.can_restore ? "var(--success)" : "var(--danger)";
      restoreButton.disabled = !result.can_restore;
    });
  }

  // Restore Backup
  const restoreBtn = document.getElementById('btn-restore-backup');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      const pass = document.getElementById('backup-passphrase-input').value;
      const archivePath = document.getElementById('restore-path-input').value.trim();
      const feedback = document.getElementById('backup-feedback');
      if (!archivePath) {
        feedback.innerText = "Error: Please specify the path to the .Workspace Controller archive.";
        feedback.style.color = "var(--danger)";
        return;
      }
      if (!pass || pass.length < 12) {
        feedback.innerText = "Error: Passphrase must be at least 12 characters long.";
        feedback.style.color = "var(--danger)";
        return;
      }
      if (!restorePreviewToken) {
        feedback.innerText = "Preview the restore before confirming it.";
        feedback.style.color = "var(--danger)";
        return;
      }
      feedback.innerText = "Restoring profiles from the confirmed archive preview...";
      feedback.style.color = "var(--text-muted)";
      const res = await window.desktopBridge.api.restore_backup(archivePath, pass, restorePreviewToken);
      if (res.success) {
        restorePreviewToken = null;
        restoreBtn.disabled = true;
        feedback.innerText = res.message;
        feedback.style.color = "var(--success)";
        await loadPods();
      } else {
        feedback.innerText = `Restore failed: ${res.error}`;
        feedback.style.color = "var(--danger)";
      }
    });
  }

  // Delete Pod
  document.getElementById('btn-delete-selected-pod').addEventListener('click', async () => {
    if (!selectedPodId) return;
    if (confirm("Are you sure you want to delete this Pod and all its profiles?")) {
      await window.desktopBridge.api.delete_pod(selectedPodId);
      selectedPodId = null;
      document.getElementById('profile-section').style.display = 'none';
      await loadPods();
    }
  });

  setupWorkflowUI();
  setupReportingUI();
  setupConsoleUI();
  setupFleetUI();
  setupPulseUI();
  setupCustomizationUI();
  setupDeployUI();
  setupManualUI();
  setupWorkspaceUI();
}


async function refreshSystemStatus() {
  try {
    const status = await window.desktopBridge.api.get_system_status();
    document.getElementById('stat-concurrency').innerText = status.concurrency_limit;
    document.getElementById('stat-ram').innerText = `${status.ram_available_mb} MB`;
    document.getElementById('stat-cpu').innerText = `${status.cpu_used_pct}%`;
    const versionBadge = document.getElementById('app-version-badge');
    if (versionBadge) versionBadge.innerText = status.version || 'Version unavailable';
    const operationsVersion = document.getElementById('operations-version');
    if (operationsVersion) operationsVersion.innerText = status.version || 'Version unavailable';
  } catch (err) {
    console.error("Failed to refresh system status:", err);
  }
}

async function loadPods() {
  try {
    const pods = await window.desktopBridge.api.list_pods();
    podsById = new Map((pods || []).map(pod => [pod.id, pod]));
    const container = document.getElementById('pod-list-container');
    container.innerHTML = "";

    if (pods.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1;">No Pods configured yet. Click "New Pod" to begin.</p>`;
      selectedPodId = null;
      document.getElementById('profile-section').style.display = 'none';
      document.getElementById('pods-tab').classList.remove('has-selection');
      return;
    }

    pods.forEach(pod => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `pod-card ${selectedPodId === pod.id ? 'selected' : ''}`;
      card.dataset.podId = String(pod.id);
      card.setAttribute('aria-label', `View ${pod.name} profiles`);
      card.innerHTML = `
        <span class="pod-title">${escapeHtml(pod.name)}</span>
        <div class="target">${escapeHtml(pod.target_url || 'No target configured')}</div>
        <div class="meta">
          <span>${pod.profile_count} ${pod.profile_count === 1 ? 'profile' : 'profiles'}</span>
          <span>View profiles</span>
        </div>
      `;
      card.addEventListener('click', () => selectPod(pod.id, pod.name, pod.target_url));
      container.appendChild(card);
    });
    const selected = pods.find(pod => pod.id === selectedPodId) || pods[0];
    await selectPod(selected.id, selected.name, selected.target_url);
  } catch (err) {
    console.error("Failed to load pods:", err);
  }
}

function setupProxyUI() {
  const modal = document.getElementById('create-proxy-modal');
  document.getElementById('btn-open-create-proxy')?.addEventListener('click', async () => {
    document.getElementById('proxy-server-input').value = '';
    document.getElementById('proxy-username-input').value = '';
    document.getElementById('proxy-password-input').value = '';
    document.getElementById('proxy-type-select').value = 'datacenter';
    document.getElementById('proxy-health-url-input').value = '';
    document.getElementById('proxy-modal-feedback').innerText = '';
    const regionSelect = document.getElementById('proxy-region-select');
    const tierSelect = document.getElementById('proxy-tier-select');
    regionSelect.innerHTML = '<option value="">Not region-bound (direct / regional tests only)</option>';
    tierSelect.innerHTML = '<option value="">Unpriced Ã¢â‚¬â€ bandwidth is metered, but dollar budgets cannot include it</option>';
    const api = window.desktopBridge?.api;
    await Promise.all([
      (async () => {
        if (typeof api?.list_regions !== 'function') return;
        try {
          const result = await api.list_regions();
          (result?.regions || []).forEach(region => {
            const option = document.createElement('option');
            option.value = region.id;
            option.textContent = region.name;
            regionSelect.appendChild(option);
          });
        } catch (error) {
          console.error('Could not load proxy regions:', error);
        }
      })(),
      loadProxyTiers(),
    ]);
    proxyTiersCache.forEach(tier => {
      const option = document.createElement('option');
      option.value = tier.id;
      option.textContent = `${tier.name}${tier.price_per_gb != null ? ` Ã¢â‚¬â€ $${Number(tier.price_per_gb).toFixed(2)}/GB` : ''}`;
      tierSelect.appendChild(option);
    });
    modal.style.display = 'flex';
  });
  ['btn-close-proxy-modal', 'btn-cancel-proxy'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => { modal.style.display = 'none'; });
  });
  document.getElementById('btn-refresh-proxies')?.addEventListener('click', loadProxies);
  document.getElementById('btn-submit-proxy')?.addEventListener('click', submitProxy);
}

function formatOperationsBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function setOperationsFeedback(message, tone = 'muted', elementId = 'operations-feedback') {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.innerText = message || '';
  if (element.classList.contains('operations-status-chip')) {
    element.dataset.tone = tone;
    element.title = message || '';
    return;
  }
  element.style.color = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--text-muted)';
}

function scheduleTriggerLabel(schedule) {
  const trigger = schedule.trigger || {};
  if (schedule.trigger_type === 'interval') return `Every ${trigger.every} ${trigger.unit}`;
  const time = `${String(trigger.hour ?? 0).padStart(2, '0')}:${String(trigger.minute ?? 0).padStart(2, '0')}`;
  return schedule.trigger_type === 'weekly' ? `${(trigger.weekdays || []).join(', ')} at ${time}` : `Daily at ${time}`;
}

function applyRuntimeSettings(settings, renderOperationsForm = false) {
  operationsSettings = settings || {};
  // 2026-10-10: the launcher's headless/cursor checkboxes are initialized
  // when the session modal opens (openSessionModal) and belong to the
  // operator afterwards. A settings refresh must never re-stamp a choice
  // mid-composition - a live report: a chosen headless run launched headed
  // because this function mirrored browser_visible over the checkbox.

  if (!renderOperationsForm) return;
  document.getElementById('setting-browser-visible').checked = Boolean(operationsSettings.browser_visible);
  document.getElementById('setting-cursor-visible').checked = Boolean(operationsSettings.cursor_visible);
  document.getElementById('setting-concurrency').value = operationsSettings.max_concurrency || 2;
  document.getElementById('setting-proxy-health-url').value = operationsSettings.proxy_health_url || '';
  document.getElementById('setting-backup-destination').value = operationsSettings.backup_destination || '';
  document.getElementById('setting-diagnostics-destination').value = operationsSettings.diagnostics_destination || '';
  document.getElementById('setting-export-destination').value = operationsSettings.export_destination || '';
  document.getElementById('setting-ask-export-location').checked = operationsSettings.ask_export_location !== false;
}

async function loadRuntimeSettings() {
  const api = window.desktopBridge?.api;
  if (!api?.get_application_settings) return;
  try {
    const data = await api.get_application_settings();
    if (!data.success) throw new Error(data.error || 'Application settings unavailable.');
    applyRuntimeSettings(data.settings);
  } catch (error) {
    console.error('Failed to load application settings:', error);
  }
}

async function loadOperationsOverview() {
  const api = window.desktopBridge?.api;
  if (!api?.get_operations_overview) return;
  setOperationsFeedback('Loading operations stateÃ¢â‚¬Â¦');
  try {
    const data = await api.get_operations_overview();
    if (!data.success) throw new Error(data.error || 'Operations state unavailable.');
    applyRuntimeSettings(data.settings, true);
    const health = data.health || {};
    document.getElementById('ops-overall-health').innerText = health.overall || 'Unknown';
    document.getElementById('ops-database-health').innerText = health.database?.integrity === 'ok' ? 'Integrity OK' : (health.database?.status || 'Unknown');
    document.getElementById('ops-scheduler-health').innerText = health.runtime?.scheduler_running ? 'Running' : 'Stopped';
    document.getElementById('ops-disk-free').innerText = formatOperationsBytes(data.storage?.disk?.free_bytes);
    const systemStatus = document.getElementById('system-health-status');
    const systemRuntime = document.getElementById('system-runtime-health');
    const systemDatabase = document.getElementById('system-database-integrity');
    const systemScheduler = document.getElementById('system-scheduler-health');
    const systemResources = document.getElementById('system-resource-health');
    if (systemStatus) systemStatus.innerText = health.overall || 'Unknown';
    if (systemRuntime) systemRuntime.innerText = health.runtime?.running ? 'Running' : 'Stopped';
    if (systemDatabase) systemDatabase.innerText = health.database?.integrity === 'ok' ? 'Integrity OK' : (health.database?.status || 'Unknown');
    if (systemScheduler) systemScheduler.innerText = health.runtime?.scheduler_running ? 'Running' : 'Stopped';
    if (systemResources) {
      const cpu = Number(health.resources?.cpu_percent || 0).toFixed(0);
      const memory = Number(health.resources?.memory_percent || 0).toFixed(0);
      systemResources.innerText = `CPU ${cpu}% Ã‚Â· RAM ${memory}%`;
    }

    const storage = data.storage || { sizes: {}, paths: {}, profiles: [] };
    operationsSettings.data_root = storage.paths?.data_root || '';
    document.getElementById('operations-storage-summary').innerHTML = [
      ['Data root', storage.paths?.data_root || 'Ã¢â‚¬â€'],
      ['Database', formatOperationsBytes(storage.sizes?.database)],
      ['Profiles', formatOperationsBytes(storage.sizes?.profiles)],
      ['Backups', formatOperationsBytes(storage.sizes?.backups)]
    ].map(([label, value]) => `<div class="storage-summary-item">${escapeHtml(label)}<strong>${escapeHtml(String(value))}</strong></div>`).join('');

    operationsSchedules = data.schedules || [];
    const databaseBackupSchedule = operationsSchedules.find(schedule => schedule.id === 'database_backup');
    document.getElementById('setting-automatic-backups').checked = Boolean(databaseBackupSchedule?.enabled);
    const profilesBody = document.getElementById('operations-profiles-body');
    profilesBody.innerHTML = (storage.profiles || []).map(profile => `
      <tr><td><strong>${escapeHtml(profile.name)}</strong><small class="mono">${escapeHtml(profile.id)}</small></td><td>${formatOperationsBytes(profile.size_bytes)}</td><td><span class="badge ${profile.locked ? 'badge-running' : 'badge-green'}">${profile.locked ? 'Locked' : 'Available'}</span></td><td><div class="table-actions"><button class="btn btn-secondary btn-sm" data-compaction-mode="routine" data-profile-id="${escapeAttribute(profile.id)}" ${profile.locked ? 'disabled' : ''}>Routine</button><button class="btn btn-danger-outline btn-sm" data-compaction-mode="deep" data-profile-id="${escapeAttribute(profile.id)}" ${profile.locked ? 'disabled' : ''}>Deep preview</button></div></td></tr>`).join('') || '<tr><td colspan="4">No browser profiles yet.</td></tr>';

    document.getElementById('operations-backups-body').innerHTML = (data.backups || []).map(backup => `
      <tr><td>${backup.created_at ? escapeHtml(new Date(backup.created_at).toLocaleString()) : 'Ã¢â‚¬â€'}</td><td>${formatOperationsBytes(backup.size_bytes)}</td><td><span class="badge ${backup.status === 'COMPLETED' ? 'badge-green' : 'badge-red'}">${escapeHtml(backup.status)}</span></td><td>${escapeHtml(backup.reason || 'Ã¢â‚¬â€')}</td></tr>`).join('') || '<tr><td colspan="4">No database snapshots yet.</td></tr>';
    window.WorkspaceSchedules?.render(data);
    await refreshUpdateStatus();
    setOperationsFeedback('All systems current', 'success');
  } catch (error) {
    setOperationsFeedback(error?.message || String(error), 'danger');
  }
}

function setupOperationsUI() {
  document.getElementById('btn-operations-refresh')?.addEventListener('click', loadOperationsOverview);
  document.getElementById('btn-open-data-root')?.addEventListener('click', async () => {
    const result = await window.desktopBridge.api.open_local_path(operationsSettings?.data_root || '');
    if (!result.success) setOperationsFeedback(result.error, 'danger', 'data-move-feedback');
  });
  document.querySelectorAll('[data-path-picker]').forEach(button => {
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.dataset.pathPicker);
      const chosen = await window.desktopBridge.api.choose_directory(input?.value || '');
      if (chosen.success && input) input.value = chosen.path;
    });
  });
  document.getElementById('btn-save-operations-settings')?.addEventListener('click', async () => {
    const changes = {
      browser_visible: document.getElementById('setting-browser-visible').checked,
      cursor_visible: document.getElementById('setting-cursor-visible').checked,
      max_concurrency: Number(document.getElementById('setting-concurrency').value),
      proxy_health_url: document.getElementById('setting-proxy-health-url').value.trim() || null,
      backup_destination: document.getElementById('setting-backup-destination').value.trim(),
      diagnostics_destination: document.getElementById('setting-diagnostics-destination').value.trim(),
      export_destination: document.getElementById('setting-export-destination').value.trim(),
      ask_export_location: document.getElementById('setting-ask-export-location').checked
    };
    setOperationsFeedback('Saving validated settingsÃ¢â‚¬Â¦', 'muted', 'operations-settings-feedback');
    const result = await window.desktopBridge.api.update_application_settings(changes);
    if (!result.success) return setOperationsFeedback(result.error, 'danger', 'operations-settings-feedback');
    const backupToggle = await window.desktopBridge.api.set_schedule_enabled(
      'database_backup', document.getElementById('setting-automatic-backups').checked
    );
    if (!backupToggle.success) return setOperationsFeedback(backupToggle.error, 'danger', 'operations-settings-feedback');
    applyRuntimeSettings(result.settings, true);
    setOperationsFeedback('Settings saved. Concurrency changes apply to new launches.', 'success', 'operations-settings-feedback');
    await refreshSystemStatus();
  });
  document.getElementById('btn-database-backup-now')?.addEventListener('click', async () => {
    setOperationsFeedback('Creating and verifying a SQLite snapshotÃ¢â‚¬Â¦');
    const result = await window.desktopBridge.api.create_database_snapshot();
    setOperationsFeedback(result.success ? `Snapshot created: ${result.path} (${formatOperationsBytes(result.size_bytes)})` : result.error, result.success ? 'success' : 'danger');
    if (result.success) await loadOperationsOverview();
  });
  document.getElementById('btn-create-schedule')?.addEventListener('click', async () => {
    if (window.WorkspaceSchedules) return;
    const triggerType = document.getElementById('schedule-trigger').value;
    const taskType = document.getElementById('schedule-task').value;
    const [hour, minute] = (document.getElementById('schedule-time').value || '00:00').split(':').map(Number);
    const trigger = triggerType === 'interval'
      ? { every: Number(document.getElementById('schedule-interval').value), unit: document.getElementById('schedule-unit').value }
      : { hour, minute, ...(triggerType === 'weekly' ? { weekdays: document.getElementById('schedule-weekdays').value.split(',').map(value => value.trim()).filter(Boolean) } : {}) };
    const payload = taskType === 'workflow_run' ? {
      workflow_id: document.getElementById('schedule-workflow-id').value.trim(),
      profile_id: document.getElementById('schedule-profile-id').value.trim(),
      browser_visible: operationsSettings?.browser_visible ?? true,
      cursor_visible: operationsSettings?.cursor_visible ?? true
    } : {};
    const existing = scheduleEditingId ? operationsSchedules.find(item => item.id === scheduleEditingId) : null;
    const data = { name: document.getElementById('schedule-name').value.trim(), job_type: taskType === 'workflow_run' ? 'workflow' : 'maintenance', task_type: taskType, enabled: existing ? existing.enabled : true, trigger_type: triggerType, trigger, timezone: document.getElementById('schedule-timezone').value.trim(), payload };
    const result = await window.desktopBridge.api.save_schedule(data, scheduleEditingId);
    setOperationsFeedback(result.success ? (scheduleEditingId ? 'Schedule updated.' : 'Schedule created.') : result.error, result.success ? 'success' : 'danger', 'schedule-feedback');
    if (result.success) {
      scheduleEditingId = null;
      document.getElementById('btn-create-schedule').innerText = 'Create Schedule';
      await loadOperationsOverview();
    }
  });
  document.getElementById('operations-schedules-body')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-schedule-action]');
    if (!button) return;
    const action = button.dataset.scheduleAction;
    const id = button.dataset.scheduleId;
    button.disabled = true;
    let result;
    if (action === 'edit') {
      const schedule = operationsSchedules.find(item => item.id === id);
      if (!schedule) return;
      scheduleEditingId = id;
      document.getElementById('schedule-name').value = schedule.name;
      document.getElementById('schedule-task').value = schedule.task_type;
      document.getElementById('schedule-trigger').value = schedule.trigger_type;
      document.getElementById('schedule-time').value = `${String(schedule.trigger?.hour ?? 0).padStart(2, '0')}:${String(schedule.trigger?.minute ?? 0).padStart(2, '0')}`;
      document.getElementById('schedule-interval').value = schedule.trigger?.every || 1;
      document.getElementById('schedule-unit').value = schedule.trigger?.unit || 'days';
      document.getElementById('schedule-weekdays').value = (schedule.trigger?.weekdays || []).join(',');
      document.getElementById('schedule-timezone').value = schedule.timezone || 'UTC';
      document.getElementById('schedule-workflow-id').value = schedule.payload?.workflow_id || '';
      document.getElementById('schedule-profile-id').value = schedule.payload?.profile_id || '';
      document.getElementById('btn-create-schedule').innerText = 'Save Schedule';
      setOperationsFeedback('Editing schedule. Update the structured fields and save.', 'success', 'schedule-feedback');
      return;
    } else if (action === 'toggle') result = await window.desktopBridge.api.set_schedule_enabled(id, button.dataset.enabled !== 'true');
    else if (action === 'run') result = await window.desktopBridge.api.run_schedule_now(id);
    else if (action === 'duplicate') result = await window.desktopBridge.api.duplicate_schedule(id);
    else if (action === 'reset') result = confirm('Reset this built-in schedule to its Phase 6 default?') ? await window.desktopBridge.api.reset_builtin_schedule(id) : { success: false, error: 'Reset cancelled.' };
    else if (action === 'delete') result = confirm('Delete this schedule definition and keep its history?') ? await window.desktopBridge.api.delete_schedule(id) : { success: false, error: 'Deletion cancelled.' };
    setOperationsFeedback(result?.success ? `Schedule action Ã¢â‚¬Å“${action}Ã¢â‚¬Â completed.` : result?.error, result?.success ? 'success' : 'danger', 'schedule-feedback');
    await loadOperationsOverview();
  });
  document.getElementById('operations-profiles-body')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-compaction-mode]');
    if (!button) return;
    const mode = button.dataset.compactionMode;
    const profileId = button.dataset.profileId;
    button.disabled = true;
    const preview = await window.desktopBridge.api.preview_profile_compaction(profileId, mode);
    if (!preview.success) {
      setOperationsFeedback(preview.error, 'danger', 'compaction-feedback');
      button.disabled = false;
      return;
    }
    const pathCount = (preview.paths || []).length;
    const prompt = `${mode === 'deep' ? 'Deep' : 'Routine'} preview: ${formatOperationsBytes(preview.bytes_reclaimable)} across ${pathCount} cache paths. Continue?${mode === 'deep' ? ' Deep mode also clears Service Worker CacheStorage and ScriptCache.' : ''}`;
    if (!confirm(prompt)) {
      setOperationsFeedback('Compaction preview completed; no files were changed.', 'success', 'compaction-feedback');
      button.disabled = false;
      return;
    }
    const result = await window.desktopBridge.api.compact_profile_cache(profileId, mode, mode === 'deep');
    setOperationsFeedback(result.success ? `Compaction completed: ${formatOperationsBytes(result.bytes_freed)} reclaimed.` : result.error, result.success ? 'success' : 'danger', 'compaction-feedback');
    await loadOperationsOverview();
  });
  document.getElementById('btn-recover-locks')?.addEventListener('click', async () => {
    const result = await window.desktopBridge.api.recover_stale_profile_locks();
    setOperationsFeedback(result.success ? `Recovered ${result.recovered.length} stale locks; ${result.active.length} active locks preserved.` : result.error, result.success ? 'success' : 'danger', 'data-move-feedback');
    if (result.success) await loadOperationsOverview();
  });
  document.getElementById('btn-preview-data-move')?.addEventListener('click', async () => {
    const destination = document.getElementById('data-relocation-destination').value.trim();
    const result = await window.desktopBridge.api.preview_data_relocation(destination);
    dataMovePreviewToken = result.success && result.can_move ? result.preview_token : null;
    document.getElementById('btn-execute-data-move').disabled = !dataMovePreviewToken;
    setOperationsFeedback(result.success ? `Move preview: ${formatOperationsBytes(result.source_size_bytes)} to ${result.destination}. Original retained. ${result.can_move ? 'Ready.' : 'Blocked.'}` : result.error, result.success && result.can_move ? 'success' : 'danger', 'data-move-feedback');
  });
  document.getElementById('btn-execute-data-move')?.addEventListener('click', async () => {
    if (!dataMovePreviewToken || !confirm('Copy and verify application data, select it for the next startup, and retain the original?')) return;
    const result = await window.desktopBridge.api.execute_data_relocation(dataMovePreviewToken);
    dataMovePreviewToken = null;
    document.getElementById('btn-execute-data-move').disabled = true;
    setOperationsFeedback(result.success ? 'Verified copy completed. Restart Workspace Controller to use the new data root; the original was retained.' : result.error, result.success ? 'success' : 'danger', 'data-move-feedback');
  });
  document.getElementById('btn-diagnostics-preview')?.addEventListener('click', async () => {
    const preview = await window.desktopBridge.api.preview_diagnostic_export();
    if (!preview.success) return setOperationsFeedback(preview.error, 'danger');
    const approved = confirm(`Diagnostic export includes:\nÃ¢â‚¬Â¢ ${preview.includes.join('\nÃ¢â‚¬Â¢ ')}\n\nIt excludes:\nÃ¢â‚¬Â¢ ${preview.excludes.join('\nÃ¢â‚¬Â¢ ')}\n\nCreate the redacted ZIP?`);
    if (!approved) return setOperationsFeedback('Diagnostic preview completed; no export was created.', 'success');
    let destination = null;
    if (operationsSettings?.ask_export_location !== false) {
      const chosen = await window.desktopBridge.api.choose_directory(operationsSettings?.diagnostics_destination || '');
      if (chosen.cancelled) return setOperationsFeedback('Diagnostic export cancelled.', 'success');
      if (!chosen.success) return setOperationsFeedback(chosen.error, 'danger');
      destination = chosen.path;
    }
    const result = await window.desktopBridge.api.export_diagnostics(destination);
    setOperationsFeedback(result.success ? `Diagnostic ZIP created: ${result.path}` : result.error, result.success ? 'success' : 'danger');
  });
  document.getElementById('btn-check-updates')?.addEventListener('click', checkForUpdates);
  document.getElementById('btn-choose-update-package')?.addEventListener('click', chooseUpdatePackage);
  document.getElementById('btn-stage-update-package')?.addEventListener('click', stageUpdatePackage);
  document.getElementById('btn-launch-staged-update')?.addEventListener('click', () => launchUpdateInstaller(false));
  document.getElementById('btn-launch-rollback')?.addEventListener('click', () => launchUpdateInstaller(true));
  document.getElementById('btn-preview-uninstall')?.addEventListener('click', previewFullPrivacyUninstall);
  document.getElementById('uninstall-confirmation-input')?.addEventListener('input', refreshUninstallAuthorization);
  document.getElementById('btn-confirm-uninstall')?.addEventListener('click', prepareFullPrivacyUninstall);
}

function refreshUninstallAuthorization() {
  const input = document.getElementById('uninstall-confirmation-input');
  const button = document.getElementById('btn-confirm-uninstall');
  if (!input || !button) return;
  button.disabled = !uninstallPreview?.packaged_build || uninstallPreview?.active_work || input.value !== 'REMOVE Workspace Controller';
}

async function previewFullPrivacyUninstall() {
  const feedback = document.getElementById('uninstall-feedback');
  const details = document.getElementById('uninstall-preview-details');
  feedback.innerText = 'Inspecting managed data and active workÃ¢â‚¬Â¦';
  feedback.style.color = 'var(--text-muted)';
  const result = await window.desktopBridge.api.preview_full_privacy_uninstall();
  uninstallPreview = result.success ? result : null;
  if (!result.success) {
    details.innerText = 'No paths were changed.';
    feedback.innerText = result.error;
    feedback.style.color = 'var(--danger)';
    refreshUninstallAuthorization();
    return;
  }
  const external = result.external_generated_files || [];
  details.innerHTML = `
    <div><span>Application</span><strong>${escapeHtml(result.application_path || 'Source development build Ã¢â‚¬â€ removal disabled')}</strong></div>
    <div><span>Managed data</span><strong>${escapeHtml(result.data_root || 'Ã¢â‚¬â€')} Ã‚Â· ${formatOperationsBytes(result.sizes?.total_data_root)}</strong></div>
    <div><span>Control data</span><strong>${escapeHtml(result.control_directory || 'Ã¢â‚¬â€')}</strong></div>
    <div><span>Browser profiles</span><strong>${escapeHtml(String(result.profile_count || 0))}</strong></div>
    <div><span>Configured external exports</span><strong>${escapeHtml(String(external.length))} file(s), excluded by default</strong></div>
    <ul>${(result.will_remove || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  feedback.innerText = result.active_work
    ? 'Stop all active sessions and workflows before removal.'
    : result.packaged_build
      ? `${result.manual_delete_warning} Review the paths, then type the confirmation exactly.`
      : 'Full privacy removal is enabled only inside a packaged macOS or Windows build.';
  feedback.style.color = result.active_work || !result.packaged_build ? 'var(--warning)' : 'var(--danger)';
  refreshUninstallAuthorization();
}

async function prepareFullPrivacyUninstall() {
  const input = document.getElementById('uninstall-confirmation-input');
  const includeExternal = document.getElementById('uninstall-include-external').checked;
  const feedback = document.getElementById('uninstall-feedback');
  if (!uninstallPreview || input.value !== 'REMOVE Workspace Controller') return;
  const externalCount = (uninstallPreview.external_generated_files || []).length;
  const warning = `Permanently remove the packaged application and all managed local data after a clean shutdown?${includeExternal ? ` This also selects ${externalCount} discovered external export file(s).` : ' External exports remain untouched.'}`;
  if (!confirm(warning)) return;
  document.getElementById('btn-confirm-uninstall').disabled = true;
  feedback.innerText = 'Preparing exact-path removal and shutting down safelyÃ¢â‚¬Â¦';
  feedback.style.color = 'var(--danger)';
  const result = await window.desktopBridge.api.prepare_full_privacy_uninstall(input.value, includeExternal);
  if (!result.success) {
    feedback.innerText = result.error;
    refreshUninstallAuthorization();
    return;
  }
  feedback.innerText = 'Removal helper prepared. Workspace Controller will close, then delete only the previewed targets.';
}

async function refreshUpdateStatus() {
  const feedback = document.getElementById('update-feedback');
  if (!feedback || !window.desktopBridge?.api?.get_update_status) return;
  const status = await window.desktopBridge.api.get_update_status();
  const packages = status.packages || {};
  document.getElementById('btn-launch-staged-update').disabled = !packages.staged;
  document.getElementById('btn-launch-rollback').disabled = !packages.rollback;
  if (!packages.configured) {
    feedback.innerText = 'Update verification is unavailable because this build has no public update key.';
    feedback.style.color = 'var(--warning)';
  } else if (packages.staged) {
    feedback.innerText = `Verified update ${packages.staged.version} is staged.${packages.rollback ? ` Previous ${packages.rollback.version} is retained for rollback.` : ''}`;
    feedback.style.color = 'var(--success)';
  } else {
    feedback.textContent = '';
    feedback.style.color = '';
  }
}

async function checkForUpdates() {
  const feedback = document.getElementById('update-feedback');
  feedback.innerText = 'Checking the configured signed release manifestÃ¢â‚¬Â¦';
  feedback.style.color = 'var(--text-muted)';
  const result = await window.desktopBridge.api.check_for_updates();
  if (result.status === 'disabled') {
    feedback.innerText = result.error;
    feedback.style.color = 'var(--warning)';
  } else if (result.has_update) {
    feedback.innerText = `Version ${result.latest_version} is available. Download its signed .update package, then choose it here.`;
    feedback.style.color = 'var(--success)';
  } else if (result.status === 'up_to_date') {
    feedback.innerText = `Workspace Controller ${result.current_version} is up to date.`;
    feedback.style.color = 'var(--success)';
  } else {
    feedback.innerText = `Update check could not complete: ${result.error || result.status}`;
    feedback.style.color = 'var(--danger)';
  }
}

async function chooseUpdatePackage() {
  const feedback = document.getElementById('update-feedback');
  const chosen = await window.desktopBridge.api.choose_open_file(
    operationsSettings?.export_destination || '',
    ['Workspace Controller signed update (*.update)']
  );
  if (chosen.cancelled) return;
  if (!chosen.success) {
    feedback.innerText = chosen.error;
    feedback.style.color = 'var(--danger)';
    return;
  }
  const inspection = await window.desktopBridge.api.inspect_update_package(chosen.path);
  if (!inspection.success) {
    selectedUpdatePackagePath = null;
    document.getElementById('btn-stage-update-package').disabled = true;
    feedback.innerText = `Package rejected: ${inspection.error}`;
    feedback.style.color = 'var(--danger)';
    return;
  }
  selectedUpdatePackagePath = chosen.path;
  document.getElementById('btn-stage-update-package').disabled = false;
  feedback.innerText = `Verified package ${inspection.version} for ${inspection.platform} (${formatOperationsBytes(inspection.payload_size)}). Review the release notes, then stage it.`;
  feedback.style.color = 'var(--success)';
}

async function stageUpdatePackage() {
  if (!selectedUpdatePackagePath) return;
  if (!confirm('Create a pre-update database snapshot and stage this verified installer?')) return;
  const feedback = document.getElementById('update-feedback');
  feedback.innerText = 'Verifying package again and creating the pre-update snapshotÃ¢â‚¬Â¦';
  feedback.style.color = 'var(--text-muted)';
  const result = await window.desktopBridge.api.stage_update_package(selectedUpdatePackagePath);
  feedback.innerText = result.success ? `Update ${result.version} staged. Pre-update snapshot: ${result.pre_update_backup}` : result.error;
  feedback.style.color = result.success ? 'var(--success)' : 'var(--danger)';
  if (result.success) {
    selectedUpdatePackagePath = null;
    document.getElementById('btn-stage-update-package').disabled = true;
    await refreshUpdateStatus();
  }
}

async function launchUpdateInstaller(rollback) {
  const description = rollback ? 'the retained previous installer' : 'the staged update installer';
  if (!confirm(`Open ${description}? Workspace Controller will not install anything silently.`)) return;
  const result = await window.desktopBridge.api.launch_staged_update(Boolean(rollback));
  const feedback = document.getElementById('update-feedback');
  feedback.innerText = result.success ? `Installer opened for version ${result.version}. Complete it manually, then restart Workspace Controller.` : result.error;
  feedback.style.color = result.success ? 'var(--success)' : 'var(--danger)';
}

let proxyTiersCache = [];

async function loadProxyTiers() {
  const api = window.desktopBridge?.api;
  proxyTiersCache = [];
  if (typeof api?.list_proxy_tiers !== 'function') return;
  try {
    const result = await api.list_proxy_tiers();
    if (!result?.success) throw new Error(result?.error || 'Tier list unavailable.');
    proxyTiersCache = result.tiers || [];
  } catch (error) {
    console.error('Could not load proxy tiers:', error);
  }
}

async function updateProxyTier(proxyId, tierId) {
  const feedback = document.getElementById('proxy-feedback');
  const api = window.desktopBridge?.api;
  if (typeof api?.update_proxy_tier_assignment !== 'function') {
    feedback.textContent = 'Tier assignments are unavailable in this connection.';
    await loadProxies();
    return;
  }
  try {
    const result = await api.update_proxy_tier_assignment(proxyId, tierId);
    feedback.textContent = result?.success ? 'Tier assignment updated.' : (result?.error || 'Tier assignment failed.');
  } catch (error) {
    feedback.textContent = `Tier assignment failed: ${error.message || error}`;
  }
  await loadProxies();
}

async function loadProxies() {
  if (!window.desktopBridge?.api?.list_proxies) return;
  const body = document.getElementById('proxy-table-body');
  if (!body) return;
  try {
    await loadProxyTiers();
    const proxies = await window.desktopBridge.api.list_proxies();
    body.innerHTML = '';
    if (!proxies.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--color-text-muted);">No proxies configured. Ordinary runs use the direct connection; add one only for explicit regional testing.</td></tr>';
      return;
    }
    proxies.forEach(proxy => {
      const row = document.createElement('tr');
      const reputation = proxy.reputation || {};
      const total = Number(reputation.total_requests || 0);
      const successes = Number(reputation.youtube_successes || 0);
      const reliability = total ? `${Math.round((successes / total) * 100)}% Ã‚Â· ${total} samples` : 'No samples';
      const location = [proxy.city, proxy.country].filter(Boolean).join(', ') || 'Unresolved';
      const statusClass = proxy.status === 'ACTIVE' ? 'badge-green' : 'badge-red';
      const tierOptions = ['<option value="">Unpriced</option>'].concat(proxyTiersCache.map(tier =>
        `<option value="${escapeAttribute(tier.id)}"${tier.id === proxy.tier_id ? ' selected' : ''}>${escapeHtml(tier.name)}${tier.price_per_gb != null ? ` Ã¢â‚¬â€ $${Number(tier.price_per_gb).toFixed(2)}/GB` : ''}</option>`));
      window.MissionControl?.setDetails(`proxy:${proxy.id}`, {
        title: proxy.server,
        subtitle: `${proxy.proxy_type} Ã‚Â· ${proxy.status}`,
        rows: [
          ['Priced tier', proxy.tier_name || 'Unpriced'],
          ['Location', location],
          ['Timezone', proxy.timezone || 'Unresolved'],
          ['ASN', proxy.asn || 'Unresolved'],
          ['Health destination', proxy.health_check_url || 'Global Operations setting'],
          ['Last checked', proxy.last_checked_at ? consoleFormatTime(proxy.last_checked_at) : 'Never'],
          ['Requests / failures', `${total} / ${Number(reputation.failed_requests || 0)}`],
          ['YouTube successes', Number(reputation.youtube_successes || 0)],
          ['Reliability', reliability],
          ['Average latency', reputation.average_latency_ms ? `${Math.round(reputation.average_latency_ms)}ms` : 'No samples'],
          ['Assignment', proxy.assigned_profile_id ? 'Assigned profile recorded' : 'Unassigned'],
        ],
        note: 'Stored passwords and encrypted credentials are not displayed.',
      });
      row.innerHTML = `
        <td><span class="mono">${escapeHtml(proxy.server)}</span>${proxy.username ? `<small> Ã‚Â· ${escapeHtml(proxy.username)}</small>` : ''}</td>
        <td>${escapeHtml(proxy.proxy_type)}</td>
        <td><select class="input-field" data-tier-select aria-label="Priced tier for ${escapeAttribute(proxy.server)}"${typeof window.desktopBridge?.api?.update_proxy_tier_assignment === 'function' ? '' : ' disabled'}>${tierOptions.join('')}</select></td>
        <td>${escapeHtml(location)}${proxy.timezone ? `<small> Ã‚Â· ${escapeHtml(proxy.timezone)}</small>` : ''}</td>
        <td>${escapeHtml(proxy.asn || 'Ã¢â‚¬â€')}</td>
        <td><span class="badge ${statusClass}">${escapeHtml(proxy.status)}</span></td>
        <td>${escapeHtml(reliability)}${reputation.average_latency_ms ? `<small> Ã‚Â· ${Math.round(reputation.average_latency_ms)}ms</small>` : ''}</td>
        <td><div class="table-actions">${window.MissionControl?.eyeButton(`proxy:${proxy.id}`, `View ${proxy.server} details`) || ''}<button class="btn btn-secondary btn-sm" data-action="test-proxy" type="button">Test</button><button class="btn btn-secondary btn-sm" data-action="resolve-proxy" type="button">Resolve</button><button class="btn btn-secondary btn-sm" data-action="report-proxy" type="button">Report</button><button class="btn btn-danger-outline btn-sm" data-action="delete-proxy" type="button">Delete</button></div></td>`;
      row.querySelector('[data-tier-select]')?.addEventListener('change', event => {
        updateProxyTier(proxy.id, event.target.value || null);
      });
      row.querySelectorAll('[data-action]').forEach(button => {
        button.dataset.proxyId = String(proxy.id);
      });
      body.appendChild(row);
    });
  } catch (err) {
    document.getElementById('proxy-feedback').innerText = `Could not load proxies: ${err.message || err}`;
  }
}

async function submitProxy() {
  const feedback = document.getElementById('proxy-modal-feedback');
  const payload = {
    server: document.getElementById('proxy-server-input').value.trim(),
    username: document.getElementById('proxy-username-input').value.trim() || null,
    password: document.getElementById('proxy-password-input').value || null,
    proxy_type: document.getElementById('proxy-type-select').value,
    region_id: document.getElementById('proxy-region-select').value || null,
    tier_id: document.getElementById('proxy-tier-select').value || null,
    health_check_url: document.getElementById('proxy-health-url-input').value.trim() || null,
  };
  const result = await window.desktopBridge.api.create_proxy(payload);
  if (!result.success) {
    feedback.innerText = result.error || 'Proxy could not be saved.';
    return;
  }
  document.getElementById('create-proxy-modal').style.display = 'none';
  await loadProxies();
}

async function runProxyAction(proxyId, action) {
  const feedback = document.getElementById('proxy-feedback');
  if (action === 'delete' && !confirm('Delete this proxy and its reputation history?')) return;
  feedback.innerText = `${action === 'resolve' ? 'Resolving location' : action === 'test' ? 'Testing connectivity' : 'Loading proxy evidence'}Ã¢â‚¬Â¦`;
  let result;
  if (action === 'test') result = await window.desktopBridge.api.test_proxy(proxyId);
  else if (action === 'resolve') result = await window.desktopBridge.api.resolve_proxy_location(proxyId);
  else if (action === 'report') result = await window.desktopBridge.api.get_proxy_report(proxyId);
  else result = await window.desktopBridge.api.delete_proxy(proxyId);

  if (!result.success) {
    feedback.innerText = result.error || `${action} failed.`;
    return;
  }
  if (action === 'test') feedback.innerText = `Proxy healthy: ${result.latency_ms}ms (${result.status}).`;
  else if (action === 'resolve') feedback.innerText = `Resolved: ${[result.city, result.country, result.asn].filter(Boolean).join(' Ã‚Â· ') || 'no metadata returned'}.`;
  else if (action === 'report') feedback.innerText = `Session outcomes: ${JSON.stringify(result.session_status_counts)} Ã‚Â· Reputation samples: ${result.reputation.total_requests || 0}.`;
  else feedback.innerText = 'Proxy deleted.';
  await loadProxies();
}

async function selectPod(podId, name = null, target = null) {
  selectedPodId = podId;
  const profileSection = document.getElementById('profile-section');
  profileSection.style.display = 'block';
  document.getElementById('pods-tab').classList.add('has-selection');

  document.getElementById('selected-pod-name').innerText = name || 'Pod Profiles';
  document.getElementById('selected-pod-target').innerText = target || 'No target URL';

  document.querySelectorAll('.pod-card').forEach(card => {
    const isSelected = card.dataset.podId === String(podId);
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-pressed', String(isSelected));
  });

  const [profileList, fleetResponse] = await Promise.all([
    window.desktopBridge.api.list_profiles(podId),
    typeof window.desktopBridge.api.get_fleet_overview === 'function'
      ? window.desktopBridge.api.get_fleet_overview().catch(() => null)
      : Promise.resolve(null),
  ]);
  if (String(selectedPodId) !== String(podId)) return;
  const fleetProfiles = new Map((fleetResponse?.profiles || []).map(entry => [String(entry.profile_id), entry]));
  const tbody = document.getElementById('profile-table-body');
  tbody.innerHTML = "";
  profileRowsById.clear();

  if (fleetProfiles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No profiles created in this Pod. Click "+ Add Profile" to generate one.</td></tr>`;
    return;
  }

  fleetProfiles.forEach(p => {
    profileRowsById.set(String(p.id), p);
    const profile = fleetProfiles.get(String(p.id));
    const gateKnown = Boolean(profile);
    const isTargetQualified = gateKnown ? Boolean(profile.eligible) : null;
    const readiness = profile?.bucket ? profile.bucket.toUpperCase() : 'CHECK ON LAUNCH';
    const placement = profile?.placement ? [profile.placement.name, profile.placement.city].filter(Boolean).join(' Ã‚Â· ') : 'No region shown';
    const activity = profile?.activity?.message || (profile?.active ? 'Session active' : 'Idle');
    const nextAction = profile?.next_scheduled_at ? consoleFormatTime(profile.next_scheduled_at) : 'No action scheduled';
    const retired = String(p.lifecycle_state || '').toUpperCase() === 'RETIRED';
    const virgin = Boolean(p.manage?.virgin);
    window.MissionControl?.setDetails(`profile:${p.id}`, {
      title: p.name,
      subtitle: `${name || 'Pod'} Ã‚Â· ${readiness}`,
      rows: [
        ['Device', p.device_type || 'Unknown'],
        ['Resolution', p.resolution || 'Unknown'],
        ['GPU', p.gpu || 'Unavailable'],
        ['Score / onboarding', `${Number(p.trust_score || 0).toFixed(2)} Ã‚Â· ${Number(p.onboarding_hours || 0).toFixed(3)}h`],
        ['Placement', placement],
        ['Readiness rules', profile?.gate_message || 'Evaluated when launching a target session'],
        ['Current activity', activity],
        ['Next scheduled', nextAction],
        ['Last error', profile?.last_error?.message || 'None recorded'],
      ],
      note: 'Stored profile material and credentials are not shown here.',
    });
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong><small class="profile-row-sub">${escapeHtml(p.device_type || 'Unknown device')}</small></td>
      <td><span class="badge ${readiness === 'ELIGIBLE' ? 'badge-ready' : readiness === 'QUARANTINED' ? 'badge-failed' : 'badge-queued'}">${escapeHtml(readiness)}</span><small class="profile-row-sub">${Number(p.trust_score || 0).toFixed(2)} trust Ã‚Â· ${Number(p.onboarding_hours || 0).toFixed(3)}h Onboarding</small></td>
      <td>${escapeHtml(placement)}</td>
      <td><span class="profile-row-activity">${escapeHtml(activity)}</span><small class="profile-row-sub">Next: ${escapeHtml(nextAction)}</small></td>
      <td>${window.MissionControl?.eyeButton(`profile:${p.id}`, `View ${p.name} details`) || ''}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-warmer" data-action="open-session" data-session-type="warmer" type="button" ${retired ? 'disabled' : ''}>Onboarding</button>
          <button class="btn btn-sm btn-target ${isTargetQualified === false || retired ? 'disabled' : ''}" data-action="open-session" data-session-type="target" title="${escapeAttribute(profile?.gate_message || 'Gate checked before launch')}" type="button" ${isTargetQualified === false || retired ? 'disabled' : ''}>Target</button>
          <details class="profile-manage-menu"><summary class="btn btn-secondary btn-sm">Manage</summary><div class="profile-manage-actions">
            ${retired ? '' : '<button class="btn btn-secondary btn-sm" data-action="edit-profile" type="button">Edit</button><button class="btn btn-danger-outline btn-sm" data-action="retire-profile" type="button">Retire</button>'}
            <button class="btn btn-danger-outline btn-sm" data-action="delete-profile" type="button" ${virgin && !retired ? '' : 'disabled'} title="${escapeAttribute(virgin && !retired ? 'Delete this never-launched profile' : (p.manage?.reason || 'Only never-launched profiles can be deleted'))}">Delete</button>
          </div></details>
        </div>
      </td>
    `;
    tr.querySelectorAll('[data-action]').forEach(button => {
      button.dataset.profileId = String(p.id);
      button.dataset.profileName = String(p.name || 'Profile');
    });
    tbody.appendChild(tr);
  });
}

async function editProfile(profileId) {
  const profile = profileRowsById.get(String(profileId));
  if (!profile || String(profile.lifecycle_state || '').toUpperCase() === 'RETIRED') return;
  editingProfileId = String(profileId);
  const modal = document.getElementById('create-profile-modal');
  await loadProfileRegionsForEdit();
  document.getElementById('create-profile-title').innerText = 'Edit Profile';
  document.getElementById('btn-submit-profile').innerText = 'Save Profile';
  document.getElementById('profile-name-input').value = profile.name || '';
  document.getElementById('profile-device-select').value = profile.device_type || 'windows';
  document.getElementById('profile-device-select').disabled = true;
  document.getElementById('profile-device-hint').hidden = false;
  const region = document.getElementById('profile-region-select');
  region.value = profile.region_id || '';
  region.disabled = !profile.manage?.virgin;
  const hint = document.getElementById('profile-region-hint');
  hint.hidden = !region.disabled;
  if (region.disabled) hint.textContent = `Region is locked: ${profile.manage?.reason || 'profile has run'}.`;
  document.getElementById('profile-quality-select').value = profile.playback_quality || '';
  modal.style.display = 'flex';
}

async function loadProfileRegionsForEdit() {
  const select = document.getElementById('profile-region-select');
  const result = await window.desktopBridge.api.list_regions();
  select.innerHTML = '<option value="">Inherit pod region</option>' + (result.regions || []).map(region => `<option value="${escapeAttribute(region.id)}">${escapeHtml(region.name)} (${escapeHtml(region.timezone)})</option>`).join('');
}

async function retireProfile(profileId) {
  const profile = profileRowsById.get(String(profileId));
  if (!profile || !confirm(`Retire "${profile.name}"? This permanently blacklists its identity and cancels scheduled runs.`)) return;
  const result = await window.desktopBridge.api.retire_profile(profileId);
  if (!result?.success) return alert(`Could not retire profile: ${result?.error || 'unknown error'}`);
  if (result.schedule_cancellation_error) alert(`Profile retired, but schedule cancellation failed: ${result.schedule_cancellation_error}`);
  await selectPod(selectedPodId);
}

async function deleteProfile(profileId) {
  const profile = profileRowsById.get(String(profileId));
  if (!profile?.manage?.virgin || !confirm(`Delete never-launched profile "${profile.name}"? Its identity will return to the pool.`)) return;
  const result = await window.desktopBridge.api.delete_profile(profileId);
  if (!result?.success) return alert(`Could not delete profile: ${result?.error || 'unknown error'}`);
  if (result.schedule_cancellation_error) alert(`Profile deleted, but schedule cancellation failed: ${result.schedule_cancellation_error}`);
  await selectPod(selectedPodId);
  await loadPods();
}

async function openSessionModal(profileId, profileName, sessionType) {
  currentProfileId = profileId;
  const modal = document.getElementById('launch-session-modal');
  document.getElementById('session-profile-name').innerText = profileName;
  document.getElementById('session-type-select').value = sessionType;
  syncSessionModeFields();
  applySessionDurationDefault(sessionType);
  // Initialize the per-session toggles from the global settings at open;
  // from here the operator's choices stand until submit.
  const headlessToggle = document.getElementById('session-headless-checkbox');
  if (headlessToggle) headlessToggle.checked = !Boolean(operationsSettings?.browser_visible ?? true);
  const cursorToggle = document.getElementById('session-show-cursor-checkbox');
  if (cursorToggle) cursorToggle.checked = Boolean(operationsSettings?.cursor_visible ?? true);
  // Who is this session: the merged persona + activity picker
  // (2026-10-11). Personas run their Fleet Playbook flows; activities
  // are saved presets that override the flow.
  const whoSelect = document.getElementById('session-persona-select');
  if (whoSelect) {
    whoSelect.querySelectorAll('optgroup[data-activity-group]').forEach(node => node.remove());
    let activities = [];
    if (typeof window.desktopBridge?.api?.list_activities === 'function') {
      try {
        const listing = await window.desktopBridge.api.list_activities();
        activities = (listing && listing.installed) || [];
      } catch (error) {
        console.warn('Could not load activities:', error);
      }
    }
    if (activities.length) {
      const activityGroup = document.createElement('optgroup');
      activityGroup.label = 'Activities (saved presets)';
      activityGroup.dataset.activityGroup = '1';
      activities.forEach(activity => {
        const option = document.createElement('option');
        option.value = `activity:${activity.id}`;
        option.innerText = `${activity.name} (${activity.slug})`;
        activityGroup.appendChild(option);
      });
      whoSelect.appendChild(activityGroup);
    }
    if (whoSelect.options.length) whoSelect.selectedIndex = 0;
  }
  const regionalToggle = document.getElementById('session-regional-test-checkbox');
  const regionalSelect = document.getElementById('session-regional-proxy-select');
  regionalToggle.checked = false;
  regionalSelect.disabled = true;
  regionalSelect.innerHTML = '<option value="">Choose an exitÃ¢â‚¬Â¦</option>';
  try {
    const proxies = await window.desktopBridge.api.list_proxies();
    const active = proxies.filter(proxy => proxy.is_active && !proxy.is_retired);
    const row = profileRowsById.get(String(profileId));
    let region = null;
    if (row && row.region_id) {
      const catalogue = await window.desktopBridge.api.list_regions();
      region = ((catalogue && catalogue.regions) || []).find(item => item.id === row.region_id) || null;
    }
    // Coherence (2026-10-11): a stamped identity only ever sees its own
    // region's exits. Unbound profiles (Scratch) may use any exit.
    const coherent = active.filter(proxy => {
      if (!region) return true;
      return String(proxy.country || '').trim().toUpperCase() === String(region.country_code || '').trim().toUpperCase()
        && String(proxy.city || '').trim().toLowerCase() === String(region.proxy_city || '').trim().toLowerCase();
    });
    coherent.forEach(proxy => {
      const option = document.createElement('option');
      option.value = proxy.id;
      option.innerText = `${proxy.country || 'Unknown region'} Ã‚Â· ${proxy.proxy_type} Ã‚Â· ${proxy.server}`;
      regionalSelect.appendChild(option);
    });
    if (region && !coherent.length) {
      const option = document.createElement('option');
      option.value = '';
      option.innerText = `No exit matches ${region.name} (${region.proxy_city}) Ã¢â‚¬â€ add one in Proxy Inventory`;
      option.disabled = true;
      regionalSelect.appendChild(option);
    }
  } catch (error) {
    console.warn('Could not load exit options:', error);
  }
  regionalToggle.onchange = () => {
    regionalSelect.disabled = !regionalToggle.checked;
    if (!regionalToggle.checked) regionalSelect.value = '';
  };

  if (sessionType === "target") {
    const gate = await window.desktopBridge.api.check_target_gate(profileId);
    if (!gate.qualified) {
      alert(`Profile is not yet qualified for Target sessions:\n${gate.message}\nOnboarding completed: ${gate.onboarding_hours.toFixed(3)}h / ${gate.min_onboarding_hours}h\nTrust Score: ${gate.trust_score.toFixed(2)} / ${(gate.min_target_trust_score ?? 0.5).toFixed(2)}`);
      return;
    }
  }

  modal.style.display = 'flex';
}

function syncSessionModeFields() {
  const mode = document.getElementById('session-type-select').value;
  const targetField = document.getElementById('session-target-field');
  const targetInput = document.getElementById('session-target-override');
  const usesTarget = mode === 'target';
  targetField.style.display = usesTarget ? 'block' : 'none';
  targetInput.disabled = !usesTarget;
  targetInput.setAttribute('aria-hidden', usesTarget ? 'false' : 'true');
}

async function submitLaunchSession() {
  if (!selectedPodId || !currentProfileId) return;

  const mode = document.getElementById('session-type-select').value;
  const sessionType = mode === 'target' ? 'target' : 'warmer';
  const seasoning = mode === 'warmer_browse';
  const whoValue = document.getElementById('session-persona-select').value || '';
  const personaKey = whoValue.startsWith('persona:') ? whoValue.slice('persona:'.length) : '';
  const activityId = whoValue.startsWith('activity:') ? whoValue.slice('activity:'.length) : null;
  const targetOverride = mode === 'target'
    ? document.getElementById('session-target-override').value.trim()
    : null;
  const duration = parseInt(document.getElementById('session-duration-input').value) || 15;
  const headless = document.getElementById('session-headless-checkbox').checked;
  const showCursor = document.getElementById('session-show-cursor-checkbox').checked;
  const regionalTest = document.getElementById('session-regional-test-checkbox').checked;
  const proxyId = document.getElementById('session-regional-proxy-select').value || null;
  if (regionalTest && !proxyId) {
    alert('Select an exit for this session.');
    return;
  }

  const res = await window.desktopBridge.api.launch_session(
    selectedPodId,
    currentProfileId,
    sessionType,
    personaKey,
    duration,
    targetOverride || null,
    headless,
    showCursor,
    proxyId,
    regionalTest,
    activityId,
    seasoning
  );

  if (!res.success) {
    alert(`Could not launch session: ${res.error}`);
    return;
  }

  document.getElementById('launch-session-modal').style.display = 'none';

  // Store in activeSessions Map and render
  activeSessions.set(res.session_run_id, {
    id: res.session_run_id,
    persona: res.persona,
    type: sessionType,
    goal: res.goal,
    totalSteps: res.actions_count,
    completedSteps: 0,
    status: res.status || "QUEUED",
    desc: `Queued: ${res.goal}`
  });
  renderActiveSessions();
}


// Boot-time asset resilience (2026-10-10): a burst can drop an odd image or
// stylesheet through the loopback server (responseStatus 0). Retry those
// once or twice. Scripts are not retried here: re-injection after init has
// side effects, and the server backlog fix is the primary protection.
function installBootAssetRetry() {
  const retryImg = img => {
    const tries = Number(img.dataset.retryCount || '0');
    if (tries >= 2) return;
    img.dataset.retryCount = String(tries + 1);
    img.src = `${(img.src || '').split('?')[0]}?retry=${tries + 1}`;
  };
  document.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('error', () => retryImg(img));
  });
  const retrySheet = href => {
    const clean = (href || '').split('?')[0];
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(node => node.href.split('?')[0] === clean && node.dataset.retryCount !== '1');
    if (!link) return;
    link.dataset.retryCount = '1';
    const clone = link.cloneNode();
    clone.href = `${clean}?retry=1`;
    link.after(clone);
  };
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    link.addEventListener('error', () => retrySheet(link.href));
  });
  // Assets that already failed before this script ran:
  performance.getEntriesByType('resource').forEach(entry => {
    if (entry.responseStatus !== 0) return;
    if (entry.initiatorType === 'img') {
      const img = [...document.images].find(node => (node.src || '').split('?')[0] === entry.name.split('?')[0]);
      if (img && !img.dataset.retryCount) retryImg(img);
    } else if (entry.initiatorType === 'link') {
      retrySheet(entry.name);
    }
  });
}
installBootAssetRetry();

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function setupDelegatedActions() {
  if (delegatedActionsReady) return;
  delegatedActionsReady = true;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || button.classList.contains('disabled')) return;
    const action = button.dataset.action;
    const actions = {
      'stop-session': () => stopSpecificSession(button.dataset.sessionId),
      'open-session': () => openSessionModal(button.dataset.profileId, button.dataset.profileName, button.dataset.sessionType),
      'edit-profile': () => editProfile(button.dataset.profileId),
      'retire-profile': () => retireProfile(button.dataset.profileId),
      'delete-profile': () => deleteProfile(button.dataset.profileId),
      'open-report': () => openRunReportDetails(button.dataset.reportId),
      'create-workflow': () => openCreateWorkflowModal(),
      'launch-workflow': () => openLaunchWorkflowModal(button.dataset.workflowId, button.dataset.workflowName),
      'edit-workflow': () => openEditWorkflowModal(button.dataset.workflowId),
      'duplicate-workflow': () => duplicateWorkflow(button.dataset.workflowId),
      'delete-workflow': () => deleteWorkflow(button.dataset.workflowId),
      'move-step-up': () => moveBuilderStep(Number(button.closest('.step-card')?.dataset.index), -1),
      'move-step-down': () => moveBuilderStep(Number(button.closest('.step-card')?.dataset.index), 1),
      'remove-step': () => removeBuilderStep(Number(button.closest('.step-card')?.dataset.index)),
      'open-workflow-run': () => openRunDetailsModal(button.dataset.runId),
      'cancel-workflow-run': () => cancelWorkflowRun(button.dataset.runId),
      'resume-workflow-run': () => resumeWorkflowRun(button.dataset.runId),
      'show-artifact-path': () => alert(`Artifact screenshot saved to: ${button.dataset.artifactPath}`),
      'test-proxy': () => runProxyAction(button.dataset.proxyId, 'test'),
      'resolve-proxy': () => runProxyAction(button.dataset.proxyId, 'resolve'),
      'report-proxy': () => runProxyAction(button.dataset.proxyId, 'report'),
      'delete-proxy': () => runProxyAction(button.dataset.proxyId, 'delete'),
      'ack-warning': () => ackPulseWarning(button.dataset.warningId),
      'pulse-goto': () => pulseGoTo(button.dataset.pulseTab),
      'persona-pool-remove': () => button.closest('.persona-pool-row')?.remove(),
      'launch-dispatch': () => launchDispatchById(button.dataset.dispatchId),
      'cancel-dispatch': () => cancelDispatchById(button.dataset.dispatchId),
      'close-manual': () => closeManualSession(button.dataset.sessionId),
      'cancel-local-run': () => cancelLocalRunById(button.dataset.runId),
      'open-local-run': () => openLocalRunArtifacts(button.dataset.artifactsDir),
    };
    const handler = actions[action];
    if (handler) {
      event.preventDefault();
      Promise.resolve(handler()).catch(err => console.error(`UI action '${action}' failed:`, err));
    }
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-step-field], [data-step-param]');
    if (!input) return;
    const index = Number(input.closest('.step-card')?.dataset.index);
    if (!Number.isInteger(index) || !builderSteps[index]) return;
    if (input.dataset.stepField === 'name') updateStepName(index, input.value);
    else if (input.dataset.stepField === 'critical') updateStepCritical(index, input.checked);
    else if (input.dataset.stepField === 'retry') updateStepRetry(index, input.value);
    else if (input.dataset.stepField === 'timeout') updateStepTimeout(index, input.value);
    else if (input.dataset.stepParam) {
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.dataset.valueType === 'float') value = Number.parseFloat(value);
      if (input.dataset.valueType === 'int') value = Number.parseInt(value, 10);
      updateStepParam(index, input.dataset.stepParam, value);
    }
  });
}

// ==========================================================================
// YouTube Workflow Core UI Logic (Phase 3)
// ==========================================================================

let workflowsList = [];
let currentBuilderWorkflowId = null;
let builderSteps = [];
let pendingAIWorkflow = null;
let pendingAICandidateId = null;
const activeWorkflowRunPollers = new Map();
let reportPage = 1;
let reportTotal = 0;
let reportPageSize = 25;
let reportRefreshTimer = null;

const DEFAULT_STEP_CONFIGS = {
  navigate: {
    name: "Navigate to Video or Channel",
    params: { url: "https://www.youtube.com/@samplechannel/videos" },
    timeout_seconds: 30.0,
    retry_count: 2,
    is_critical: true
  },
  search_channel_video: {
    name: "Search Channel Video",
    params: { query: "Latest video" },
    timeout_seconds: 25.0,
    retry_count: 2,
    is_critical: true
  },
  verify_playback_start: {
    name: "Verify Playback Starts",
    params: { min_playback_seconds: 2.0 },
    timeout_seconds: 30.0,
    retry_count: 2,
    is_critical: true
  },
  pause_resume_seek: {
    name: "Pause, Resume & Seek Test",
    params: { pause_duration: 1.5, seek_to_seconds: 10.0 },
    timeout_seconds: 25.0,
    retry_count: 1,
    is_critical: true
  },
  verify_captions: {
    name: "Verify Captions & Language",
    params: { language: "en" },
    timeout_seconds: 20.0,
    retry_count: 1,
    is_critical: false
  },
  verify_qualities: {
    name: "Verify Available Qualities",
    params: { expected_qualities: "1080p, 720p, 480p, 360p" },
    timeout_seconds: 20.0,
    retry_count: 1,
    is_critical: false
  },
  test_fullscreen: {
    name: "Test Fullscreen Controls",
    params: { verify_toggle: true },
    timeout_seconds: 15.0,
    retry_count: 1,
    is_critical: false
  },
  navigate_tabs_playlist: {
    name: "Navigate Tabs or Playlists",
    params: { target_type: "tab", target_name: "Videos" },
    timeout_seconds: 25.0,
    retry_count: 2,
    is_critical: true
  },
  check_description_links: {
    name: "Check Description & Outbound Links",
    params: { verify_links: true, max_links: 3 },
    timeout_seconds: 25.0,
    retry_count: 1,
    is_critical: false
  },
  capture_screenshot: {
    name: "Capture Screenshot Artifact",
    params: { step_name: "qa_verification", full_page: false },
    timeout_seconds: 15.0,
    retry_count: 1,
    is_critical: false
  },
  assert_element_text: {
    name: "Assert Element / Text Exists",
    params: { selector: "#title h1", expected_text: "" },
    timeout_seconds: 20.0,
    retry_count: 2,
    is_critical: true
  },
  measure_timing: {
    name: "Measure Page & Playback Timings",
    params: { max_page_load_ms: 12000, max_playback_startup_ms: 8000 },
    timeout_seconds: 20.0,
    retry_count: 1,
    is_critical: false
  }
};

function setupReportingUI() {
  document.getElementById('btn-report-refresh')?.addEventListener('click', () => {
    reportPage = 1;
    loadReportingDashboard();
  });
  document.getElementById('btn-report-prev')?.addEventListener('click', () => {
    if (reportPage > 1) { reportPage -= 1; loadReportingDashboard(); }
  });
  document.getElementById('btn-report-next')?.addEventListener('click', () => {
    if (reportPage * reportPageSize < reportTotal) { reportPage += 1; loadReportingDashboard(); }
  });
  document.getElementById('btn-report-export-json')?.addEventListener('click', () => exportReporting('json'));
  document.getElementById('btn-report-export-csv')?.addEventListener('click', () => exportReporting('csv'));
  ['report-search', 'report-status-filter', 'report-type-filter', 'report-profile-filter', 'report-workflow-filter', 'report-start-filter', 'report-end-filter']
    .forEach(id => document.getElementById(id)?.addEventListener(id === 'report-search' ? 'input' : 'change', () => {
      reportPage = 1;
      clearTimeout(window.reportFilterTimer);
      window.reportFilterTimer = setTimeout(loadReportingDashboard, 180);
    }));
  ['btn-close-report-details', 'btn-dismiss-report-details'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => { document.getElementById('report-details-modal').style.display = 'none'; })
  );
}

function scheduleReportingRefresh() {
  clearTimeout(reportRefreshTimer);
  reportRefreshTimer = setTimeout(() => {
    const reportsTab = document.getElementById('reports-tab');
    if (reportsTab?.classList.contains('active')) loadReportingDashboard();
  }, 250);
}

function reportUtcInput(id) {
  const value = document.getElementById(id)?.value;
  if (!value) return null;
  const utcValue = value.endsWith('Z') ? value : `${value}Z`;
  const date = new Date(utcValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function collectReportFilters(includePagination = true) {
  const status = document.getElementById('report-status-filter')?.value;
  const runType = document.getElementById('report-type-filter')?.value;
  const filters = {
    query: document.getElementById('report-search')?.value.trim() || null,
    statuses: status ? [status] : [],
    run_types: runType ? [runType] : [],
    profile_id: document.getElementById('report-profile-filter')?.value.trim() || null,
    workflow_id: document.getElementById('report-workflow-filter')?.value.trim() || null,
    start_utc: reportUtcInput('report-start-filter'),
    end_utc: reportUtcInput('report-end-filter'),
    sort_desc: true,
  };
  if (includePagination) Object.assign(filters, { page: reportPage, page_size: reportPageSize });
  return filters;
}

async function loadReportingDashboard() {
  const feedback = document.getElementById('report-feedback');
  if (!window.desktopBridge?.api?.get_reporting_dashboard) return;
  try {
    const page = await window.desktopBridge.api.get_reporting_dashboard(collectReportFilters());
    if (page.error) throw new Error(page.error);
    reportTotal = page.total || 0;
    reportPage = page.page || reportPage;
    reportPageSize = page.page_size || reportPageSize;
    renderReportingDashboard(page);
    feedback.innerText = '';
    feedback.removeAttribute('data-tone');
  } catch (err) {
    feedback.innerText = `Could not load reports: ${err.message || err}`;
    feedback.style.color = 'var(--color-danger)';
    feedback.dataset.tone = 'error';
  }
}

function renderReportingDashboard(page) {
  const summary = page.summary || {};
  document.getElementById('report-active-count').innerText = summary.active || 0;
  document.getElementById('report-completed-count').innerText = summary.completed || 0;
  document.getElementById('report-terminal-count').innerText = `${summary.failed || 0} / ${summary.stopped || 0}`;
  document.getElementById('report-local-playback').innerText = `${Math.round(summary.local_observed_playback_seconds || 0)}s`;
  document.getElementById('report-page-meta').innerText = page.total ? `Page ${page.page} of ${Math.ceil(page.total / page.page_size)} Ã‚Â· ${page.total} matching runs` : 'No matching runs';
  document.getElementById('btn-report-prev').disabled = (page.page || 1) <= 1;
  document.getElementById('btn-report-next').disabled = (page.page || 1) * (page.page_size || 25) >= (page.total || 0);

  const body = document.getElementById('report-history-body');
  body.innerHTML = '';
  if (!(page.reports || []).length) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--color-text-muted);">No runs match these filters.</td></tr>';
    return;
  }
  page.reports.forEach(report => {
    const row = document.createElement('tr');
    const statusClass = report.status === 'COMPLETED' ? 'badge-green' : report.status === 'FAILED' ? 'badge-red' : report.status === 'STOPPED' ? 'badge-amber' : 'badge-cyan';
    const timings = [report.page_load_time_ms != null ? `Page ${Math.round(report.page_load_time_ms)}ms` : null,
      report.playback_startup_time_ms != null ? `Startup ${Math.round(report.playback_startup_time_ms)}ms` : null].filter(Boolean).join(' Ã‚Â· ') || 'Ã¢â‚¬â€';
    window.MissionControl?.setDetails(`report:${report.report_id}`, {
      title: `Run ${report.report_id}`,
      subtitle: `${report.status} Ã‚Â· ${report.run_type}`,
      rows: [
        ['Profile', report.profile_name || report.profile_id],
        ['Workflow', report.workflow_name || 'Session run'],
        ['Local playback', `${Math.round(report.local_observed_playback_seconds || 0)}s observed locally`],
        ['Page / startup', timings],
        ['Retries', report.retries || 0],
        ['Error', report.error_message || report.error_class || 'None recorded'],
      ],
      note: 'Local playback is not YouTube-credited watch time. Open Details for full evidence and artifacts.',
    });
    row.innerHTML = `
      <td><span class="mono" title="${escapeAttribute(report.report_id)}">${escapeHtml(report.report_id)}</span></td>
      <td>${escapeHtml(report.run_type)}</td><td>${escapeHtml(report.profile_name || report.profile_id)}</td>
      <td>${escapeHtml(report.workflow_name || 'Ã¢â‚¬â€')}</td><td><span class="badge ${statusClass}">${escapeHtml(report.status)}</span></td>
      <td>${Math.round(report.local_observed_playback_seconds || 0)}s <small>local</small></td><td><small>${escapeHtml(timings)}</small></td>
      <td>${report.retries || 0}</td><td><div class="table-actions">${window.MissionControl?.eyeButton(`report:${report.report_id}`, `Preview run ${report.report_id}`) || ''}<button class="btn btn-secondary btn-sm" type="button" data-action="open-report">Details</button></div></td>`;
    row.querySelector('[data-action="open-report"]').dataset.reportId = String(report.report_id);
    body.appendChild(row);
  });
}

window.openRunReportDetails = async function(reportId) {
  const response = await window.desktopBridge.api.get_run_report(reportId);
  if (!response.found) { alert(response.error || 'Report not found.'); return; }
  const report = response.report;
  document.getElementById('report-details-title').innerText = `Run Report: ${report.report_id}`;
  document.getElementById('report-details-summary').innerText = `${report.status} Ã‚Â· ${report.run_type} Ã‚Â· ${report.profile_name || report.profile_id} Ã‚Â· ${report.workflow_name || 'No workflow name'}`;
  const evidence = document.getElementById('report-details-evidence');
  evidence.innerHTML = '';
  [['Local playback observation', `${Math.round(report.local_observed_playback_seconds || 0)}s Ã¢â‚¬â€ not YouTube-credited watch time`],
   ['Error classification', report.error_class || 'None'], ['Error message', report.error_message || 'None'],
   ['Completed actions / steps', report.actions_or_steps_completed || 0], ['Failed actions / steps', report.failed_actions_or_steps || 0],
   ['Retries', report.retries || 0], ['Checkpoint', JSON.stringify(report.checkpoint || {})], ['Resource usage', JSON.stringify(report.resource_usage || {})]]
    .forEach(([label, value]) => { const line = document.createElement('p'); line.innerText = `${label}: ${value}`; evidence.appendChild(line); });
  const artifacts = document.getElementById('report-details-artifacts'); artifacts.innerHTML = '';
  (report.artifacts || []).forEach(artifact => {
    const item = document.createElement('li');
    const previewable = artifact.kind === 'screenshot' || artifact.kind === 'log';
    item.innerText = `${artifact.kind}: ${artifact.path} (${artifact.size_bytes || 0} bytes)`;
    if (previewable) {
      const button = document.createElement('button');
      button.className = 'btn btn-secondary btn-sm'; button.type = 'button'; button.innerText = 'Preview';
      button.style.marginLeft = '8px';
      button.addEventListener('click', () => previewRunArtifact(report.report_id, artifact.path));
      item.appendChild(button);
    }
    artifacts.appendChild(item);
  });
  if (!(report.artifacts || []).length) artifacts.innerHTML = '<li>No contained artifacts recorded.</li>';
  const steps = document.getElementById('report-details-steps'); steps.innerHTML = '';
  (report.step_results || []).forEach(step => { const item = document.createElement('li'); item.innerText = `${step.status} Ã‚Â· ${step.name} Ã‚Â· ${step.duration_ms || 0}ms${step.error_class ? ` Ã‚Â· ${step.error_class}` : ''}${step.error ? ` Ã‚Â· ${step.error}` : ''}`; steps.appendChild(item); });
  if (!(report.step_results || []).length) steps.innerHTML = '<li>No step results recorded for this run.</li>';
  document.getElementById('report-details-modal').style.display = 'flex';
};

async function previewRunArtifact(reportId, artifactPath) {
  const result = await window.desktopBridge.api.get_run_artifact(reportId, artifactPath);
  if (!result.found) { alert(result.error || 'Artifact preview is unavailable.'); return; }
  const existing = document.getElementById('report-artifact-preview');
  if (existing) existing.remove();
  const preview = document.createElement('div'); preview.id = 'report-artifact-preview'; preview.className = 'preview-section';
  preview.innerHTML = '<h4>Artifact Preview</h4>';
  if (result.base64 && result.mime_type) {
    const image = document.createElement('img'); image.alt = result.artifact?.name || 'Run screenshot';
    image.src = `data:${result.mime_type};base64,${result.base64}`; image.style.maxWidth = '100%';
    preview.appendChild(image);
  } else {
    const log = document.createElement('pre'); log.textContent = result.text || 'No preview content.';
    preview.appendChild(log);
  }
  document.querySelector('#report-details-modal .modal-body')?.appendChild(preview);
}

async function exportReporting(format) {
  const feedback = document.getElementById('report-feedback');
  try {
    let outputPath = null;
    if (operationsSettings?.ask_export_location !== false) {
      const chosen = await window.desktopBridge.api.choose_save_path(
        `Workspace Controller-run-report.${format}`,
        operationsSettings?.export_destination || '',
        [format === 'json' ? 'JSON report (*.json)' : 'CSV report (*.csv)']
      );
      if (chosen.cancelled) {
        feedback.innerText = 'Report export cancelled.';
        feedback.style.removeProperty('color');
        feedback.dataset.tone = 'notice';
        return;
      }
      if (!chosen.success) throw new Error(chosen.error || 'Export destination is unavailable.');
      outputPath = chosen.path;
    }
    const result = await window.desktopBridge.api.save_run_reports(
      collectReportFilters(false), format, outputPath
    );
    if (!result.success) throw new Error(result.error || 'Export could not be saved.');
    feedback.innerText = `Export complete. Filtered ${format.toUpperCase()} report saved to ${result.path}.`;
    feedback.style.color = 'var(--color-success, #22c55e)';
    feedback.dataset.tone = 'success';
  } catch (err) {
    feedback.innerText = `Export failed: ${err.message || err}`;
    feedback.style.color = 'var(--color-danger)';
    feedback.dataset.tone = 'error';
  }
}

function setupWorkflowUI() {
  // Modal buttons
  document.getElementById('btn-open-create-workflow')?.addEventListener('click', openCreateWorkflowModal);
  document.getElementById('btn-refresh-workflows')?.addEventListener('click', () => {
    if (!document.getElementById('view-operate-workflows-runs')?.hidden) return loadWorkflowRuns();
    return loadWorkflows();
  });
  document.getElementById('btn-open-ai-workflow')?.addEventListener('click', openAIWorkflowModal);
  document.getElementById('btn-close-ai-workflow-modal')?.addEventListener('click', closeAIWorkflowModal);
  document.getElementById('btn-cancel-ai-workflow')?.addEventListener('click', closeAIWorkflowModal);
  document.getElementById('btn-generate-ai-workflow')?.addEventListener('click', generateAIWorkflow);
  document.getElementById('btn-edit-ai-workflow')?.addEventListener('click', reviewAIWorkflowDraft);

  // Builder Modal Controls
  document.getElementById('btn-close-builder-modal')?.addEventListener('click', () => {
    document.getElementById('workflow-builder-modal').style.display = 'none';
  });
  document.getElementById('btn-cancel-builder')?.addEventListener('click', () => {
    document.getElementById('workflow-builder-modal').style.display = 'none';
  });
  document.getElementById('btn-builder-add-step')?.addEventListener('click', () => {
    const sel = document.getElementById('builder-step-type-select');
    if (sel) addBuilderStep(sel.value);
  });
  document.getElementById('btn-builder-preview-workflow')?.addEventListener('click', previewWorkflow);
  document.getElementById('btn-submit-workflow')?.addEventListener('click', saveWorkflow);

  // Launch Modal Controls
  document.getElementById('btn-close-launch-wf-modal')?.addEventListener('click', () => {
    document.getElementById('launch-workflow-modal').style.display = 'none';
  });
  document.getElementById('btn-cancel-launch-wf')?.addEventListener('click', () => {
    document.getElementById('launch-workflow-modal').style.display = 'none';
  });
  document.getElementById('btn-submit-launch-wf')?.addEventListener('click', submitLaunchWorkflow);

  // Preview Modal Controls
  document.getElementById('btn-close-preview-modal')?.addEventListener('click', () => {
    document.getElementById('workflow-preview-modal').style.display = 'none';
  });
  document.getElementById('btn-dismiss-preview')?.addEventListener('click', () => {
    document.getElementById('workflow-preview-modal').style.display = 'none';
  });

  // Run Details Modal Controls
  document.getElementById('btn-close-run-details-modal')?.addEventListener('click', () => {
    document.getElementById('workflow-run-details-modal').style.display = 'none';
  });
  document.getElementById('btn-close-run-details')?.addEventListener('click', () => {
    document.getElementById('workflow-run-details-modal').style.display = 'none';
  });
}

async function loadWorkflows() {
  try {
    if (!window.desktopBridge?.api?.list_workflows) return;
    workflowsList = await window.desktopBridge.api.list_workflows();
    renderWorkflows();
  } catch (err) {
    console.error("Failed to load workflows:", err);
  }
}

function renderWorkflows() {
  const container = document.getElementById('workflow-list-container');
  if (!container) return;
  container.innerHTML = "";

  if (!workflowsList || workflowsList.length === 0) {
    container.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 36px 20px;">
        <span class="section-kicker">No Workflows Configured</span>
        <h4 style="margin: 8px 0;">Build Your First YouTube QA Workflow</h4>
        <p style="color: var(--color-text-soft); max-width: 480px; margin: 0 auto 16px;">
          Create a reusable automated testing pipeline with deterministic playback verification, captions checks, and safe checkpoints.
        </p>
        <button class="btn btn-primary" data-action="create-workflow" type="button">+ New Workflow</button>
      </div>
    `;
    return;
  }

  workflowsList.forEach(wf => {
    const card = document.createElement('div');
    card.className = "workflow-card";

    window.MissionControl?.setDetails(`workflow:${wf.id}`, {
      title: wf.name,
      subtitle: wf.description || 'YouTube QA workflow',
      rows: [
        ['Target', wf.target_type || 'YouTube'],
        ['Steps', wf.total_steps ?? wf.steps?.length ?? 0],
        ['Active limit', wf.concurrency_limit ?? 2],
        ['Source', wf.generation_source || 'manual'],
        ['Allowed channels', (wf.allowlist_channels || []).join(', ') || 'None specified'],
        ['Allowed videos', (wf.allowlist_videos || []).join(', ') || 'None specified'],
        ['Last updated', wf.updated_at ? consoleFormatTime(wf.updated_at) : 'Unknown'],
      ],
      note: 'Edit opens the complete step builder. This preview does not change the workflow.',
    });

    const channels = wf.allowlist_channels || [];
    const videos = wf.allowlist_videos || [];
    const channelBadges = channels.map(c => `<span class="badge badge-cyan">${escapeHtml(c)}</span>`).join(' ');
    const videoBadges = videos.map(v => `<span class="badge badge-purple">${escapeHtml(v)}</span>`).join(' ');
    const provenance = wf.generation_source && wf.generation_source !== 'manual'
      ? `<span class="badge badge-cyan">${escapeHtml(wf.generation_source === 'fallback' ? 'Deterministic fallback' : 'AI draft')}</span>` : '';

    card.innerHTML = `
      <div class="workflow-card-header">
        <div>
          <h4 class="workflow-title">${escapeHtml(wf.name)}</h4>
          <div class="workflow-badges">
            <span class="badge badge-green">${wf.total_steps || (wf.steps ? wf.steps.length : 0)} Steps</span>
            <span class="badge badge-amber">Limit: ${wf.concurrency_limit || 2} Active</span>
            ${provenance}
          </div>
        </div>
        ${window.MissionControl?.eyeButton(`workflow:${wf.id}`, `View ${wf.name} details`) || ''}
      </div>

      <p class="workflow-description">${escapeHtml(wf.description || "No description provided.")}</p>

      ${(channels.length > 0 || videos.length > 0) ? `
        <div class="workflow-allowlist-meta">
          <strong>Allowlist:</strong> ${channelBadges} ${videoBadges}
        </div>
      ` : ''}

      <div class="workflow-card-actions">
        <button class="btn btn-primary btn-sm" data-action="launch-workflow" type="button">
          Run
        </button>
        <button class="btn btn-secondary btn-sm" data-action="edit-workflow" type="button">
          Edit
        </button>
        <button class="btn btn-secondary btn-sm" data-action="duplicate-workflow" type="button" title="Duplicate workflow">
          Copy
        </button>
        <button class="btn btn-danger-outline btn-sm" data-action="delete-workflow" type="button" title="Delete workflow">
          Delete
        </button>
      </div>
    `;
    card.querySelectorAll('[data-action]').forEach(button => {
      button.dataset.workflowId = String(wf.id);
      button.dataset.workflowName = String(wf.name || 'Workflow');
    });
    container.appendChild(card);
  });
}

function openCreateWorkflowModal() {
  currentBuilderWorkflowId = null;
  pendingAIWorkflow = null;
  pendingAICandidateId = null;
  document.getElementById('builder-workflow-id').value = "";
  document.getElementById('workflow-builder-title').innerText = "Create YouTube Workflow";
  document.getElementById('builder-name-input').value = "";
  document.getElementById('builder-desc-input').value = "";
  document.getElementById('builder-concurrency-input').value = 2;
  document.getElementById('builder-channels-input').value = "";
  document.getElementById('builder-videos-input').value = "";
  document.getElementById('builder-feedback').innerText = "";
  document.getElementById('btn-submit-workflow').innerText = "Save Workflow";

  builderSteps = [];
  addBuilderStep("navigate");
  addBuilderStep("verify_playback_start");

  document.getElementById('workflow-builder-modal').style.display = 'flex';
}

async function openEditWorkflowModal(wfId) {
  try {
    const wf = await window.desktopBridge.api.get_workflow(wfId);
    if (!wf) return alert("Workflow not found.");

    currentBuilderWorkflowId = wfId;
    pendingAIWorkflow = null;
    pendingAICandidateId = null;
    document.getElementById('builder-workflow-id').value = wfId;
    document.getElementById('workflow-builder-title').innerText = `Edit: ${wf.name}`;
    document.getElementById('builder-name-input').value = wf.name || "";
    document.getElementById('builder-desc-input').value = wf.description || "";
    document.getElementById('builder-concurrency-input').value = wf.concurrency_limit || 2;
    document.getElementById('builder-channels-input').value = (wf.allowlist_channels || []).join(', ');
    document.getElementById('builder-videos-input').value = (wf.allowlist_videos || []).join(', ');
    document.getElementById('builder-feedback').innerText = "";
    document.getElementById('btn-submit-workflow').innerText = "Save Changes";

    builderSteps = (wf.steps || []).map((s, idx) => ({
      step_order: idx,
      step_type: s.step_type,
      name: s.name,
      params: { ...(s.params || {}) },
      is_critical: s.is_critical !== false,
      retry_count: s.retry_count !== undefined ? s.retry_count : 2,
      timeout_seconds: s.timeout_seconds || 30.0
    }));

    renderBuilderSteps();
    document.getElementById('workflow-builder-modal').style.display = 'flex';
  } catch (err) {
    console.error("Failed to load workflow for edit:", err);
  }
}

async function duplicateWorkflow(wfId) {
  try {
    const res = await window.desktopBridge.api.duplicate_workflow(wfId);
    if (res.success) {
      await loadWorkflows();
    } else {
      alert(`Duplicate failed: ${res.error}`);
    }
  } catch (err) {
    console.error("Failed to duplicate workflow:", err);
  }
}

async function deleteWorkflow(wfId) {
  if (!confirm("Are you sure you want to delete this workflow and its run history?")) return;
  try {
    const res = await window.desktopBridge.api.delete_workflow(wfId);
    if (res.success) {
      await loadWorkflows();
      await loadWorkflowRuns();
    } else {
      alert(`Delete failed: ${res.error}`);
    }
  } catch (err) {
    console.error("Failed to delete workflow:", err);
  }
}

function addBuilderStep(stepType) {
  const defaultCfg = DEFAULT_STEP_CONFIGS[stepType] || {
    name: `${stepType.replace(/_/g, ' ')} Step`,
    params: {},
    timeout_seconds: 30.0,
    retry_count: 2,
    is_critical: true
  };

  const newStep = {
    step_order: builderSteps.length,
    step_type: stepType,
    name: defaultCfg.name,
    params: JSON.parse(JSON.stringify(defaultCfg.params)),
    is_critical: defaultCfg.is_critical,
    retry_count: defaultCfg.retry_count,
    timeout_seconds: defaultCfg.timeout_seconds
  };

  builderSteps.push(newStep);
  renderBuilderSteps();
}

function renderBuilderSteps() {
  const container = document.getElementById('builder-steps-container');
  if (!container) return;
  container.innerHTML = "";

  builderSteps.forEach((step, index) => {
    step.step_order = index;
    const card = document.createElement('div');
    card.className = "step-card";
    card.dataset.index = index;

    card.innerHTML = `
      <div class="step-card-header">
        <div class="step-card-info">
          <span class="step-order-badge">#${index + 1}</span>
          <span class="step-name-title">${escapeHtml(step.step_type.replace(/_/g, ' ').toUpperCase())}</span>
        </div>
        <div class="step-controls">
          <button class="step-btn-icon" data-action="move-step-up" ${index === 0 ? 'disabled' : ''} title="Move Up" aria-label="Move step up" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>
          <button class="step-btn-icon" data-action="move-step-down" ${index === builderSteps.length - 1 ? 'disabled' : ''} title="Move Down" aria-label="Move step down" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m-6-6 6 6 6-6"/></svg></button>
          <button class="step-btn-icon delete" data-action="remove-step" title="Delete Step" aria-label="Remove step" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
      </div>

      <div class="step-card-body">
        <div class="form-group">
          <label>Step Label</label>
          <input type="text" class="input-field step-input-name" value="${escapeAttribute(step.name || '')}" data-step-field="name">
        </div>

        <div class="step-param-grid">
          ${renderStepParamInputs(step, index)}
        </div>

        <div class="step-flags-row">
          <label class="check-row" style="margin: 0;">
            <input type="checkbox" ${step.is_critical ? 'checked' : ''} data-step-field="critical">
            <span>Critical Step (Halt on Failure)</span>
          </label>
          <div>
            <label style="margin-right: 6px;">Retries:</label>
            <input type="number" min="0" max="5" value="${escapeAttribute(step.retry_count)}" style="width: 50px; padding: 3px;" data-step-field="retry">
          </div>
          <div>
            <label style="margin-right: 6px;">Timeout (s):</label>
            <input type="number" min="1" max="300" value="${escapeAttribute(step.timeout_seconds)}" style="width: 60px; padding: 3px;" data-step-field="timeout">
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderStepParamInputs(step, index) {
  const p = step.params || {};
  const t = step.step_type;

  switch (t) {
    case 'navigate':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Target URL / Video / Channel</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.url || '')}" placeholder="https://www.youtube.com/@channel/videos" data-step-param="url">
        </div>
      `;
    case 'search_channel_video':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Video Search Query</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.query || '')}" placeholder="e.g. Official Trailer" data-step-param="query">
        </div>
      `;
    case 'verify_playback_start':
      return `
        <div class="form-group">
          <label>Min Playback Duration (Seconds)</label>
          <input type="number" step="0.5" class="input-field" value="${escapeAttribute(p.min_playback_seconds || 2.0)}" data-step-param="min_playback_seconds" data-value-type="float">
        </div>
      `;
    case 'pause_resume_seek':
      return `
        <div class="form-group">
          <label>Pause Duration (s)</label>
          <input type="number" step="0.5" class="input-field" value="${escapeAttribute(p.pause_duration || 1.5)}" data-step-param="pause_duration" data-value-type="float">
        </div>
        <div class="form-group">
          <label>Seek Target (s)</label>
          <input type="number" step="1" class="input-field" value="${escapeAttribute(p.seek_to_seconds || 10.0)}" data-step-param="seek_to_seconds" data-value-type="float">
        </div>
      `;
    case 'verify_captions':
      return `
        <div class="form-group">
          <label>Required Caption Language Code</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.language || 'en')}" placeholder="en, es, etc." data-step-param="language">
        </div>
      `;
    case 'verify_qualities':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Expected Qualities (Comma-separated)</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.expected_qualities || '1080p, 720p, 480p, 360p')}" data-step-param="expected_qualities">
        </div>
      `;
    case 'test_fullscreen':
      return `
        <div class="form-group">
          <label class="check-row" style="margin-top: 14px;">
            <input type="checkbox" ${p.verify_toggle !== false ? 'checked' : ''} data-step-param="verify_toggle">
            <span>Verify Fullscreen Toggle</span>
          </label>
        </div>
      `;
    case 'navigate_tabs_playlist':
      return `
        <div class="form-group">
          <label>Target Type</label>
          <select class="input-field" data-step-param="target_type">
            <option value="tab" ${p.target_type === 'tab' ? 'selected' : ''}>Channel Tab</option>
            <option value="playlist" ${p.target_type === 'playlist' ? 'selected' : ''}>Playlist</option>
          </select>
        </div>
        <div class="form-group">
          <label>Tab / Playlist Name</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.target_name || 'Videos')}" placeholder="Videos, Playlists, etc." data-step-param="target_name">
        </div>
      `;
    case 'check_description_links':
      return `
        <div class="form-group">
          <label>Max Links to Inspect</label>
          <input type="number" min="1" max="10" class="input-field" value="${escapeAttribute(p.max_links || 3)}" data-step-param="max_links" data-value-type="int">
        </div>
        <div class="form-group">
          <label class="check-row" style="margin-top: 14px;">
            <input type="checkbox" ${p.verify_links !== false ? 'checked' : ''} data-step-param="verify_links">
            <span>Assert Outbound Links Accessible</span>
          </label>
        </div>
      `;
    case 'capture_screenshot':
      return `
        <div class="form-group">
          <label>Screenshot Label</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.step_name || 'qa_checkpoint')}" data-step-param="step_name">
        </div>
        <div class="form-group">
          <label class="check-row" style="margin-top: 14px;">
            <input type="checkbox" ${p.full_page ? 'checked' : ''} data-step-param="full_page">
            <span>Full Page Screenshot</span>
          </label>
        </div>
      `;
    case 'assert_element_text':
      return `
        <div class="form-group">
          <label>CSS Selector</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.selector || '#title h1')}" placeholder="#title h1, yt-formatted-string" data-step-param="selector">
        </div>
        <div class="form-group">
          <label>Expected Text (Optional substring)</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.expected_text || '')}" placeholder="Leave blank to assert element existence" data-step-param="expected_text">
        </div>
      `;
    case 'measure_timing':
      return `
        <div class="form-group">
          <label>Max Page Load Time (ms)</label>
          <input type="number" step="1000" class="input-field" value="${escapeAttribute(p.max_page_load_ms || 12000)}" data-step-param="max_page_load_ms" data-value-type="int">
        </div>
        <div class="form-group">
          <label>Max Playback Startup Time (ms)</label>
          <input type="number" step="1000" class="input-field" value="${escapeAttribute(p.max_playback_startup_ms || 8000)}" data-step-param="max_playback_startup_ms" data-value-type="int">
        </div>
      `;
    default:
      return `<p class="form-hint">No extra parameters required.</p>`;
  }
}

function updateStepName(idx, val) {
  if (builderSteps[idx]) builderSteps[idx].name = val;
}
function updateStepCritical(idx, val) {
  if (builderSteps[idx]) builderSteps[idx].is_critical = val;
}
function updateStepRetry(idx, val) {
  if (builderSteps[idx]) builderSteps[idx].retry_count = parseInt(val) || 0;
}
function updateStepTimeout(idx, val) {
  if (builderSteps[idx]) builderSteps[idx].timeout_seconds = parseFloat(val) || 30.0;
}
function updateStepParam(idx, key, val) {
  if (builderSteps[idx]) {
    if (!builderSteps[idx].params) builderSteps[idx].params = {};
    builderSteps[idx].params[key] = val;
  }
}

function moveBuilderStep(index, delta) {
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= builderSteps.length) return;
  const temp = builderSteps[index];
  builderSteps[index] = builderSteps[newIndex];
  builderSteps[newIndex] = temp;
  renderBuilderSteps();
}

function removeBuilderStep(index) {
  builderSteps.splice(index, 1);
  renderBuilderSteps();
}

function splitAllowlistInput(id) {
  return (document.getElementById(id)?.value || '').split(',').map(value => value.trim()).filter(Boolean);
}

function closeAIWorkflowModal() {
  document.getElementById('ai-workflow-modal').style.display = 'none';
}

async function openAIWorkflowModal() {
  pendingAIWorkflow = null;
  pendingAICandidateId = null;
  document.getElementById('ai-workflow-feedback').innerText = '';
  document.getElementById('ai-workflow-result').style.display = 'none';
  document.getElementById('btn-edit-ai-workflow').style.display = 'none';
  document.getElementById('btn-generate-ai-workflow').disabled = false;
  try {
    const settings = await window.desktopBridge.api.get_ai_workflow_settings();
    const useAI = document.getElementById('ai-workflow-use-ai');
    const fallback = document.getElementById('ai-workflow-allow-fallback');
    useAI.disabled = !settings.ai_enabled;
    if (!settings.ai_enabled) useAI.checked = false;
    fallback.disabled = !settings.fallback_enabled;
    if (!settings.fallback_enabled) fallback.checked = false;
    document.getElementById('ai-workflow-feedback').innerText = !settings.api_key_configured && settings.fallback_enabled
      ? 'No OpenRouter key is configured. A deterministic fallback draft can still be generated.' : '';
  } catch (err) {
    console.error('Could not load AI workflow settings:', err);
  }
  document.getElementById('ai-workflow-modal').style.display = 'flex';
}

async function generateAIWorkflow() {
  const prompt = document.getElementById('ai-workflow-prompt').value.trim();
  const feedback = document.getElementById('ai-workflow-feedback');
  if (prompt.length < 3) {
    feedback.innerText = 'Describe the QA workflow you want to create.';
    feedback.style.color = 'var(--color-danger)';
    return;
  }
  const request = {
    prompt,
    name: document.getElementById('ai-workflow-name').value.trim() || null,
    allowlist_channels: splitAllowlistInput('ai-workflow-channels'),
    allowlist_videos: splitAllowlistInput('ai-workflow-videos'),
    concurrency_limit: parseInt(document.getElementById('ai-workflow-concurrency').value) || 2,
    use_ai: document.getElementById('ai-workflow-use-ai').checked,
    allow_fallback: document.getElementById('ai-workflow-allow-fallback').checked,
    diversity_key: prompt,
  };
  feedback.innerText = 'Generating and validating a non-executable draftÃ¢â‚¬Â¦';
  feedback.style.color = 'var(--color-text-muted)';
  document.getElementById('btn-generate-ai-workflow').disabled = true;
  try {
    const result = await window.desktopBridge.api.generate_ai_workflow(request);
    if (!result.success || !result.workflow || !result.candidate_id) {
      feedback.innerText = result.message || 'No valid plan was generated.';
      feedback.style.color = 'var(--color-danger)';
      return;
    }
    pendingAIWorkflow = result.workflow;
    pendingAICandidateId = result.candidate_id;
    const resultBox = document.getElementById('ai-workflow-result');
    document.getElementById('ai-workflow-result-title').innerText = `${result.source === 'fallback' ? 'Deterministic Fallback' : 'AI'} Plan Ã¢â‚¬â€ Review Required`;
    const corrections = (result.validation_feedback || []).length
      ? ` Corrections applied: ${(result.validation_feedback || []).join(' | ')}` : '';
    document.getElementById('ai-workflow-result-meta').innerText = `${result.message} Source: ${result.model || result.source}; prompt version: ${result.prompt_version || 'n/a'}; attempts: ${result.attempts || 0}.${corrections}`;
    const steps = document.getElementById('ai-workflow-result-steps');
    steps.innerHTML = '';
    (result.workflow.steps || []).forEach(step => {
      const li = document.createElement('li');
      li.innerText = `${step.name} (${step.step_type}) Ã¢â‚¬â€ ${JSON.stringify(step.params || {})}`;
      steps.appendChild(li);
    });
    resultBox.style.display = 'block';
    document.getElementById('btn-edit-ai-workflow').style.display = 'inline-flex';
    feedback.innerText = 'The complete draft is shown below. Review and edit it before approval.';
    feedback.style.color = 'var(--color-text-muted)';
  } catch (err) {
    feedback.innerText = `Generation error: ${err}`;
    feedback.style.color = 'var(--color-danger)';
  } finally {
    document.getElementById('btn-generate-ai-workflow').disabled = false;
  }
}

function reviewAIWorkflowDraft() {
  if (!pendingAIWorkflow) return;
  const workflow = pendingAIWorkflow;
  currentBuilderWorkflowId = null;
  document.getElementById('builder-workflow-id').value = '';
  document.getElementById('workflow-builder-title').innerText = `Review AI Draft: ${workflow.name}`;
  document.getElementById('builder-name-input').value = workflow.name || '';
  document.getElementById('builder-desc-input').value = workflow.description || '';
  document.getElementById('builder-concurrency-input').value = workflow.concurrency_limit || 2;
  document.getElementById('builder-channels-input').value = (workflow.allowlist_channels || []).join(', ');
  document.getElementById('builder-videos-input').value = (workflow.allowlist_videos || []).join(', ');
  builderSteps = (workflow.steps || []).map((step, index) => ({ ...step, step_order: index, params: { ...(step.params || {}) } }));
  document.getElementById('builder-feedback').innerText = 'Review each step. Saving explicitly approves this generated workflow.';
  document.getElementById('btn-submit-workflow').innerText = 'Approve & Save Workflow';
  renderBuilderSteps();
  closeAIWorkflowModal();
  document.getElementById('workflow-builder-modal').style.display = 'flex';
}

function collectWorkflowBuilderData() {
  const name = document.getElementById('builder-name-input').value.trim();
  const desc = document.getElementById('builder-desc-input').value.trim();
  const concurrency = parseInt(document.getElementById('builder-concurrency-input').value) || 2;
  const channels = document.getElementById('builder-channels-input').value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const videos = document.getElementById('builder-videos-input').value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const steps = builderSteps.map((s, idx) => ({
    step_order: idx,
    step_type: s.step_type,
    name: s.name || `Step ${idx+1}: ${s.step_type}`,
    params: { ...(s.params || {}) },
    is_critical: s.is_critical !== false,
    retry_count: s.retry_count !== undefined ? s.retry_count : 2,
    timeout_seconds: s.timeout_seconds || 30.0
  }));

  return {
    name,
    description: desc || null,
    target_type: "youtube",
    concurrency_limit: concurrency,
    allowlist_channels: channels,
    allowlist_videos: videos,
    is_active: true,
    steps
  };
}

async function previewWorkflow() {
  const data = collectWorkflowBuilderData();
  const feedback = document.getElementById('builder-feedback');
  feedback.innerText = "Validating workflow structure and allowlist...";
  feedback.style.color = "var(--color-text-muted)";

  try {
    const res = await window.desktopBridge.api.validate_workflow(data);
    feedback.innerText = "";

    const banner = document.getElementById('preview-status-banner');
    if (res.valid) {
      banner.className = "preview-status-banner pass";
      banner.innerText = "Ã¢Å“â€œ Workflow is structurally valid and ready for execution.";
    } else {
      banner.className = "preview-status-banner fail";
      banner.innerText = "Ã¢Å“â€¢ Validation failed. Fix errors before executing.";
    }

    const prev = res.preview || {};
    document.getElementById('preview-meta-row').innerHTML = `
      <span><strong>Total Steps:</strong> ${prev.total_steps || data.steps.length}</span>
      <span><strong>Est. Runtime:</strong> ~${prev.estimated_duration_seconds || 0}s</span>
      <span><strong>Checkpoints:</strong> ${prev.safe_checkpoints || 0} safe points</span>
    `;

    const errCont = document.getElementById('preview-errors-container');
    const errList = document.getElementById('preview-errors-list');
    errList.innerHTML = "";
    if (res.errors && res.errors.length > 0) {
      res.errors.forEach(e => {
        const li = document.createElement('li');
        li.innerText = e;
        errList.appendChild(li);
      });
      errCont.style.display = 'block';
    } else {
      errCont.style.display = 'none';
    }

    const warnCont = document.getElementById('preview-warnings-container');
    const warnList = document.getElementById('preview-warnings-list');
    warnList.innerHTML = "";
    if (res.warnings && res.warnings.length > 0) {
      res.warnings.forEach(w => {
        const li = document.createElement('li');
        li.innerText = w;
        warnList.appendChild(li);
      });
      warnCont.style.display = 'block';
    } else {
      warnCont.style.display = 'none';
    }

    const seqList = document.getElementById('preview-steps-sequence');
    seqList.innerHTML = "";
    (prev.step_sequence || []).forEach(s => {
      const li = document.createElement('li');
      li.innerText = `${s.name} (${s.type}) Ã¢â‚¬â€ Timeout: ${s.timeout}s, Retries: ${s.retry_count}`;
      seqList.appendChild(li);
    });

    document.getElementById('workflow-preview-modal').style.display = 'flex';
  } catch (err) {
    feedback.innerText = `Validation error: ${err}`;
    feedback.style.color = "var(--color-danger)";
  }
}

async function saveWorkflow() {
  const data = collectWorkflowBuilderData();
  const feedback = document.getElementById('builder-feedback');

  if (!data.name) {
    feedback.innerText = "Workflow name is required.";
    feedback.style.color = "var(--color-danger)";
    return;
  }
  if (!data.steps || data.steps.length === 0) {
    feedback.innerText = "Workflow must have at least one step.";
    feedback.style.color = "var(--color-danger)";
    return;
  }

  feedback.innerText = "Saving workflow...";
  feedback.style.color = "var(--color-text-muted)";

  try {
    let res;
    if (currentBuilderWorkflowId) {
      res = await window.desktopBridge.api.update_workflow(currentBuilderWorkflowId, data);
    } else if (pendingAIWorkflow) {
      if (!pendingAICandidateId) {
        throw new Error('The generated candidate has expired or is unavailable. Generate a new draft.');
      }
      res = await window.desktopBridge.api.approve_ai_workflow(pendingAICandidateId, data, true);
    } else {
      res = await window.desktopBridge.api.create_workflow(data);
    }

    if (res.success) {
      document.getElementById('workflow-builder-modal').style.display = 'none';
      pendingAIWorkflow = null;
      pendingAICandidateId = null;
      await loadWorkflows();
    } else {
      feedback.innerText = `Save failed: ${res.error}`;
      feedback.style.color = "var(--color-danger)";
    }
  } catch (err) {
    feedback.innerText = `Save error: ${err}`;
    feedback.style.color = "var(--color-danger)";
  }
}

async function openLaunchWorkflowModal(wfId, wfName) {
  document.getElementById('launch-wf-id').value = wfId;
  document.getElementById('launch-wf-name').innerText = wfName;
  document.getElementById('launch-wf-feedback').innerText = "";

  const select = document.getElementById('launch-wf-profile-select');
  select.innerHTML = "<option>Loading profiles...</option>";

  try {
    const pods = await window.desktopBridge.api.list_pods();
    select.innerHTML = "";

    let hasProfiles = false;
    for (const pod of pods) {
      const profiles = await window.desktopBridge.api.list_profiles(pod.id);
      profiles.forEach(p => {
        hasProfiles = true;
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} (Pod: ${pod.name} | ${p.device_type})`;
        select.appendChild(opt);
      });
    }

    if (!hasProfiles) {
      select.innerHTML = "<option value=''>No browser profiles found. Create a profile in Pods first.</option>";
      document.getElementById('btn-submit-launch-wf').disabled = true;
    } else {
      document.getElementById('btn-submit-launch-wf').disabled = false;
    }

    document.getElementById('launch-workflow-modal').style.display = 'flex';
  } catch (err) {
    console.error("Failed to load profiles for workflow launch:", err);
  }
}

async function submitLaunchWorkflow() {
  const wfId = document.getElementById('launch-wf-id').value;
  const profId = document.getElementById('launch-wf-profile-select').value;
  const showCursor = document.getElementById('launch-wf-show-cursor').checked;
  const feedback = document.getElementById('launch-wf-feedback');

  if (!profId) {
    feedback.innerText = "Please select a target browser profile.";
    feedback.style.color = "var(--color-danger)";
    return;
  }

  feedback.innerText = "Queueing workflow execution...";
  feedback.style.color = "var(--color-text-muted)";

  try {
    const browserVisible = operationsSettings?.browser_visible ?? true;
    const res = await window.desktopBridge.api.launch_workflow(wfId, profId, !browserVisible, showCursor);
    if (res.success) {
      document.getElementById('launch-workflow-modal').style.display = 'none';
      startPollingWorkflowRun(res.run_id);
      await loadWorkflowRuns();
    } else {
      feedback.innerText = `Launch failed: ${res.error}`;
      feedback.style.color = "var(--color-danger)";
    }
  } catch (err) {
    feedback.innerText = `Launch error: ${err}`;
    feedback.style.color = "var(--color-danger)";
  }
}

async function loadWorkflowRuns() {
  try {
    if (!window.desktopBridge?.api?.list_workflow_runs) return;
    const runs = await window.desktopBridge.api.list_workflow_runs(null, null, 25);
    renderWorkflowRuns(runs);
  } catch (err) {
    console.error("Failed to load workflow runs:", err);
  }
}

function renderWorkflowRuns(runs) {
  const tbody = document.getElementById('workflow-runs-table-body');
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!runs || runs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--color-text-muted); padding: 24px;">
          No workflow runs recorded yet. Click "Run" on any workflow above to start execution.
        </td>
      </tr>
    `;
    return;
  }

  runs.forEach(r => {
    const tr = document.createElement('tr');
    tr.id = `run-row-${r.id}`;

    let statusClass = "badge-cyan";
    if (r.status === "COMPLETED") statusClass = "badge-green";
    else if (r.status === "FAILED") statusClass = "badge-red";
    else if (r.status === "RUNNING") statusClass = "badge-cyan";
    else if (r.status === "STOPPED") statusClass = "badge-amber";

    const metrics = r.metrics || {};
    let metricsText = "--";
    if (metrics.page_load_time_ms || metrics.playback_startup_delay_ms) {
      metricsText = `Page: ${metrics.page_load_time_ms || 0}ms | Play: ${metrics.playback_startup_delay_ms || 0}ms`;
    }

    const isRunning = ["STARTING", "RUNNING", "QUEUED"].includes(r.status);
    const canResume = ["FAILED", "STOPPED"].includes(r.status) && (r.checkpoint_step_index < r.total_steps);

    tr.innerHTML = `
      <td><span class="mono table-id-full run-id-label">${escapeHtml(String(r.id))}</span></td>
      <td><strong>${escapeHtml(r.workflow_name || 'Workflow')}</strong></td>
      <td><span class="mono table-id-full" title="${escapeAttribute(r.profile_id || '')}">${r.profile_id ? escapeHtml(String(r.profile_id)) : '--'}</span></td>
      <td><span class="badge ${statusClass}">${r.status}</span></td>
      <td>${r.passed_steps || 0} / ${r.total_steps || 0}</td>
      <td><span class="mono">Step ${r.checkpoint_step_index || 0}</span></td>
      <td><small style="color: var(--color-text-soft);">${metricsText}</small></td>
      <td><small>${r.created_at ? new Date(r.created_at).toLocaleTimeString() : '--'}</small></td>
      <td>
        <div class="table-actions">
          <button class="btn btn-secondary btn-sm" data-action="open-workflow-run" type="button">Details</button>
          ${isRunning ? `
            <button class="btn btn-danger-outline btn-sm" data-action="cancel-workflow-run" type="button">Cancel</button>
          ` : ''}
          ${canResume ? `
            <button class="btn btn-primary btn-sm" data-action="resume-workflow-run" type="button" title="Resume execution from checkpoint Step ${Number(r.checkpoint_step_index) || 0}">Resume</button>
          ` : ''}
        </div>
      </td>
    `;
    tr.querySelector('.run-id-label').title = String(r.id);
    tr.querySelectorAll('[data-action]').forEach(button => {
      button.dataset.runId = String(r.id);
    });
    tbody.appendChild(tr);

    if (isRunning && !activeWorkflowRunPollers.has(r.id)) {
      startPollingWorkflowRun(r.id);
    }
  });
}

function startPollingWorkflowRun(runId) {
  if (activeWorkflowRunPollers.has(runId)) return;

  const timer = setInterval(async () => {
    try {
      const res = await window.desktopBridge.api.get_workflow_run_status(runId);
      if (!res.found) {
        clearInterval(timer);
        activeWorkflowRunPollers.delete(runId);
        return;
      }

      const terminalStatuses = ["COMPLETED", "FAILED", "STOPPED"];
      if (terminalStatuses.includes(res.status)) {
        clearInterval(timer);
        activeWorkflowRunPollers.delete(runId);
      }

      await loadWorkflowRuns();
    } catch (err) {
      clearInterval(timer);
      activeWorkflowRunPollers.delete(runId);
    }
  }, 1500);

  activeWorkflowRunPollers.set(runId, timer);
}

async function cancelWorkflowRun(runId) {
  try {
    const res = await window.desktopBridge.api.cancel_workflow_run(runId);
    if (res.success) {
      await loadWorkflowRuns();
    } else {
      alert(`Could not cancel run: ${res.message || res.error}`);
    }
  } catch (err) {
    console.error("Failed to cancel workflow run:", err);
  }
}

async function resumeWorkflowRun(runId) {
  try {
    const res = await window.desktopBridge.api.resume_workflow_run(runId, true);
    if (res.success) {
      startPollingWorkflowRun(runId);
      await loadWorkflowRuns();
    } else {
      alert(`Could not resume run: ${res.error}`);
    }
  } catch (err) {
    console.error("Failed to resume workflow run:", err);
  }
}

async function openRunDetailsModal(runId) {
  try {
    const run = await window.desktopBridge.api.get_workflow_run_status(runId);
    if (!run || !run.found) return alert("Run details not found.");

    let statusBadge = `<span class="badge badge-cyan">${run.status}</span>`;
    if (run.status === "COMPLETED") statusBadge = `<span class="badge badge-green">COMPLETED</span>`;
    else if (run.status === "FAILED") statusBadge = `<span class="badge badge-red">FAILED</span>`;
    else if (run.status === "STOPPED") statusBadge = `<span class="badge badge-amber">STOPPED</span>`;

    document.getElementById('run-summary-bar').innerHTML = `
      <div>
        <strong>${escapeHtml(run.workflow_name)}</strong> &nbsp;|&nbsp;
        Run ID: <span class="mono">${run.id}</span> &nbsp;|&nbsp;
        Status: ${statusBadge}
      </div>
      <div>
        <span>Checkpoint: <strong>Step ${run.checkpoint_step_index}</strong></span> &nbsp;|&nbsp;
        <span>Passed: <strong>${run.passed_steps}/${run.total_steps}</strong></span>
      </div>
    `;

    const metrics = run.metrics || {};
    document.getElementById('run-metrics-grid').innerHTML = `
      <div class="metric-card">
        <span class="metric-index">01</span>
        <h4>Page Load Time</h4>
        <p class="metric-value text-accent">${metrics.page_load_time_ms ? `${metrics.page_load_time_ms} ms` : 'N/A'}</p>
      </div>
      <div class="metric-card">
        <span class="metric-index">02</span>
        <h4>Playback Startup Delay</h4>
        <p class="metric-value text-success">${metrics.playback_startup_delay_ms ? `${metrics.playback_startup_delay_ms} ms` : 'N/A'}</p>
      </div>
      <div class="metric-card">
        <span class="metric-index">03</span>
        <h4>Buffer Health</h4>
        <p class="metric-value">${metrics.buffer_health_seconds ? `${metrics.buffer_health_seconds} s` : 'Optimal'}</p>
      </div>
    `;

    const tbody = document.getElementById('run-step-results-tbody');
    tbody.innerHTML = "";

    const results = run.step_results || [];
    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted);">No step results recorded.</td></tr>`;
    } else {
      results.forEach((s, idx) => {
        const tr = document.createElement('tr');
        let sBadge = `<span class="badge badge-green">PASSED</span>`;
        if (s.status === "FAILED") sBadge = `<span class="badge badge-red">FAILED</span>`;
        else if (s.status === "SKIPPED") sBadge = `<span class="badge badge-amber">SKIPPED</span>`;

        const detailsText = s.error ? `<span style="color:var(--color-danger);">${escapeHtml(s.error)}</span>` : `<small style="color:var(--color-text-soft);">${escapeHtml(JSON.stringify(s.details || {}))}</small>`;

        let screenshotAction = "--";
        if (s.screenshot_path) {
          screenshotAction = '<button class="screenshot-thumbnail-btn" data-action="show-artifact-path" type="button">View Artifact</button>';
        }

        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td><span class="mono">${escapeHtml(s.step_type)}</span></td>
          <td>${sBadge}</td>
          <td>${s.duration_ms ? `${s.duration_ms} ms` : '--'}</td>
          <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${detailsText}</td>
          <td>${screenshotAction}</td>
        `;
        const artifactButton = tr.querySelector('[data-action="show-artifact-path"]');
        if (artifactButton) artifactButton.dataset.artifactPath = String(s.screenshot_path);
        tbody.appendChild(tr);
      });
    }

    document.getElementById('workflow-run-details-modal').style.display = 'flex';
  } catch (err) {
    console.error("Failed to load run details:", err);
  }
}
