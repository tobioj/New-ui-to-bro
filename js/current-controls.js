/* Frontend controls copied from the current read-only source (1d1fa0a).
   They call existing bridge methods; no backend or execution logic is changed. */
let builderKind = null;
let builderMode = "create";
Object.assign(DEFAULT_STEP_CONFIGS, {
  navigate_site: {
    name: "Open Site",
    params: { url: "https://example.com/" },
    timeout_seconds: 60.0,
    retry_count: 1,
    is_critical: true
  },
  wait: {
    name: "Wait",
    params: { seconds: 2 },
    timeout_seconds: 30.0,
    retry_count: 0,
    is_critical: false
  },
  scroll: {
    name: "Scroll",
    params: { pixels: 600 },
    timeout_seconds: 30.0,
    retry_count: 0,
    is_critical: false
  },
  click: {
    name: "Click Element",
    params: { selector: "" },
    timeout_seconds: 30.0,
    retry_count: 1,
    is_critical: true
  },
  read_title: {
    name: "Read Page Title",
    params: { expected_text: "" },
    timeout_seconds: 30.0,
    retry_count: 0,
    is_critical: false
  },
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
});

// Workflow kinds: the builder presents one family at a time (Site or YouTube).
const YOUTUBE_ONLY_STEP_TYPE_LIST = [
  'search_channel_video', 'verify_playback_start', 'pause_resume_seek',
  'verify_captions', 'verify_qualities', 'test_fullscreen',
  'navigate_tabs_playlist', 'check_description_links'
];

const BUILDER_STEP_OPTIONS = {
  site: [
    ['navigate_site', 'Browse: Open a Site (any URL)'],
    ['wait', 'Wait (seconds)'],
    ['scroll', 'Scroll (pixels)'],
    ['click', 'Click Element'],
    ['read_title', 'Read Page Title'],
    ['capture_screenshot', 'Capture Screenshot Artifact'],
    ['assert_element_text', 'Assert Element / Text Exists'],
    ['measure_timing', 'Measure Page Timings']
  ],
  youtube: [
    ['navigate', 'Navigate to YouTube URL / Channel / Video'],
    ['search_channel_video', 'Search Channel Video'],
    ['verify_playback_start', 'Verify Playback Starts'],
    ['pause_resume_seek', 'Pause, Resume & Seek'],
    ['verify_captions', 'Verify Captions & Languages'],
    ['verify_qualities', 'Verify Available Qualities'],
    ['test_fullscreen', 'Test Fullscreen Controls'],
    ['navigate_tabs_playlist', 'Navigate Tabs & Playlists'],
    ['check_description_links', 'Check Description & Links'],
    ['capture_screenshot', 'Capture Screenshot Artifact'],
    ['assert_element_text', 'Assert Element / Text Exists'],
    ['measure_timing', 'Measure Page Timings']
  ]
};

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
  document.getElementById('btn-builder-kind-site')?.addEventListener('click', () => chooseBuilderKind('site'));
  document.getElementById('btn-builder-kind-youtube')?.addEventListener('click', () => chooseBuilderKind('youtube'));
  document.getElementById('btn-builder-change-kind')?.addEventListener('click', resetBuilderKindChoice);
  document.getElementById('btn-builder-add-step')?.addEventListener('click', () => {
    if (!builderKind) return;
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

function openCreateWorkflowModal() {
  builderMode = 'create';
  currentBuilderWorkflowId = null;
  pendingAIWorkflow = null;
  pendingAICandidateId = null;
  document.getElementById('builder-workflow-id').value = "";
  document.getElementById('workflow-builder-title').innerText = "Create Workflow";
  document.getElementById('builder-name-input').value = "";
  document.getElementById('builder-desc-input').value = "";
  document.getElementById('builder-concurrency-input').value = 2;
  document.getElementById('builder-channels-input').value = "";
  document.getElementById('builder-videos-input').value = "";
  document.getElementById('builder-feedback').innerText = "";
  document.getElementById('btn-submit-workflow').innerText = "Save Workflow";

  builderSteps = [];
  applyBuilderKind(null);

  document.getElementById('workflow-builder-modal').style.display = 'flex';
}

function renderBuilderStepOptions(kind) {
  const select = document.getElementById('builder-step-type-select');
  if (!select) return;
  const options = BUILDER_STEP_OPTIONS[kind] || BUILDER_STEP_OPTIONS.site;
  select.innerHTML = '';
  options.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.innerText = label;
    select.appendChild(option);
  });
}

function builderKindForWorkflow(workflow) {
  if ((workflow.target_type || '').toLowerCase() === 'site') return 'site';
  const types = (workflow.steps || []).map(step => step.step_type);
  const hasSiteNavigation = types.includes('navigate_site');
  const hasYoutubeUse = types.some(type => type === 'navigate' || YOUTUBE_ONLY_STEP_TYPE_LIST.includes(type));
  return hasSiteNavigation && !hasYoutubeUse ? 'site' : 'youtube';
}

function applyBuilderKind(kind) {
  builderKind = kind;
  const chooser = document.getElementById('builder-kind-chooser');
  const fields = document.getElementById('builder-fields');
  const allowlists = document.getElementById('builder-allowlist-row');
  const changeLink = document.getElementById('btn-builder-change-kind');
  const showChooser = builderMode === 'create' && !kind;
  document.getElementById('btn-submit-workflow').disabled = showChooser;
  document.getElementById('btn-builder-preview-workflow').disabled = showChooser;
  if (chooser) chooser.style.display = showChooser ? '' : 'none';
  if (fields) fields.style.display = showChooser ? 'none' : '';
  if (allowlists) allowlists.style.display = kind === 'site' ? 'none' : '';
  if (changeLink) changeLink.style.display = (builderMode === 'create' && kind) ? '' : 'none';
  if (kind) renderBuilderStepOptions(kind);
}

function chooseBuilderKind(kind) {
  applyBuilderKind(kind);
  document.getElementById('workflow-builder-title').innerText =
    kind === 'site' ? "Create Site Workflow" : "Create YouTube Workflow";
  builderSteps = [];
  if (kind === 'site') {
    addBuilderStep('navigate_site');
  } else {
    addBuilderStep('navigate');
    addBuilderStep('verify_playback_start');
  }
  document.getElementById('builder-feedback').innerText = "";
}

function resetBuilderKindChoice() {
  builderSteps = [];
  applyBuilderKind(null);
  renderBuilderSteps();
  document.getElementById('workflow-builder-title').innerText = "Create Workflow";
  document.getElementById('builder-feedback').innerText = "Pick a workflow type to continue.";
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

    builderMode = 'edit';
    applyBuilderKind(builderKindForWorkflow(wf));

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

function renderStepParamInputs(step, index) {
  const p = step.params || {};
  const t = step.step_type;

  switch (t) {
    case 'navigate_site':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Target URL</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.url || '')}" placeholder="https://example.com/article" data-step-param="url">
        </div>
      `;
    case 'wait':
      return `
        <div class="form-group">
          <label>Wait (Seconds)</label>
          <input type="number" step="0.5" min="0.1" max="300" class="input-field" value="${escapeAttribute(p.seconds || 2)}" data-step-param="seconds" data-value-type="float">
        </div>
      `;
    case 'scroll':
      return `
        <div class="form-group">
          <label>Scroll (Pixels, negative scrolls up)</label>
          <input type="number" step="50" class="input-field" value="${escapeAttribute(p.pixels || 600)}" data-step-param="pixels" data-value-type="int">
        </div>
      `;
    case 'click':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>CSS Selector</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.selector || '')}" placeholder="button.load-more" data-step-param="selector">
        </div>
      `;
    case 'read_title':
      return `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Expected Title Contains (optional)</label>
          <input type="text" class="input-field" value="${escapeAttribute(p.expected_text || '')}" placeholder="Leave blank to record the title only" data-step-param="expected_text">
        </div>
      `;
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
  builderMode = 'ai';
  applyBuilderKind('youtube');
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
    target_type: builderKind === 'site' ? 'site' : 'youtube',
    concurrency_limit: concurrency,
    allowlist_channels: channels,
    allowlist_videos: videos,
    is_active: true,
    steps
  };
}

let spendGuardTiers = [];

function inputNum(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const raw = String(el.value ?? '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function elementNum(el) {
  if (!el) return null;
  const raw = String(el.value ?? '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function setSpendGuardValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value === null || value === undefined ? '' : value;
}

function formatGbs(bytes) {
  return (Number(bytes || 0) / 1e9).toFixed(3);
}

async function loadSpendGuard() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('sg-feedback');
  if (typeof api?.get_spend_guard !== 'function') {
    if (feedback) feedback.innerText = 'Spend guard bridge is unavailable in this process — restart the app.';
    return;
  }
  try {
    const snapshot = await api.get_spend_guard();
    if (!snapshot.success) throw new Error(snapshot.error || 'Spend guard unavailable.');
    renderSpendGuard(snapshot);
    if (feedback) feedback.innerText = '';
  } catch (err) {
    if (feedback) feedback.innerText = `Could not load the spend guard: ${err.message || err}`;
  }
}

function renderSpendGuard(snapshot) {
  const cfg = snapshot.config || {};
  setSpendGuardValue('sg-fleet-gb', cfg.fleet_daily_gb);
  setSpendGuardValue('sg-fleet-usd', cfg.fleet_daily_usd);
  setSpendGuardValue('sg-profile-gb', cfg.profile_daily_gb);
  setSpendGuardValue('sg-profile-usd', cfg.profile_daily_usd);
  setSpendGuardValue('sg-run-ceiling', cfg.run_ceiling_mb);
  setSpendGuardValue('sg-warn-pct', cfg.warn_pct != null ? cfg.warn_pct : 80);
  setSpendGuardValue('sg-margin-pct', cfg.safety_margin_pct != null ? cfg.safety_margin_pct : 0);
  setSpendGuardValue('sg-timezone', cfg.timezone || '');
  spendGuardTiers = snapshot.tiers || [];
  renderSpendGuardTiers();
  const state = document.getElementById('spend-guard-state');
  if (state) state.innerText = snapshot.limits_active ? 'Enforcing' : 'Metering only';
  renderSpendGuardReadout(snapshot);
}

function renderSpendGuardTiers() {
  const body = document.getElementById('sg-tier-body');
  if (!body) return;
  body.innerHTML = '';
  if (!spendGuardTiers.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:14px; color:var(--color-text-muted);">No tiers yet — add one to price your exits.</td></tr>';
    return;
  }
  spendGuardTiers.forEach(tier => {
    const row = document.createElement('tr');
    const rollPolicy = tier.ip_roll_policy || 'continue';
    row.innerHTML = `
      <td><input class="input-field" data-tier-name value="${escapeHtml(tier.name)}"></td>
      <td><input class="input-field" type="number" min="0" step="0.01" data-tier-price value="${tier.price_per_gb ?? ''}" placeholder="unset"></td>
      <td><input class="input-field" type="number" min="0" step="0.1" data-tier-cap value="${tier.monthly_gb_cap ?? ''}" placeholder="unset"></td>
      <td><input class="input-field" type="number" min="1" max="1440" step="1" data-tier-pin value="${tier.session_duration_minutes ?? ''}" placeholder="120"></td>
      <td><select class="input-field" data-tier-roll><option value="continue"${rollPolicy === 'continue' ? ' selected' : ''}>continue</option><option value="abort_on_roll"${rollPolicy === 'abort_on_roll' ? ' selected' : ''}>abort on roll</option></select></td>
      <td>${Number(tier.assigned_proxies || 0)}</td>
      <td><div class="table-actions"><button class="btn btn-secondary btn-sm" data-tier-save type="button">Save</button><button class="btn btn-danger-outline btn-sm" data-tier-delete type="button">Delete</button></div></td>`;
    row.querySelector('[data-tier-save]')?.addEventListener('click', () => saveSpendGuardTier(tier.id, row));
    row.querySelector('[data-tier-delete]')?.addEventListener('click', () => deleteSpendGuardTier(tier.id, tier.name));
    body.appendChild(row);
  });
}

function renderSpendGuardReadout(snapshot) {
  const node = document.getElementById('sg-readout');
  if (!node) return;
  const fleet = snapshot.fleet || {};
  const cfg = snapshot.config || {};
  const bits = [`Today (${snapshot.timezone}): ${formatGbs(fleet.bytes)} GB`];
  if (Number(fleet.cost_usd || 0) > 0) bits.push(`$${Number(fleet.cost_usd).toFixed(2)} spent`);
  if (Number(fleet.holds_bytes || 0) > 0) bits.push(`${formatGbs(fleet.holds_bytes)} GB in-flight holds`);
  if (cfg.fleet_daily_gb != null) bits.push(`fleet ${formatGbs(fleet.effective_bytes)}/${Number(cfg.fleet_daily_gb).toFixed(2)} GB effective`);
  if (cfg.fleet_daily_usd != null) bits.push(`$${Number(fleet.effective_cost_usd || 0).toFixed(2)}/$${Number(cfg.fleet_daily_usd).toFixed(2)}`);
  const lines = [bits.join(' · ')];
  (snapshot.tiers || []).filter(tier => Number(tier.day_bytes || 0) > 0).forEach(tier => {
    lines.push(`${tier.name}: ${formatGbs(tier.day_bytes)} GB today${tier.price_per_gb != null ? ` · $${Number(tier.day_cost_usd || 0).toFixed(2)}` : ' · unpriced'}${tier.monthly_gb_cap != null ? ` · month ${formatGbs(tier.month_bytes)}/${Number(tier.monthly_gb_cap).toFixed(2)} GB` : ''}`);
  });
  (snapshot.profiles || []).slice(0, 5).forEach(profile => {
    lines.push(`profile ${profile.name || profile.profile_id}: ${formatGbs(profile.bytes)} GB${Number(profile.cost_usd || 0) > 0 ? ` · $${Number(profile.cost_usd).toFixed(2)}` : ''}`);
  });
  if (snapshot.unpriced_active_exits) {
    lines.push(`${snapshot.unpriced_active_exits} active exit(s) unpriced — GB counts, $ budgets cannot see them.`);
  }
  if (!snapshot.limits_active) {
    lines.push('No limits set — metering only; nothing refuses until you set a budget.');
  }
  node.innerText = lines.join('\n');
}

async function saveSpendGuard() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('sg-feedback');
  if (typeof api?.update_spend_guard !== 'function') return;
  const payload = {
    fleet_daily_gb: inputNum('sg-fleet-gb'),
    fleet_daily_usd: inputNum('sg-fleet-usd'),
    profile_daily_gb: inputNum('sg-profile-gb'),
    profile_daily_usd: inputNum('sg-profile-usd'),
    run_ceiling_mb: inputNum('sg-run-ceiling'),
    warn_pct: inputNum('sg-warn-pct') ?? 80,
    safety_margin_pct: inputNum('sg-margin-pct') ?? 0,
    timezone: document.getElementById('sg-timezone')?.value.trim() || null,
  };
  const result = await api.update_spend_guard(payload);
  if (!result.success) {
    const errors = (result.errors || []).map(entry => `${entry.field}: ${entry.reason}`);
    if (feedback) feedback.innerText = errors.join(' · ') || result.error || 'Save failed.';
    return;
  }
  await loadSpendGuard();
  await loadManualSpendReadout();
  if (feedback) feedback.innerText = 'Spend guard saved.';
}

async function saveSpendGuardTier(tierId, row) {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('sg-feedback');
  if (typeof api?.update_proxy_tier !== 'function') return;
  const payload = {
    name: row.querySelector('[data-tier-name]')?.value.trim() || '',
    price_per_gb: elementNum(row.querySelector('[data-tier-price]')),
    monthly_gb_cap: elementNum(row.querySelector('[data-tier-cap]')),
    session_duration_minutes: elementNum(row.querySelector('[data-tier-pin]')),
    ip_roll_policy: row.querySelector('[data-tier-roll]')?.value || null,
  };
  const result = await api.update_proxy_tier(tierId, payload);
  const message = result.success ? 'Tier saved — past spend keeps its snapshot.' : (result.error || 'Tier update failed.');
  await loadSpendGuard();
  if (feedback) feedback.innerText = message;
}

async function deleteSpendGuardTier(tierId, name) {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('sg-feedback');
  if (typeof api?.delete_proxy_tier !== 'function') return;
  if (!confirm(`Delete tier "${name}"? Refused while any exit is assigned.`)) return;
  const result = await api.delete_proxy_tier(tierId);
  const message = result.success ? 'Tier deleted.' : (result.error || 'Tier delete failed.');
  await loadSpendGuard();
  if (feedback) feedback.innerText = message;
}

async function addSpendGuardTier() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('sg-feedback');
  if (typeof api?.create_proxy_tier !== 'function') return;
  const payload = {
    name: document.getElementById('sg-tier-name')?.value.trim() || '',
    price_per_gb: inputNum('sg-tier-price'),
    monthly_gb_cap: inputNum('sg-tier-cap'),
    session_duration_minutes: inputNum('sg-tier-pin'),
    ip_roll_policy: document.getElementById('sg-tier-roll')?.value || null,
  };
  if (!payload.name) {
    if (feedback) feedback.innerText = 'Tier name is required.';
    return;
  }
  const result = await api.create_proxy_tier(payload);
  if (result.success) {
    setSpendGuardValue('sg-tier-name', '');
    setSpendGuardValue('sg-tier-price', '');
    setSpendGuardValue('sg-tier-cap', '');
    setSpendGuardValue('sg-tier-pin', '');
    const rollSelect = document.getElementById('sg-tier-roll');
    if (rollSelect) rollSelect.value = 'continue';
    await loadSpendGuard();
  }
  if (feedback) feedback.innerText = result.success ? 'Tier added.' : (result.error || 'Tier could not be created.');
}

async function loadManualSpendReadout() {
  const node = document.getElementById('manual-spend-readout');
  if (!node) return;
  const api = window.desktopBridge && window.desktopBridge.api;
  if (typeof api?.get_spend_guard !== 'function') return;
  try {
    const snapshot = await api.get_spend_guard();
    if (!snapshot?.success) return;
    const fleet = snapshot.fleet || {};
    const cfg = snapshot.config || {};
    let text = `Today (${snapshot.timezone}): ${formatGbs(fleet.bytes)} GB metered`;
    if (Number(fleet.cost_usd || 0) > 0) text += ` · $${Number(fleet.cost_usd).toFixed(2)}`;
    if (cfg.fleet_daily_gb != null || cfg.fleet_daily_usd != null) {
      const bits = [];
      if (cfg.fleet_daily_gb != null) bits.push(`${formatGbs(fleet.effective_bytes)}/${Number(cfg.fleet_daily_gb).toFixed(2)} GB`);
      if (cfg.fleet_daily_usd != null) bits.push(`$${Number(fleet.effective_cost_usd || 0).toFixed(2)}/$${Number(cfg.fleet_daily_usd).toFixed(2)}`);
      text += ` · fleet budget ${bits.join(' · ')}`;
    } else {
      text += ' · no budgets set (metering only)';
    }
    if (snapshot.unpriced_active_exits) text += ` · ${snapshot.unpriced_active_exits} exit(s) unpriced`;
    node.innerText = `${text}. Paid reads always count; the guard never blocks your own session.`;
  } catch (err) {
    console.error('Spend readout failed:', err);
  }
}

// Current-source UI contracts: task-specific scheduling, routed manual reads,
// keep-open local runs and dispatch preview invalidation. Backend remains untouched.
async function populateOnboardingScheduleOptions() {
  const profileSelect = document.getElementById('schedule-onboarding-profile');
  const proxySelect = document.getElementById('schedule-onboarding-proxy');
  if (!profileSelect || !proxySelect) return;
  const api = window.desktopBridge?.api;
  if (!api?.list_pods || !api?.list_proxies) return;
  const selectedProfile = profileSelect.value;
  const selectedProxy = proxySelect.value;
  profileSelect.innerHTML = '<option value="">Onboarding profile…</option>';
  proxySelect.innerHTML = '<option value="">Onboarding exit (proxy)…</option>';
  try {
    const pods = await api.list_pods();
    for (const pod of pods) {
      const profiles = await api.list_profiles(pod.id);
      profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = String(profile.id);
        option.innerText = `${profile.name} (Pod: ${pod.name})`;
        profileSelect.appendChild(option);
      });
    }
    const proxies = await api.list_proxies();
    proxies.filter(proxy => proxy.is_active && !proxy.is_retired).forEach(proxy => {
      const option = document.createElement('option');
      option.value = String(proxy.id);
      option.innerText = `${proxy.country || 'Unknown region'} · ${proxy.proxy_type} · ${proxy.server}`;
      proxySelect.appendChild(option);
    });
    if (selectedProfile) profileSelect.value = selectedProfile;
    if (selectedProxy) proxySelect.value = selectedProxy;
  } catch (error) {
    console.warn('Could not load Onboarding schedule options:', error);
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
    setOperationsFeedback('Saving validated settings…', 'muted', 'operations-settings-feedback');
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
    setOperationsFeedback('Creating and verifying a SQLite snapshot…');
    const result = await window.desktopBridge.api.create_database_snapshot();
    setOperationsFeedback(result.success ? `Snapshot created: ${result.path} (${formatOperationsBytes(result.size_bytes)})` : result.error, result.success ? 'success' : 'danger');
    if (result.success) await loadOperationsOverview();
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
    const approved = confirm(`Diagnostic export includes:\n• ${preview.includes.join('\n• ')}\n\nIt excludes:\n• ${preview.excludes.join('\n• ')}\n\nCreate the redacted ZIP?`);
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
    loadManualSpendReadout();
    setupManualExitPicker();
    populateManualExitOptions();
    syncManualExitVisibility();
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
  populateManualExitOptions();
}

let manualExitPickerWired = false;

function setupManualExitPicker() {
  const checkbox = document.getElementById('manual-use-proxy');
  if (!checkbox || manualExitPickerWired) return;
  manualExitPickerWired = true;
  checkbox.addEventListener('change', syncManualExitVisibility);
  // The exit list is profile-specific: refilter when the profile changes.
  const profileSelect = document.getElementById('manual-profile-select');
  if (profileSelect) profileSelect.addEventListener('change', () => { populateManualExitOptions(); });
}

function syncManualExitVisibility() {
  const group = document.getElementById('manual-exit-group');
  const on = Boolean(document.getElementById('manual-use-proxy')?.checked);
  if (group) group.style.display = on ? '' : 'none';
}

async function populateManualExitOptions() {
  const select = document.getElementById('manual-exit-select');
  if (!select || typeof window.desktopBridge?.api?.list_proxies !== 'function') return;
  try {
    const current = select.value;
    const profiles = (localDeskOptions && localDeskOptions.profiles) || [];
    const profileId = document.getElementById('manual-profile-select')?.value || '';
    const row = profiles.find(profile => String(profile.id) === String(profileId)) || null;
    let region = null;
    if (row && row.region_id) {
      const catalogue = await window.desktopBridge.api.list_regions();
      region = ((catalogue && catalogue.regions) || []).find(item => item.id === row.region_id) || null;
    }
    const proxies = await window.desktopBridge.api.list_proxies();
    const active = (proxies || []).filter(proxy => proxy.is_active && !proxy.is_retired);
    // Coherence (2026-10-11): stamped profiles only ever see their own
    // region's exits; Scratch and other unbound profiles may use any exit.
    const coherent = active.filter(proxy => {
      if (!region) return true;
      return String(proxy.country || '').trim().toUpperCase() === String(region.country_code || '').trim().toUpperCase()
        && String(proxy.city || '').trim().toLowerCase() === String(region.proxy_city || '').trim().toLowerCase();
    });
    select.replaceChildren(new Option('Automatic — region-matched exit', ''));
    coherent.forEach(proxy => {
      const location = [proxy.city, proxy.country].filter(Boolean).join(', ');
      const label = [proxy.server, location].filter(Boolean).join(' · ');
      select.add(new Option(label, proxy.id));
    });
    if (region && !coherent.length) {
      const option = new Option(`No exit matches ${region.name} (${region.proxy_city}) — add one in Proxy Inventory`, '');
      option.disabled = true;
      select.add(option);
    }
    if (current && [...select.options].some(option => option.value === current)) select.value = current;
  } catch (error) {
    console.warn('Could not load manual exits:', error);
  }
}

async function openManualBrowser() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('manual-feedback');
  if (typeof api?.launch_manual_session !== 'function') return;
  const profileId = document.getElementById('manual-profile-select')?.value;
  const url = document.getElementById('manual-url-input')?.value.trim() || '';
  const useProxy = Boolean(document.getElementById('manual-use-proxy')?.checked);
  const proxyId = document.getElementById('manual-exit-select')?.value || '';
  if (!profileId) {
    if (feedback) feedback.innerText = 'Pick a profile first.';
    return;
  }
  if (feedback && useProxy) {
    feedback.innerText = proxyId
      ? 'Opening through the selected residential exit — metered egress.'
      : 'Opening through the region-matched residential exit — metered egress.';
  }
  const result = await api.launch_manual_session(profileId, url, useProxy, proxyId);
  if (feedback) {
    feedback.innerText = result.success ? result.message : (result.error || 'Could not open the browser.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
  await loadManualTab();
}

async function runLocalTasks() {
  const api = window.desktopBridge && window.desktopBridge.api;
  const feedback = document.getElementById('local-run-feedback');
  if (typeof api?.run_local_tasks !== 'function' || !localTasksPreviewValid) return;
  const profileId = document.getElementById('local-profile-select')?.value;
  const targetUrl = document.getElementById('local-target-url')?.value.trim() || '';
  const tasks = document.getElementById('local-tasks-input')?.value || '';
  const keepOpen = Boolean(document.getElementById('local-keep-open')?.checked);
  const result = await api.run_local_tasks(profileId, targetUrl, tasks, keepOpen);
  if (feedback) {
    const reasons = (result.errors || [{ reason: result.error }]).map(item => item.reason).filter(Boolean);
    feedback.innerText = result.success ? result.message : (reasons.join(' · ') || 'Could not start the run.');
    feedback.style.color = result.success ? 'var(--color-success, #22c55e)' : 'var(--color-danger)';
  }
  if (result.success) {
    localTasksPreviewValid = false;
    const runButton = document.getElementById('btn-local-run');
    if (runButton) runButton.disabled = true;
  }
  await loadManualTab();
}

function invalidateDispatchPreview() {
  if (!dispatchPreview) return;
  dispatchPreview = null;
  setDispatchConfirmEnabled(false);
  toggleElementDisplay('dispatch-preview-card', false);
  renderDispatchErrors([]);
}

function setupDeployUI() {
  document.getElementById('btn-deploy-reload')?.addEventListener('click', () => loadDeployTab());
  document.getElementById('btn-dispatch-preview')?.addEventListener('click', () => previewDispatch());
  document.getElementById('btn-dispatch-confirm')?.addEventListener('click', () => confirmDispatch());
  ['dispatch-target-mode', 'dispatch-placement-mode', 'dispatch-cadence-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', syncDispatchFieldVisibility);
  });
  dispatchComposerFieldIds().forEach(id => {
    const field = document.getElementById(id);
    if (!field) return;
    field.addEventListener('input', invalidateDispatchPreview);
    field.addEventListener('change', invalidateDispatchPreview);
  });
}

function dispatchComposerFieldIds() {
  return [
    'dispatch-name', 'dispatch-workflow-select', 'dispatch-target-mode',
    'dispatch-target-pod', 'dispatch-target-profiles', 'dispatch-placement-mode',
    'dispatch-region', 'dispatch-country', 'dispatch-cadence-mode',
    'dispatch-start-at', 'dispatch-interval-minutes',
  ];
}
