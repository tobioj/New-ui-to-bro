/* Pod workspace. Uses the existing bridge methods and preserves their
   separate save boundaries in Profileh the browser preview and desktop app. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => escapeHtml(String(value ?? '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const behaviorContract = window.BehaviorContract;
  const playbookContract = window.PlaybookContract;
  const drafts = new Map();
  const views = ['overview', 'profiles', 'targets', 'mission', 'playbook', 'behavior', 'usage', 'activity'];
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    profiles: '<circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
    targets: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
    mission: '<path d="M3 18c4-12 8 5 13-7 1-2 3-3 5-3"/><circle cx="3" cy="18" r="2"/><circle cx="21" cy="8" r="2"/>',
    playbook: '<path d="M5 4h13a2 2 0 0 1 2 2v14H7a3 3 0 0 0-3 3V6a2 2 0 0 1 1-2z"/><path d="M4 19c0-2 1-3 3-3h13M9 9h6M9 12h4"/>',
    behavior: '<path d="M4 19V5M10 19V5M16 19V5M22 19V5"/><circle cx="4" cy="10" r="2"/><circle cx="10" cy="15" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="22" cy="13" r="2"/>',
    activity: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    usage: '<path d="M4 20V9M10 20V4M16 20v-8M22 20V7"/>',
    campaign: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    campaigns: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    playbooks: '<path d="M5 4h13a2 2 0 0 1 2 2v14H7a3 3 0 0 0-3 3V6a2 2 0 0 1 1-2z"/><path d="M4 19c0-2 1-3 3-3h13M9 9h6M9 12h4"/>',
    sessions: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="17" r="2"/>',
    rhythm: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    visibility: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="17" cy="13" r="1"/>',
    safety: '<path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5z"/><path d="M8 12h2l1.5-3 2 6 1.5-3H17"/>',
    admission: '<path d="M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h14M9 12h12m-4-4 4 4-4 4"/>',
    personas: '<circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
    naming: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z"/><circle cx="8" cy="8" r="1"/>',
    safeguards: '<path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>'
  };
  const icon = key => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || icons.overview}</svg>`;
  const api = () => window.desktopBridge?.api;
  const pod = () => podsById?.get?.(selectedPodId) || null;
  const draft = id => {
    if (!drafts.has(id)) drafts.set(id, { target: null, targetDirty: false, targetMessage: '', playbook: null, playbookDirty: false, behavior: null, behaviorDirty: false, mission: null, missionDirty: false, rhythm: null, rhythmDirty: false, budget: null, budgetDirty: false });
    return drafts.get(id);
  };
  let activeView = 'profiles';
  let targetPreview = null;

  function show(view, updateRoute = false) {
    activeView = views.includes(view) ? view : 'profiles';
    $('profile-section')?.classList.toggle('pod-profiles-visible', activeView === 'profiles');
    const showAction = (id, visible) => { const button = $(id); if (button) button.hidden = !visible; };
    showAction('btn-configure-selected-pod', ['overview', 'profiles'].includes(activeView));
    showAction('btn-open-create-profile', activeView === 'profiles');
    showAction('btn-open-bulk-create', activeView === 'profiles');
    showAction('btn-delete-selected-pod', activeView === 'overview');
    document.querySelectorAll('.pod-workspace-nav button').forEach(button => {
      const selected = button.dataset.podView === activeView;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    document.querySelectorAll('#profile-section [data-pod-panel]').forEach(panel => { panel.hidden = panel.dataset.podPanel !== activeView; });
    if (updateRoute && selectedPodId) location.hash = `#/operate/pods?pod=${encodeURIComponent(selectedPodId)}&view=${activeView}`;
    if (selectedPodId && !['profiles', 'activity'].includes(activeView)) refresh(selectedPodId, activeView);
    if (activeView === 'activity') renderActivity();
  }

  function build() {
    const root = $('profile-section');
    if (!root || root.querySelector('.pod-workspace-nav')) return;
    const podStrip = $('pod-list-container'); const newPodButton = $('btn-open-create-pod');
    if (podStrip && newPodButton) {
      const controls = newPodButton.parentElement;
      for (const [direction, label, glyph] of [['prev','Previous pods','‹'],['next','Next pods','›']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'pod-strip-arrow'; button.setAttribute('aria-label', label); button.textContent = glyph;
        controls.insertBefore(button, newPodButton);
        button.addEventListener('click', () => podStrip.scrollBy({ left: (direction === 'next' ? 1 : -1) * Math.max(240, podStrip.clientWidth * 0.7), behavior: 'smooth' }));
      }
      const updateArrows = () => { const [prev,next] = controls.querySelectorAll('.pod-strip-arrow'); prev.disabled = podStrip.scrollLeft <= 2; next.disabled = podStrip.scrollLeft + podStrip.clientWidth >= podStrip.scrollWidth - 2; };
      podStrip.addEventListener('scroll', updateArrows); window.addEventListener('resize', updateArrows); new MutationObserver(updateArrows).observe(podStrip, { childList: true }); setTimeout(updateArrows, 0);
    }
    const header = root.querySelector('.section-header');
    const actions = header.querySelector('.header-actions');
    const configure = document.createElement('button');
    configure.id = 'btn-configure-selected-pod'; configure.type = 'button'; configure.className = 'btn btn-secondary pod-configure-button';
    configure.innerHTML = `${icon('behavior')}<span>Configure pod</span>`;
    configure.setAttribute('aria-label', 'Configure selected pod');
    actions.prepend(configure);
    configure.addEventListener('click', () => show('targets', true));
    const nav = document.createElement('nav'); nav.className = 'pod-workspace-nav'; nav.setAttribute('aria-label', 'Selected pod sections');
    const labels = { overview: 'Overview', profiles: 'Profiles', targets: 'Targets', mission: 'Mission', playbook: 'Onboarding', behavior: 'Behavior', usage: 'Usage & budget', activity: 'Activity' };
    nav.innerHTML = views.map(key => `<button type="button" data-pod-view="${key}">${icon(key)}<span>${labels[key]}</span></button>`).join('');
    header.after(nav);
    nav.addEventListener('click', event => { const button = event.target.closest('[data-pod-view]'); if (button) show(button.dataset.podView, true); });
    const table = root.querySelector('.table-container');
    const profiles = document.createElement('section'); profiles.dataset.podPanel = 'profiles'; profiles.className = 'pod-workspace-panel';
    table.before(profiles); profiles.append(table);
    views.filter(key => key !== 'profiles').forEach(key => {
      const section = document.createElement('section'); section.dataset.podPanel = key; section.className = 'pod-workspace-panel';
      section.hidden = true; root.append(section);
    });
    const bulk = document.createElement('button'); bulk.id = 'btn-open-bulk-create'; bulk.type = 'button'; bulk.className = 'btn btn-secondary pod-bulk-button'; bulk.innerHTML = `${icon('profiles')}<span>Bulk create</span>`;
    actions.insertBefore(bulk, $('btn-open-create-profile'));
    bulk.addEventListener('click', openBulk);
    const dialog = document.createElement('dialog'); dialog.id = 'pod-bulk-dialog'; dialog.className = 'pod-bulk-dialog'; dialog.setAttribute('aria-label', 'Bulk create profiles'); document.body.append(dialog);
    root.addEventListener('input', event => {
      if (!selectedPodId) return;
      const section = event.target.closest('[data-pod-panel]');
      if (section?.dataset.podPanel === 'targets') { draft(selectedPodId).targetDirty = true; draft(selectedPodId).targetMessage = ''; draft(selectedPodId).target = readTarget(); targetPreview = null; $('pod-target-apply').disabled = true; }
      if (section?.dataset.podPanel === 'playbook') { draft(selectedPodId).playbookDirty = true; draft(selectedPodId).playbook = readPlaybook(); }
      if (section?.dataset.podPanel === 'behavior') { draft(selectedPodId).behaviorDirty = true; draft(selectedPodId).behavior = readBehavior(); }
      if (section?.dataset.podPanel === 'mission') { draft(selectedPodId).missionDirty = true; draft(selectedPodId).mission = readMission(); }
      if (section?.dataset.podPanel === 'playbook' && event.target.matches('[data-pod-rhythm]')) { draft(selectedPodId).rhythmDirty = true; draft(selectedPodId).rhythm = readRhythm(); }
      if (section?.dataset.podPanel === 'usage') { draft(selectedPodId).budgetDirty = true; draft(selectedPodId).budget = readBudget(); }
    });
    root.addEventListener('change', event => {
      if (!selectedPodId) return;
      const section = event.target.closest('[data-pod-panel]');
      if (section?.dataset.podPanel === 'targets') { draft(selectedPodId).targetDirty = true; draft(selectedPodId).targetMessage = ''; draft(selectedPodId).target = readTarget(); targetPreview = null; $('pod-target-apply').disabled = true; }
      if (section?.dataset.podPanel === 'playbook') { draft(selectedPodId).playbookDirty = true; draft(selectedPodId).playbook = readPlaybook(); }
      if (section?.dataset.podPanel === 'behavior') { draft(selectedPodId).behaviorDirty = true; draft(selectedPodId).behavior = readBehavior(); }
      if (section?.dataset.podPanel === 'mission') { draft(selectedPodId).missionDirty = true; draft(selectedPodId).mission = readMission(); }
      if (section?.dataset.podPanel === 'playbook' && event.target.matches('[data-pod-rhythm]')) { draft(selectedPodId).rhythmDirty = true; draft(selectedPodId).rhythm = readRhythm(); }
      if (section?.dataset.podPanel === 'usage') { draft(selectedPodId).budgetDirty = true; draft(selectedPodId).budget = readBudget(); }
    });
    show('profiles');
  }

  function capture(id) {
    if (!id || !$('profile-section')?.offsetParent) return;
    const state = draft(id);
    if (state.targetDirty) state.target = readTarget();
    if (state.playbookDirty) state.playbook = readPlaybook();
    if (state.behaviorDirty) state.behavior = readBehavior();
    if (state.missionDirty) state.mission = readMission();
    if (state.rhythmDirty) state.rhythm = readRhythm();
    if (state.budgetDirty) state.budget = readBudget();
  }

  function renderOverview() {
    const current = pod(); if (!current) return;
    const profiles = $('profile-table-body')?.rows?.length || 0;
    const entry = document.createElement('div');
    entry.className = 'pod-overview';
    entry.innerHTML = `<div class="pod-overview-intro"><span class="pod-eyebrow">POD WORKSPACE</span><h4>At a glance</h4><p>Manage the target, profiles, playbook and session overrides in one place. Global safety policy remains in Configuration.</p></div><dl><div><dt>Profiles</dt><dd>${esc(current.profile_count ?? profiles)}</dd></div><div><dt>Target</dt><dd>${esc(current.target_url || 'Not set')}</dd></div><div><dt>Pod ID</dt><dd class="mono">${esc(current.id)}</dd></div></dl><div class="pod-overview-actions"><button type="button" data-overview-view="targets" class="btn btn-primary">Edit targets</button><button type="button" data-overview-view="profiles" class="btn btn-secondary">View profiles</button></div>`;
    const container = document.querySelector('[data-pod-panel="overview"]'); container.replaceChildren(entry);
    entry.addEventListener('click', event => { const button = event.target.closest('[data-overview-view]'); if (button) show(button.dataset.overviewView, true); });
  }

  function readTarget() {
    const root = document.querySelector('[data-pod-panel="targets"]'); if (!root) return {};
    const value = key => root.querySelector(`[data-pod-target="${key}"]`)?.value || '';
    return { target_url: value('target_url').trim() || null, region_id: value('region_id') || null, playback_quality: value('playback_quality') || null,
      channels: value('channels').split(/[,\n]/).map(x => x.trim()).filter(Boolean), videos: value('videos').split(/[,\n]/).map(x => x.trim()).filter(Boolean),
      sync_workflow_ids: [...root.querySelectorAll('[data-pod-target="workflow"]:checked')].map(x => x.value) };
  }
  async function renderTargets(id) {
    const bundle = await api()?.get_customization_inputs?.();
    if (id !== selectedPodId || activeView !== 'targets') return;
    const panel = document.querySelector('[data-pod-panel="targets"]');
    if (!bundle?.success) { panel.innerHTML = '<p class="workspace-empty">Pod target settings are unavailable from this bridge.</p>'; return; }
    const current = (bundle.inputs?.campaign || []).find(row => String(row.pod_id) === String(id)) || {};
    const option = (bundle.options?.pods || []).find(row => String(row.id) === String(id)) || pod() || {};
    const state = draft(id);
    const row = state.targetDirty && state.target ? state.target : current;
    const regions = (bundle.options?.regions || []).map(region => `<option value="${esc(region.id)}" ${row.region_id === region.id ? 'selected' : ''}>${esc(region.name)} · ${esc(region.city)}</option>`).join('');
    const qualities = [['','Inherit app default'],['data_saver','Data saver'],['standard','Standard'],['high','High'],['uncapped','Uncapped']].map(([key,label]) => `<option value="${key}" ${row.playback_quality === key ? 'selected' : ''}>${label}</option>`).join('');
    const workflows = (bundle.options?.workflows || []).map(wf => `<label class="pod-check"><input type="checkbox" data-pod-target="workflow" value="${esc(wf.id)}" ${(row.sync_workflow_ids || []).includes(wf.id) ? 'checked' : ''}><span>${esc(wf.name)}<small>${esc(wf.channel_count)} channels · ${esc(wf.video_count)} videos now</small></span></label>`).join('') || '<p class="pod-muted">No workflows available.</p>';
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">CAMPAIGN · THIS POD</span><h4>Targets & placement</h4><p>Drives Target sessions — gated watch on this pod’s promotion URL. Onboarding and missions never read this. Preview shows inherited-profile placement and any workflow allowlists that will be rewritten.</p></div><span class="pod-scope-label">Pod-specific</span></div>
      <div class="pod-field-grid"><label>Target URL<input class="input-field" data-pod-target="target_url" value="${esc(row.target_url ?? option.target_url ?? '')}" placeholder="https://youtube.com/@channel"></label><label>Region placement<select class="input-field" data-pod-target="region_id"><option value="">Keep current region</option>${regions}</select></label><label>Playback quality<select class="input-field" data-pod-target="playback_quality">${qualities}</select></label></div>
      <div class="pod-split"><label>Channel targets<span class="pod-hint">One per line or comma-separated</span><textarea class="input-field" data-pod-target="channels" rows="4" placeholder="@channel">${esc((row.channels || []).join('\n'))}</textarea></label><label>Video targets<span class="pod-hint">One per line or comma-separated</span><textarea class="input-field" data-pod-target="videos" rows="4" placeholder="Video ID">${esc((row.videos || []).join('\n'))}</textarea></label></div>
      <div class="pod-divider"><h5>QA workflow allowlists (optional)</h5><p>Only relevant when you run Workflow QA checks — pushes these channels and videos into the selected workflows’ allowlists when you apply.</p><div class="pod-check-list">${workflows}</div></div>
      <div class="pod-savebar"><span class="pod-save-note" id="pod-target-note">${state.targetDirty ? 'Unsaved draft retained while you navigate.' : 'Preview before applying.'}</span><button class="btn btn-secondary" type="button" id="pod-target-preview">Preview effects</button><button class="btn btn-primary" type="button" id="pod-target-apply" disabled>Apply target changes</button></div><div id="pod-target-effects" class="pod-effects" aria-live="polite">${state.targetMessage ? `<strong>${esc(state.targetMessage)}</strong>` : ''}</div>`;
    $('pod-target-preview').addEventListener('click', () => previewTargets(id));
    $('pod-target-apply').addEventListener('click', () => applyTargets(id));
  }
  async function prepareTargetPayload(id, values) {
    const latest = await api().get_customization_inputs();
    if (!latest?.success) throw new Error(latest?.error || 'Could not load current settings.');
    const all = latest.inputs || {};
    const campaign = [...(all.campaign || [])];
    const index = campaign.findIndex(row => String(row.pod_id) === String(id));
    const row = { ...(index < 0 ? {} : campaign[index]), ...values, pod_id: id };
    if (index < 0) campaign.push(row); else campaign[index] = row;
    return { ...all, campaign };
  }
  async function previewTargets(id) {
    const effects = $('pod-target-effects'); const values = readTarget(); draft(id).target = values;
    try {
      const result = await api().preview_customization_inputs(await prepareTargetPayload(id, values));
      if (!result?.success || !result.valid) throw new Error((result?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || result?.error || 'Preview failed.');
      targetPreview = { id, values };
      const changes = (result.effects?.pod_changes || []).filter(item => String(item.pod_id) === String(id));
      const writes = result.effects?.workflow_writes || [];
      effects.innerHTML = `<strong>Preview ready</strong><p>${changes.length ? `${changes.length} pod change${changes.length === 1 ? '' : 's'}` : 'No pod field changes'} · ${writes.length} workflow allowlist write${writes.length === 1 ? '' : 's'} · ${esc(result.effects?.affected_profiles ?? 0)} inherited profile${result.effects?.affected_profiles === 1 ? '' : 's'} potentially affected.</p><small>Apply will revalidate against the latest stored settings.</small>`;
      $('pod-target-apply').disabled = false; $('pod-target-note').textContent = 'Validated against current settings.';
    } catch (error) { targetPreview = null; $('pod-target-apply').disabled = true; effects.textContent = error.message; }
  }
  async function applyTargets(id) {
    if (!targetPreview || targetPreview.id !== id) return;
    const effects = $('pod-target-effects'); const button = $('pod-target-apply'); button.disabled = true;
    try {
      const current = readTarget();
      const preview = await api().preview_customization_inputs(await prepareTargetPayload(id, current));
      if (!preview?.success || !preview.valid) throw new Error((preview?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || 'Settings changed; preview again.');
      const result = await api().apply_customization_inputs(preview.normalized);
      if (!result?.success) throw new Error((result?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || result?.error || 'Apply failed.');
      draft(id).targetDirty = false; draft(id).target = null; draft(id).targetMessage = `Target settings applied · ${(result.applied || []).length} persisted effects.`; targetPreview = null;
      await loadCustomizationInputs(); await loadPods();
      show('targets');
    } catch (error) { effects.textContent = error.message; }
  }

  const missionDefaults = () => ({ mode: 'media_onboarding', hybrid_warm_share: 0.5, sites: [], entry_mix: { direct: 0.15, search: 0.7, social: 0.15 }, depth_min: 2, depth_max: 5, dwell_min_seconds: 15, dwell_max_seconds: 90, clickthrough: 0.35, return_visit_share: 0.25, media_policy: { block_heavy_media: true, allow_domains: [] } });
  function readMission() {
    const panel = document.querySelector('[data-pod-panel="mission"]');
    const modeEl = panel?.querySelector('[data-mission="mode"]');
    if (!modeEl) return draft(selectedPodId).mission || { mode: 'media_onboarding', hybrid_warm_share: 0.5 };
    const hybrid = panel.querySelector('[data-mission="hybrid_warm_share"]');
    const share = hybrid && hybrid.value !== '' ? Math.min(100, Math.max(0, Number(hybrid.value))) / 100 : 0.5;
    return { mode: modeEl.value, hybrid_warm_share: share };
  }
  async function renderMission(id) {
    const panel = document.querySelector('[data-pod-panel="mission"]');
    const snapshot = await api()?.get_playbook?.();
    let traffic = null;
    try { traffic = await api()?.get_site_traffic?.(); } catch (error) { traffic = null; }
    if (id !== selectedPodId || activeView !== 'mission') return;
    if (!snapshot?.success) { panel.innerHTML = '<p class="workspace-empty">Mission settings are unavailable from this bridge.</p>'; return; }
    const state = draft(id);
    const mission = { mode: 'media_onboarding', hybrid_warm_share: 0.5, ...(state.missionDirty ? state.mission : snapshot.config?.pods?.[id]?.mission || {}) };
    const bound = (traffic?.sites || []).find(site => (site.bound_pod_ids || []).includes(id)) || null;
    const eligible = bound ? (bound.eligibility || []).find(item => item.pod_id === id) : null;
    const siteLine = bound
      ? `Bound site: <strong>${esc(bound.url)}</strong> · ${bound.page_count || 0} pages synced${eligible ? ` · ${eligible.eligible} of ${eligible.total} profiles eligible now` : ''}`
      : 'No site bound to this pod yet.';
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">W2 · POD MISSION</span><h4>What this pod visits</h4><p>The switch between YouTube Onboarding and site visits. Sites, sitemaps, tags, visit plans and gates are configured in <a class="pod-scope-link" href="#/operate/site-traffic">Site Traffic ↗</a>.</p></div><span class="pod-scope-label">Pod-specific</span></div>
      <div class="pod-mission-top"><label>Mode<select class="input-field" data-mission="mode"><option value="media_onboarding" ${mission.mode === 'media_onboarding' ? 'selected' : ''}>Onboarding recipes (YouTube)</option><option value="site_traffic" ${mission.mode === 'site_traffic' ? 'selected' : ''}>Site traffic (your sites)</option><option value="hybrid" ${mission.mode === 'hybrid' ? 'selected' : ''}>Hybrid (Profileh, split)</option></select></label><label data-hybrid-only>YouTube share in hybrid (%)<input class="input-field" data-mission="hybrid_warm_share" type="number" min="0" max="100" value="${esc(Math.round((mission.hybrid_warm_share ?? 0.5) * 100))}"></label><div class="pod-mission-note">${siteLine} <a href="#/operate/site-traffic">Open Site Traffic ↗</a></div></div>
      <div class="pod-savebar"><span class="pod-save-note">${state.missionDirty ? 'Unsaved draft retained.' : (mission.mode === 'media_onboarding' ? 'Fires run YouTube Onboarding recipes.' : 'Fires visit your sites — no video opens.')}</span><button class="btn btn-primary" type="button" id="pod-mission-save">Save mission</button></div><div class="pod-effects" id="pod-mission-feedback" aria-live="polite"></div>`;
    const syncMode = () => { const mode = panel.querySelector('[data-mission="mode"]').value; panel.querySelector('[data-hybrid-only]').hidden = mode !== 'hybrid'; panel.querySelector('.pod-mission-top').classList.toggle('has-hybrid-share', mode === 'hybrid'); };
    panel.querySelector('[data-mission="mode"]').addEventListener('change', syncMode); syncMode();
    $('pod-mission-save').addEventListener('click', () => saveMission(id));
  }
  async function saveMission(id) {
    const feedback = $('pod-mission-feedback');
    try {
      const rows = readMission();
      const latest = await api().get_playbook(); if (!latest?.success) throw new Error('Could not refresh current playbook.');
      const row = { ...(latest.config?.pods?.[id] || {}) };
      const mission = { ...(row.mission || {}), mode: rows.mode };
      if (rows.mode === 'hybrid') mission.hybrid_warm_share = rows.hybrid_warm_share;
      let traffic = null;
      try { traffic = await api().get_site_traffic?.(); } catch (error) { traffic = null; }
      if (mission.mode === 'media_onboarding') { mission.sites = []; }
      else if (!(mission.sites || []).length) {
        const bound = (traffic?.sites || []).find(site => (site.bound_pod_ids || []).includes(id)) || null;
        if (!bound) throw new Error('Bind a site in Site Traffic first (Site Traffic → Sites).');
        mission.sites = [{ url: bound.url, weight: 1, sitemap: true, pages: [] }];
      }
      row.mission = mission;
      const result = await api().update_playbook({ pods: { [id]: row } });
      if (!result?.success) throw new Error(errorText(result));
      draft(id).missionDirty = false; draft(id).mission = null; await renderMission(id);
      $('pod-mission-feedback').textContent = 'Mission saved for future scheduled fires.';
    } catch (error) { feedback.textContent = error.message; }
  }

  function readPlaybook() {
    const panel = document.querySelector('[data-pod-panel="playbook"]'); if (!panel) return {};
    const verticals = {};
    panel.querySelectorAll('[data-pod-vertical]').forEach(input => { if (input.value !== '') verticals[input.dataset.podVertical] = Number(input.value); });
    const query_extra = {};
    panel.querySelectorAll('[data-pod-extra]').forEach(input => {
      const lines = playbookContract.unique(input.value.split('\n'));
      if (lines.length) query_extra[input.dataset.podExtra] = lines;
    });
    const Onboarding = {};
    panel.querySelectorAll('[data-pod-onb]').forEach(input => {
      if (input.value === '') return;
      Onboarding[input.dataset.podWarm] = input.dataset.kind === 'bool' ? input.value === 'true' : Number(input.value);
    });
    return { verticals, query_extra, Onboarding };
  }
  async function renderPlaybook(id) {
    const panel = document.querySelector('[data-pod-panel="playbook"]');
    if (!api()?.get_playbook) { panel.innerHTML = '<p class="workspace-empty">Fleet Playbooks are not available from this bridge.</p>'; return; }
    const [snapshot, personas, rhythmSnapshot] = await Promise.all([api().get_playbook(), api().list_personas?.() || [], api().get_rhythm?.() || null]);
    if (id !== selectedPodId || activeView !== 'playbook') return;
    const current = snapshot?.config?.pods?.[id] || {};
    const state = draft(id); const row = state.playbookDirty && state.playbook ? state.playbook : current;
    const verticalRows = (personas || []).map(persona => `<label class="pod-inline-field"><span>${esc(persona.name)}<small>${esc(persona.key)}</small></span><input class="input-field" type="number" min="0" max="100" step="any" placeholder="Not in pod mix" data-pod-vertical="${esc(persona.key)}" value="${esc(row.verticals?.[persona.key] ?? '')}"></label>`).join('');
    const queryExtras = (personas || []).map(persona => `<label>${esc(persona.name)}<small class="pod-hint">${esc(persona.key)} · one additional query per line</small><textarea class="input-field" data-pod-extra="${esc(persona.key)}" rows="3" placeholder="No pod-only queries">${esc((row.query_extra?.[persona.key] || []).join('\n'))}</textarea></label>`).join('');
    const warm = (key, label, min, max) => `<label>${label}<input class="input-field" type="number" min="${min}" max="${max}" data-pod-onb="${key}" value="${esc(row.Onboarding?.[key] ?? '')}" placeholder="Inherit"></label>`;
    const boolean = (key, label) => `<label>${label}<select class="input-field" data-pod-onb="${key}" data-kind="bool"><option value="">Inherit global</option><option value="true" ${row.Onboarding?.[key] === true ? 'selected' : ''}>On</option><option value="false" ${row.Onboarding?.[key] === false ? 'selected' : ''}>Off</option></select></label>`;
    const rhythmRow = state.rhythmDirty ? state.rhythm : rhythmSnapshot?.config?.pods?.[id] || {};
    const rhythmSpecs = [['daily_minutes_cap','Daily minutes cap',0,1440],['rest_start_hour','Rest start hour',0,23],['rest_end_hour','Rest end hour',0,23],['same_target_cooldown_minutes','Target cooldown (minutes)',0,1440],['exit_alternation_runs','Exit alternation (runs)',0,10]];
    const rhythmNumbers = rhythmSpecs.map(([key,label,min,max]) => `<label>${label}<input class="input-field" data-pod-rhythm="${key}" type="number" min="${min}" max="${max}" value="${esc(rhythmRow?.[key] ?? '')}" placeholder="Inherit"></label>`).join('');
    const rhythmBool = (key,label) => `<label>${label}<select class="input-field" data-pod-rhythm="${key}" data-kind="bool"><option value="">Inherit</option><option value="true" ${rhythmRow?.[key] === true ? 'selected' : ''}>On</option><option value="false" ${rhythmRow?.[key] === false ? 'selected' : ''}>Off</option></select></label>`;
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">POD PLAYBOOK</span><h4>Direction & Onboarding</h4><p>Choose this pod’s complete persona mix, add pod-only queries, and override its Onboarding regimen. The shared flow studio stays in Fleet Playbooks.</p></div><a class="pod-scope-link" href="#/configure/customization/playbooks">Shared playbook ↗</a></div>
      <div class="pod-divider pod-divider-first"><h5>Onboarding regimen</h5><p>Cadence and duration band for future scheduled profile Onboarding fires. The session steps come from Fleet Playbooks (Customization → Fleet Playbooks).</p><div class="pod-field-grid">${boolean('enabled','Warm-up')}${boolean('watch_videos','Include watching')}${warm('sessions_per_day','Sessions per profile / day',1,12)}${warm('session_minutes_min','Minimum minutes',5,60)}${warm('session_minutes_max','Maximum minutes',5,120)}${warm('min_gap_minutes','Spacing floor (minutes)',0,720)}</div></div>
      <details class="pod-behavior-group"><summary>${icon('playbook')}<span>Persona direction</span><small>${Object.keys(row.verticals || {}).length ? 'Pod mix replaces global mix' : 'Inherits global mix'}</small></summary><p class="pod-playbook-helper">A pod mix replaces the whole global mix. Once you set any weight, blank personas are excluded; use 0 to show an explicit exclusion. Clear every weight to inherit the global mix.</p><div class="pod-field-grid">${verticalRows || '<p>No personas available.</p>'}</div></details>
      <details class="pod-behavior-group"><summary>${icon('playbook')}<span>Additional queries</span><small>Pod-only · added to shared pools</small></summary><p class="pod-playbook-helper">These queries append to each persona’s global pool for this pod. Blank means no extras.</p><div class="pod-field-grid pod-query-extra-grid">${queryExtras || '<p>No personas available.</p>'}</div></details>
      <div class="pod-savebar"><span class="pod-save-note">${state.playbookDirty ? 'Unsaved draft retained.' : 'Applies to future sessions for this pod.'}</span><button class="btn btn-secondary" type="button" id="pod-playbook-preview">Preview this pod</button><button class="btn btn-secondary" type="button" id="pod-playbook-reset">Clear direction, queries & Onboarding</button><button class="btn btn-primary" type="button" id="pod-playbook-save">Save pod playbook</button></div><div id="pod-playbook-feedback" class="pod-effects" aria-live="polite"></div>
      <details class="pod-behavior-group pod-rhythm-details"><summary>${icon('rhythm')}<span>Scheduled-fire rhythm</span><small>Optional pod overrides</small></summary><div class="pod-field-grid">${rhythmNumbers}${rhythmBool('daily_sessions_cap_enabled','Persona session cap')}${rhythmBool('active_hours_acceptance','Active-hours acceptance')}${rhythmBool('correlation_enabled','Fleet correlation')}<label>Rest source<select class="input-field" data-pod-rhythm="rest_source"><option value="">Inherit</option>${['persona','fixed','off'].map(x => `<option value="${x}" ${rhythmRow?.rest_source === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><div class="pod-savebar"><span class="pod-save-note">Global rhythm enablement remains global. Manual runs are human-timed.</span><button class="btn btn-secondary" type="button" id="pod-rhythm-reset">Clear overrides</button><button class="btn btn-primary" type="button" id="pod-rhythm-save">Save rhythm</button></div><div id="pod-rhythm-feedback" class="pod-effects" aria-live="polite"></div></details>
      <div class="pod-divider pod-provision"><div class="pod-compact-heading"><div><h5>Provision profile schedules</h5><p>Create or update one Onboarding task schedule per profile. No direct-egress fallback.</p></div><a href="#/operate/schedules">View task schedules ↗</a></div><label class="pod-check-inline"><input id="pod-auto-exits" type="checkbox">Claim region-matched exits when needed</label><div class="pod-savebar"><span class="pod-save-note">Review skipped profiles and newly assigned exits.</span><button class="btn btn-primary" type="button" id="pod-provision-regimen">Apply regimen to schedules</button></div><div id="pod-provision-feedback" class="pod-effects" aria-live="polite"></div></div>`;
    $('pod-playbook-save').addEventListener('click', () => savePlaybook(id));
    $('pod-playbook-reset').addEventListener('click', () => savePlaybook(id, true));
    $('pod-playbook-preview').addEventListener('click', async () => {
      const feedback = $('pod-playbook-feedback');
      try {
        const latest = await api().get_playbook(); if (!latest?.success) throw new Error('Could not load the current playbook.');
        const values = readPlaybook(); const next = { ...(latest.config?.pods?.[id] || {}) };
        for (const key of ['verticals', 'Onboarding', 'query_extra']) { if (Object.keys(values[key]).length) next[key] = values[key]; else next[key] = null; }
        const result = await api().preview_playbook(id, { pods: { [id]: next } });
        if (!result?.success) throw new Error(errorText(result));
        feedback.innerHTML = playbookPreviewHtml(result);
      } catch (error) { feedback.textContent = error.message; }
    });
    $('pod-rhythm-save').addEventListener('click', () => saveRhythm(id));
    $('pod-rhythm-reset').addEventListener('click', () => saveRhythm(id, true));
    $('pod-provision-regimen').addEventListener('click', () => provisionRegimen(id));
  }
  async function savePlaybook(id, reset = false) {
    const feedback = $('pod-playbook-feedback');
    try {
      const values = reset ? {} : readPlaybook();
      const latest = await api().get_playbook(); if (!latest?.success) throw new Error('Could not refresh current pod settings.');
      const row = { ...(latest.config?.pods?.[id] || {}) };
      if (reset || !Object.keys(values.verticals).length) row.verticals = null; else row.verticals = values.verticals;
      if (reset || !Object.keys(values.Onboarding).length) row.Onboarding = null; else row.Onboarding = values.Onboarding;
      if (reset || !Object.keys(values.query_extra).length) row.query_extra = null; else row.query_extra = values.query_extra;
      const result = await api().update_playbook({ pods: { [id]: row } });
      if (!result?.success) throw new Error((result?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || result?.error || 'Save failed.');
      draft(id).playbookDirty = false; draft(id).playbook = null;
      await renderPlaybook(id); $('pod-playbook-feedback').textContent = reset ? 'Pod playbook now inherits.' : 'Pod playbook saved for future work.';
    } catch (error) { feedback.textContent = error.message; }
  }

  function readRhythm() {
    const row = {};
    document.querySelectorAll('[data-pod-panel="playbook"] [data-pod-rhythm]').forEach(input => {
      if (input.value !== '') row[input.dataset.podRhythm] = input.dataset.kind === 'bool' ? input.value === 'true' : input.dataset.podRhythm === 'rest_source' ? input.value : Number(input.value);
    });
    return row;
  }
  async function saveRhythm(id, reset = false) {
    const feedback = $('pod-rhythm-feedback');
    try {
      const latest = await api().get_rhythm(); if (!latest?.success) throw new Error('Rhythm settings unavailable.');
      const pods = { ...(latest.config?.pods || {}) }; const row = reset ? {} : readRhythm();
      if (Object.keys(row).length) pods[id] = row; else delete pods[id];
      const result = await api().update_rhythm({ ...latest.config, pods }); if (!result?.success) throw new Error(errorText(result));
      draft(id).rhythmDirty = false; draft(id).rhythm = null; await renderPlaybook(id);
      $('pod-rhythm-feedback').textContent = reset ? 'Pod rhythm now inherits global policy.' : 'Pod rhythm saved for scheduled fires.';
    } catch (error) { feedback.textContent = error.message; }
  }
  async function provisionRegimen(id) {
    const feedback = $('pod-provision-feedback'); const button = $('pod-provision-regimen'); button.disabled = true;
    try {
      const result = await api().apply_Onboarding_regimen(id, '', $('pod-auto-exits').checked);
      if (!result?.success) throw new Error(errorText(result));
      feedback.innerHTML = `<strong>Provisioning complete</strong><p>${esc(result.created?.length || 0)} created · ${esc(result.updated?.length || 0)} updated · ${esc(result.skipped?.length || 0)} skipped · ${esc(result.auto_assigned?.length || 0)} exits claimed.</p><small>Cadence: every ${esc(result.interval_hours)} hours. Skipped profiles need an exit or another stated prerequisite.</small>`;
    } catch (error) { feedback.textContent = error.message; } finally { button.disabled = false; }
  }

  const behaviorLabels = { mix: 'Entry mix & routes', watch: 'Watch & reading', physics: 'Interaction physics' };
  const behaviorName = key => key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const behaviorErrors = errors => errors.map(item => `${item.field}: ${item.reason}`).join(' · ');
  function behaviorValue(input) {
    if (input.dataset.kind === 'bool') return input.value === 'true';
    if (input.dataset.kind === 'array') return input.value.trim() === '[]' ? [] : input.value.split(',').map(x => x.trim()).filter(Boolean);
    return input.value.trim() === '' ? NaN : Number(input.value);
  }
  function behaviorField(field, value, inherited, scope) {
    const { section, key, kind } = field;
    const data = scope === 'pod'
      ? `data-behavior-section="${section}" data-behavior-key="${key}"`
      : `data-global-behavior="${section}:${key}"`;
    let control;
    if (kind === 'bool') {
      control = `<select class="input-field" data-kind="bool" ${data}>${scope === 'pod' ? `<option value="">Inherit (${inherited ? 'on' : 'off'})</option>` : ''}<option value="true" ${value === true ? 'selected' : ''}>On</option><option value="false" ${value === false ? 'selected' : ''}>Off</option></select>`;
    } else {
      const display = kind === 'array' ? (Array.isArray(value) ? (scope === 'pod' && !value.length ? '[]' : value.join(', ')) : '') : (value ?? '');
      const placeholder = scope === 'pod' ? `placeholder="Inherit: ${esc(Array.isArray(inherited) ? (inherited.join(', ') || 'none') : inherited)}"` : '';
      const bounds = kind === 'number' ? `type="number" step="any" min="${field.min}" max="${field.max}"` : 'type="text"';
      control = `<input class="input-field" data-kind="${kind}" ${data} ${bounds} ${placeholder} ${scope === 'global' ? 'required' : ''} value="${esc(display)}">`;
    }
    const hint = kind === 'array' ? `<small class="pod-hint">Comma-separated fidget kinds${scope === 'pod' ? '; [] disables none' : ''}.</small>` : '';
    return `<label class="pod-behavior-field"><span>${esc(behaviorName(key))}</span>${control}${hint}</label>`;
  }
  function readBehavior() {
    const panel = document.querySelector('[data-pod-panel="behavior"]'); const result = {};
    panel?.querySelectorAll('[data-behavior-section]').forEach(input => {
      if (input.value === '') return;
      const section = input.dataset.behaviorSection;
      result[section] ||= {};
      result[section][input.dataset.behaviorKey] = behaviorValue(input);
    });
    return result;
  }
  async function renderBehavior(id) {
    const panel = document.querySelector('[data-pod-panel="behavior"]');
    if (!api()?.get_behavior) { panel.innerHTML = '<p class="workspace-empty">Pod behavior overrides are not available from this bridge.</p>'; return; }
    const snapshot = await (api().get_behavior_effective?.(id) || api().get_behavior()); const config = snapshot?.config || {};
    if (id !== selectedPodId || activeView !== 'behavior') return;
    const state = draft(id); const row = state.behaviorDirty && state.behavior ? state.behavior : snapshot?.pod_row || config.pods?.[id] || {};
    const groups = Object.keys(behaviorLabels).map(section => {
      const fields = behaviorContract.fields.filter(field => field.section === section)
        .map(field => behaviorField(field, row[section]?.[field.key], config[section]?.[field.key] ?? field.default, 'pod')).join('');
      return `<details class="pod-behavior-group" ${section === 'mix' ? 'open' : ''}><summary>${icon('behavior')}<span>${behaviorLabels[section]}</span><small>${Object.keys(row[section] || {}).length} override${Object.keys(row[section] || {}).length === 1 ? '' : 's'}</small></summary><div class="pod-field-grid">${fields}</div></details>`;
    }).join('');
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">SESSION BEHAVIOR · THIS POD</span><h4>Override only what differs</h4><p>Each blank field inherits the global value. Profile overrides, where set, still take precedence over this pod.</p></div><span class="pod-scope-label">Revision ${esc(snapshot?.revision || '—')}</span></div>${groups}<div class="pod-savebar"><span class="pod-save-note">${state.behaviorDirty ? 'Unsaved draft retained.' : 'Applies to future sessions.'}</span><button class="btn btn-secondary" type="button" id="pod-behavior-preview">Preview pod plans</button><button class="btn btn-secondary" type="button" id="pod-behavior-reset">Reset to inherit</button><button class="btn btn-primary" type="button" id="pod-behavior-save">Save pod behavior</button></div><div id="pod-behavior-feedback" class="pod-effects" aria-live="polite"></div>`;
    $('pod-behavior-save').addEventListener('click', () => saveBehavior(id));
    $('pod-behavior-reset').addEventListener('click', () => saveBehavior(id, true));
    $('pod-behavior-preview').addEventListener('click', async () => {
      const feedback = $('pod-behavior-feedback');
      try {
        const row = readBehavior();
        const resolved = behaviorContract.effective(config, row);
        const errors = behaviorContract.validate(resolved);
        if (errors.length) throw new Error(behaviorErrors(errors));
        // The backend treats an empty draft pod row as "use the stored row".
        // Preview the fully resolved draft instead when every override is cleared.
        const result = Object.keys(row).length
          ? await api().preview_behavior({ pods: { [id]: row } }, id)
          : await api().preview_behavior({ mix: resolved.mix, watch: resolved.watch, physics: resolved.physics });
        if (!result?.success) throw new Error(errorText(result));
        feedback.innerHTML = `<strong>${esc(result.sessions)} sample plans</strong><p>${esc(kvSummary(result.entry_mix))}</p><small>Dry preview only · ${esc(result.avg_watch_seconds ?? '—')}s average watch</small>`;
      } catch (error) { feedback.textContent = error.message; }
    });
  }
  async function saveBehavior(id, reset = false) {
    const feedback = $('pod-behavior-feedback');
    try {
      const latest = await api().get_behavior(); if (!latest?.success) throw new Error('Could not refresh behavior settings.');
      const pods = { ...(latest.config?.pods || {}) }; const row = reset ? {} : readBehavior();
      const errors = behaviorContract.validate(behaviorContract.effective(latest.config, row));
      if (errors.length) throw new Error(behaviorErrors(errors));
      if (Object.keys(row).length) pods[id] = row; else delete pods[id];
      const result = await api().update_behavior({ pods });
      if (!result?.success) throw new Error((result?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || result?.error || 'Save failed.');
      draft(id).behaviorDirty = false; draft(id).behavior = null;
      await renderBehavior(id); $('pod-behavior-feedback').textContent = reset ? 'Pod now inherits global behavior.' : 'Pod behavior saved for future sessions.';
    } catch (error) { feedback.textContent = error.message; }
  }

  function readBudget() {
    const panel = document.querySelector('[data-pod-panel="usage"]'); const value = key => panel?.querySelector(`[data-pod-budget="${key}"]`)?.value ?? '';
    return { daily_gb: value('daily_gb') === '' ? null : Number(value('daily_gb')), daily_usd: value('daily_usd') === '' ? null : Number(value('daily_usd')) };
  }
  async function renderUsage(id) {
    const panel = document.querySelector('[data-pod-panel="usage"]');
    if (!api()?.get_pod_reporting || !api()?.get_spend_guard) { panel.innerHTML = '<p class="workspace-empty">Pod reporting and budgets are unavailable from this bridge.</p>'; return; }
    const [report, spend] = await Promise.all([api().get_pod_reporting(), api().get_spend_guard()]);
    if (id !== selectedPodId || activeView !== 'usage') return;
    if (!report?.success || !spend?.success) { panel.textContent = report?.error || spend?.error || 'Could not load pod usage.'; return; }
    const row = (report.pods || []).find(item => String(item.pod_id) === String(id)) || {};
    const state = draft(id); const budget = state.budgetDirty ? state.budget : spend.config?.pods?.[id] || {};
    const limit = (used, cap, unit) => cap == null ? `${Number(used || 0).toFixed(unit === 'GB' ? 3 : 2)} ${unit} · no pod limit` : `${Number(used || 0).toFixed(unit === 'GB' ? 3 : 2)} / ${Number(cap).toFixed(unit === 'GB' ? 3 : 2)} ${unit}`;
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">W4 · SCALE OPERATIONS</span><h4>Today’s pod ledger</h4><p>Usage shares the Spend Guard day boundary: ${esc(report.window?.timezone || spend.timezone || 'local timezone')}.</p></div><span class="pod-scope-label">${esc(row.profiles ?? 0)} profiles</span></div>
      <div class="pod-usage-strip"><div><small>Runs today</small><strong>${esc(row.runs_today ?? 0)}</strong></div><div><small>Site runs</small><strong>${esc(row.site_runs_today ?? 0)}</strong></div><div><small>Sampled site pages</small><strong>${esc(row.site_pages_today ?? 0)}</strong></div><div><small>Watch minutes</small><strong>${esc(row.watch_minutes_today ?? 0)}</strong></div></div>
      <div class="pod-usage-meter"><div><span>Measured traffic</span><strong>${esc(limit(row.gb_today, budget.daily_gb, 'GB'))}</strong></div><div><span>Estimated cost</span><strong>${esc(limit(row.cost_usd_today, budget.daily_usd, 'USD'))}</strong></div></div>
      <div class="pod-divider"><h5>Daily admission budget</h5><p>At least one limit is required for a pod budget; leave Profileh blank to remove it. Fleet and per-profile limits still apply.</p><div class="pod-field-grid"><label>Daily traffic limit (GB)<input class="input-field" data-pod-budget="daily_gb" type="number" min="0" step="0.001" value="${esc(budget.daily_gb ?? '')}" placeholder="No pod limit"></label><label>Daily cost limit (USD)<input class="input-field" data-pod-budget="daily_usd" type="number" min="0" step="0.01" value="${esc(budget.daily_usd ?? '')}" placeholder="No pod limit"></label></div><div class="pod-savebar"><span class="pod-save-note">${state.budgetDirty ? 'Unsaved draft retained.' : 'Admission evaluates this before new sessions.'}</span><button class="btn btn-primary" type="button" id="pod-budget-save">Save pod budget</button></div><div id="pod-budget-feedback" class="pod-effects" aria-live="polite"></div></div>
      <div class="pod-divider"><h5>Box headroom</h5><p>${esc(report.box?.active_browsers ?? '—')} active browsers / ${esc(report.box?.max_concurrency ?? '—')} concurrent slots · ${esc(report.box?.ram_available_pct ?? '—')}% RAM available.</p><div class="pod-link-list"><a href="#/monitor/reports">${icon('activity')}<span>Inspect run evidence<small>SITE path hops are attempted/sampled pages, not verified pageviews.</small></span><b>↗</b></a></div></div>`;
    $('pod-budget-save').addEventListener('click', () => saveBudget(id));
  }
  async function saveBudget(id) {
    const feedback = $('pod-budget-feedback');
    try { const latest = await api().get_spend_guard(); if (!latest?.success) throw new Error('Could not refresh Spend Guard.'); const pods = { ...(latest.config?.pods || {}) }; const row = readBudget(); if (row.daily_gb == null && row.daily_usd == null) delete pods[id]; else pods[id] = row; const result = await api().update_spend_guard({ ...latest.config, pods }); if (!result?.success) throw new Error(errorText(result)); draft(id).budgetDirty = false; draft(id).budget = null; await renderUsage(id); $('pod-budget-feedback').textContent = row.daily_gb == null && row.daily_usd == null ? 'Pod budget removed; wider limits still apply.' : 'Pod budget saved for admission checks.'; }
    catch (error) { feedback.textContent = error.message; }
  }

  let bulkPreview = null;
  async function openBulk() {
    if (!selectedPodId) return;
    const dialog = $('pod-bulk-dialog'); const current = pod();
    const regions = await api()?.list_regions?.(); const options = (regions?.regions || []).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    dialog.innerHTML = `<form method="dialog" class="pod-bulk-shell"><div class="pod-bulk-head"><div><span class="pod-eyebrow">W4 · CAPACITY PREVIEW</span><h3>Bulk profiles for ${esc(current?.name || 'this pod')}</h3></div><button class="pod-icon-button" value="cancel" aria-label="Close">×</button></div><p class="pod-muted">Preview identity capacity and exact names before one atomic creation.</p><div class="pod-field-grid"><label>Count<input class="input-field" id="bulk-count" type="number" min="1" max="500" value="12"></label><label>Windows weight<input class="input-field" id="bulk-windows" type="number" min="0" value="3"></label><label>macOS weight<input class="input-field" id="bulk-macos" type="number" min="0" value="1"></label><label>Region<select class="input-field" id="bulk-region"><option value="">Inherit pod region</option>${options}</select></label><label class="pod-bulk-pattern">Name pattern<input class="input-field" id="bulk-pattern" value="{pod}-{index:02d}"><small>Tokens: {pod}, {region}, {index}</small></label></div><div class="pod-savebar"><span class="pod-save-note">Preview does not write profiles.</span><button class="btn btn-secondary" type="button" id="bulk-preview">Preview batch</button><button class="btn btn-primary" type="button" id="bulk-commit" disabled>Create profiles</button></div><div id="bulk-result" class="pod-effects" aria-live="polite"></div></form>`;
    dialog.showModal(); bulkPreview = null;
    dialog.querySelectorAll('input, select').forEach(input => input.addEventListener('input', () => { bulkPreview = null; $('bulk-commit').disabled = true; $('bulk-result').textContent = ''; }));
    $('bulk-preview').addEventListener('click', async () => {
      const feedback = $('bulk-result');
      try { const count = Number($('bulk-count').value); const mix = { windows: Number($('bulk-windows').value), macos: Number($('bulk-macos').value) }; const region = $('bulk-region').value; const pattern = $('bulk-pattern').value.trim(); const result = await api().create_profiles_bulk(selectedPodId, count, mix, region, pattern, true); if (!result?.success) throw new Error(errorText(result)); bulkPreview = { podId: selectedPodId, count, mix, region, pattern }; feedback.innerHTML = `<strong>${esc(result.count)} profiles ready to create</strong><p>${(result.classes || []).map(item => `${esc(item.device_type)}: ${esc(item.count)} requested, ${esc(item.identity_remaining)} identities remaining`).join(' · ')}</p><div class="pod-bulk-names">${(result.names || []).slice(0,20).map(name => `<span>${esc(name)}</span>`).join('')}${result.names?.length > 20 ? `<span>…and ${esc(result.names.length - 20)} more</span>` : ''}</div>`; $('bulk-commit').disabled = false; }
      catch (error) { bulkPreview = null; $('bulk-commit').disabled = true; feedback.textContent = error.message; }
    });
    $('bulk-commit').addEventListener('click', async () => {
      const feedback = $('bulk-result'); const button = $('bulk-commit'); if (!bulkPreview || bulkPreview.podId !== selectedPodId) return; button.disabled = true;
      try { const request = bulkPreview; const result = await api().create_profiles_bulk(request.podId, request.count, request.mix, request.region, request.pattern, false); if (!result?.success) throw new Error(errorText(result)); bulkPreview = null; dialog.close(); await loadPods(); const selected = podsById.get(request.podId); if (selected) await selectPod(selected.id, selected.name, selected.target_url); show('profiles', true); }
      catch (error) { feedback.textContent = error.message; button.disabled = false; }
    });
  }

  function renderActivity() {
    const panel = document.querySelector('[data-pod-panel="activity"]'); const current = pod(); if (!panel || !current) return;
    panel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">FOLLOW THIS POD</span><h4>Activity & evidence</h4><p>Move from a pod to the records of its profiles without remembering run identifiers.</p></div></div><div class="pod-link-list"><a href="#/monitor/fleet?pod=${encodeURIComponent(current.id)}">${icon('profiles')}<span>Fleet monitor<small>Live state and available watch views</small></span><b>↗</b></a><a href="#/monitor/reports">${icon('activity')}<span>Run reports<small>Filter and inspect evidence by profile</small></span><b>↗</b></a><a href="#/monitor/console?pod=${encodeURIComponent(current.id)}">${icon('activity')}<span>Console<small>Events for this pod</small></span><b>↗</b></a><a href="#/operate/schedules">${icon('rhythm')}<span>Task schedules<small>Persistent automation and outcomes</small></span><b>↗</b></a></div>`;
  }
  async function refresh(id, view) {
    if (!id || id !== selectedPodId) return;
    if (view === 'overview') renderOverview();
    if (view === 'targets') await renderTargets(id);
    if (view === 'mission') await renderMission(id);
    if (view === 'playbook') await renderPlaybook(id);
    if (view === 'behavior') await renderBehavior(id);
    if (view === 'usage') await renderUsage(id);
  }

  // The existing pod list and profile actions remain the execution owner.
  build();
  const originalSelectPod = selectPod;
  selectPod = async function(id, name, target) {
    capture(selectedPodId);
    await originalSelectPod(id, name, target);
    if (String(selectedPodId) !== String(id)) return;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    if (params.get('pod') === String(id) && params.has('view')) show(params.get('view'));
    else show(activeView);
    renderOverview();
  };
  const originalLoadPods = loadPods;
  loadPods = async function() { await originalLoadPods(); if (selectedPodId) renderOverview(); };
  window.addEventListener('hashchange', () => {
    const [path, query] = location.hash.replace(/^#\/?/, '').split('?'); if (path !== 'operate/pods') return;
    const params = new URLSearchParams(query || '');
    if (params.has('pod') && params.get('pod') !== selectedPodId && podsById?.has?.(params.get('pod'))) {
      const selected = podsById.get(params.get('pod')); selectPod(selected.id, selected.name, selected.target_url);
    } else if (params.has('view')) show(params.get('view'));
  });

  // A local preview gets representative values for the new bridge contracts.
  const originalMockSetup = setupMockBridge;
  setupMockBridge = function() {
    originalMockSetup();
    const bridge = api();
    bridge.__sandboxPreview = true;
    const baseListPods = bridge.list_pods;
    const baseListProfiles = bridge.list_profiles;
    const baseListPersonas = bridge.list_personas;
    const getSaved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
    const setSaved = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional local demo persistence. */ } };
    let bulkProfiles = getSaved('wc-sandbox-bulk-profiles', {});
    bridge.list_profiles = async id => [...(await baseListProfiles(id)), ...(bulkProfiles[id] || [])];
    bridge.list_pods = async () => {
      const pods = await baseListPods();
      const latest = await bridge.get_customization_inputs();
      return pods.map(item => ({ ...item, profile_count: item.profile_count + (bulkProfiles[item.id]?.length || 0), target_url: latest.inputs?.campaign?.find(row => row.pod_id === item.id)?.target_url ?? item.target_url }));
    };
    let authoredPersonas = getSaved('wc-sandbox-authored-personas', []);
    const demoQueries = Array.from({ length: 50 }, (_, index) => `Technology discovery topic ${String(index + 1).padStart(2, '0')}`);
    const sampleTechTemplates = [
      { slug: 'tech_review_marathon', name: 'Review Marathon', persona_key: 'tech_enthusiast', flow: [{ type: 'entry', source: 'youtube_search' }, { type: 'watch', duration_mode: 'medium' }, { type: 'recommendation_chain', depth: [3, 4] }, { type: 'engagement', actions: ['comment_scroll'] }, { type: 'cooldown' }], preferred_hours: null },
      { slug: 'tech_news_sweep', name: 'News Sweep', persona_key: 'tech_enthusiast', flow: [{ type: 'entry', source: 'youtube_home' }, { type: 'watch', duration_mode: 'short' }, { type: 'recommendation_chain', depth: [1, 2] }, { type: 'engagement', actions: ['not_interested'] }, { type: 'shorts', count: [3, 8] }, { type: 'cooldown' }], preferred_hours: null },
      { slug: 'tech_deep_dive', name: 'Deep Dive', persona_key: 'tech_enthusiast', flow: [{ type: 'entry', source: 'suggested_video' }, { type: 'watch', duration_mode: 'long' }, { type: 'recommendation_chain', depth: [2, 3] }, { type: 'cooldown' }], preferred_hours: null },
    ];
    bridge.list_personas = async () => [...(await baseListPersonas()).map(persona => ({ ...persona, search_queries: demoQueries, templates: persona.key === 'tech_enthusiast' ? sampleTechTemplates : playbookContract.starterTemplates(persona.key) })), ...authoredPersonas];
    let playbook = { ...playbookContract.empty(), pods: { 'mock-pod-1': { verticals: { tech_enthusiast: 70 }, Onboarding: { enabled: true, sessions_per_day: 2, session_minutes_min: 15, session_minutes_max: 35, min_gap_minutes: 90 } }, 'mock-pod-2': { mission: { ...missionDefaults(), mode: 'site_traffic', sites: [{ url: 'https://example.com/retail', weight: 1, sitemap: true, pages: [] }] } } } };
    let behavior = behaviorContract.defaults();
    let ramp = { enabled: false, profile_week_caps: [0,1,2], flat_weekly_cap: 3, weekly_growth_pct: 20, pods: {} };
    playbook = playbookContract.normalize(getSaved('wc-sandbox-playbook', playbook));
    behavior = behaviorContract.normalize(getSaved('wc-sandbox-behavior', behavior));
    ramp = getSaved('wc-sandbox-ramp', ramp);
    bridge.get_playbook = async () => {
      const people = await bridge.list_personas();
      return { success: true, config: structuredClone(playbook), revision: 'preview',
        query_stats: Object.fromEntries(people.map(persona => [persona.key, { name: persona.name, shipped: persona.search_queries.length, effective: playbookContract.effectiveQueries(persona.key, playbook, persona.search_queries).length }])),
        template_stats: Object.fromEntries(people.map(persona => [persona.key, { shipped: structuredClone(persona.templates), effective: playbookContract.effectiveTemplates(persona.key, playbook, persona.templates).length }])) };
    };
    bridge.update_playbook = async patch => {
      const mergeRows = (bucket, incoming) => Object.entries(incoming || {}).reduce((base, [id, row]) => { if (row === null || (typeof row === 'object' && !Object.keys(row).length)) { delete base[id]; return base; } base[id] = (base[id] && typeof row === 'object') ? { ...base[id], ...row } : row; return base; }, { ...(playbook[bucket] || {}) }); const next = playbookContract.normalize({ ...playbook, ...patch, pods: mergeRows('pods', patch.pods), profiles: mergeRows('profiles', patch.profiles) });
      for (const bucket of ['pods', 'profiles']) for (const [id, row] of Object.entries(next[bucket])) if (!row || !Object.keys(row).length) delete next[bucket][id];
      const errors = playbookContract.validate(next, await bridge.list_personas());
      const safeSite = raw => { try { const url = new URL(raw); const host = url.hostname.toLowerCase(); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password && (!url.port || ['80','443'].includes(url.port)) && host.includes('.') && !host.endsWith('.local') && !host.endsWith('.internal') && !host.includes('xn--') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host); } catch { return false; } };
      for (const [id, row] of Object.entries(patch.pods || {})) {
        const Onboarding = row?.Onboarding || {};
        if (Onboarding.sessions_per_day != null && (Onboarding.sessions_per_day < 1 || Onboarding.sessions_per_day > 12)) errors.push({ field: `pods.${id}.Onboarding.sessions_per_day`, reason: 'Use 1–12 sessions per day.' });
        if (Onboarding.session_minutes_min != null && Onboarding.session_minutes_max != null && Onboarding.session_minutes_min > Onboarding.session_minutes_max) errors.push({ field: `pods.${id}.Onboarding`, reason: 'Minimum minutes exceeds maximum.' });
        const mission = row?.mission; if (!mission) continue;
        if (!['media_onboarding','site_traffic','hybrid'].includes(mission.mode)) errors.push({ field: `pods.${id}.mission.mode`, reason: 'Choose a supported mission mode.' });
        if (mission.mode !== 'media_onboarding' && !mission.sites?.length) errors.push({ field: `pods.${id}.mission.sites`, reason: 'Site missions need a public site.' });
        for (const site of mission.sites || []) { if (!safeSite(site.url) || (site.pages || []).some(page => !safeSite(page))) errors.push({ field: `pods.${id}.mission.sites`, reason: 'Only safe public HTTP(S) destinations are allowed.' }); }
        if (mission.mode === 'media_onboarding' && mission.sites?.length) errors.push({ field: `pods.${id}.mission.sites`, reason: 'YouTube-only missions cannot include sites.' });
      }
      if (errors.length) return { success: false, errors };
      playbook = next;
      setSaved('wc-sandbox-playbook', playbook); return { success: true, config: structuredClone(playbook), revision: 'preview' };
    };
    bridge.get_behavior = async () => ({ success: true, config: structuredClone(behavior), revision: 'preview' });
    bridge.get_behavior_effective = async id => {
      const row = behavior.pods?.[id] || {};
      const resolved = behaviorContract.effective(behavior, row);
      return { success: true, config: structuredClone(behavior), pod_row: structuredClone(row),
        effective: { mix: resolved.mix, watch: resolved.watch, physics: resolved.physics }, revision: 'preview' };
    };
    bridge.update_behavior = async patch => {
      const next = behaviorContract.normalize({ ...behavior, ...patch,
        mix: { ...behavior.mix, ...(patch.mix || {}) },
        watch: { ...behavior.watch, ...(patch.watch || {}) },
        physics: { ...behavior.physics, ...(patch.physics || {}) },
      });
      const errors = behaviorContract.validate(next);
      if (patch.pods) for (const [id, row] of Object.entries(patch.pods)) {
        if (JSON.stringify(row) === JSON.stringify(behavior.pods?.[id])) continue;
        errors.push(...behaviorContract.validate(behaviorContract.effective(next, row)).map(error => ({ ...error, field: `pods.${id}.${error.field}` })));
      }
      if (errors.length) return { success: false, errors, config: structuredClone(behavior) };
      behavior = next;
      setSaved('wc-sandbox-behavior', behavior);
      return { success: true, config: structuredClone(behavior), revision: 'preview' };
    };
    bridge.get_ramp = async () => ({ success: true, config: structuredClone(ramp) });
    bridge.update_ramp = async value => { ramp = structuredClone(value); setSaved('wc-sandbox-ramp', ramp); return { success: true, config: structuredClone(ramp) }; };
    bridge.preview_behavior = async () => ({ success: true, sessions: 24, entry_mix: { SEARCH: 5, FEED_BROWSE: 12, SUGGESTED_VIDEO: 7 }, shorts_session_pct: 8.3, chain_session_pct: 62.5, avg_watch_seconds: 640 });
    bridge.preview_playbook = async (podId, patch = {}) => {
      const people = await bridge.list_personas();
      const next = playbookContract.normalize({ ...playbook, ...patch, pods: { ...playbook.pods, ...(patch.pods || {}) } });
      const errors = playbookContract.validate(next, people);
      if (errors.length) return { success: false, errors };
      const weights = playbookContract.effectiveVerticals(next, podId);
      const selected = Object.entries(weights).filter(([, weight]) => weight > 0);
      const drawWeights = selected.length ? selected : people.map(persona => [persona.key, 1]);
      const total = drawWeights.reduce((sum, [, weight]) => sum + Number(weight), 0);
      const draws = Object.fromEntries(drawWeights.map(([key, weight]) => [key, Math.round(24 * Number(weight) / total)]));
      const persona_samples = {}, templates_used = {};
      for (const [key, count] of Object.entries(draws)) {
        const persona = people.find(item => item.key === key);
        if (!persona) continue;
        persona_samples[key] = playbookContract.effectiveQueries(key, next, persona.search_queries, podId).slice(0, 3);
        const first = playbookContract.effectiveTemplates(key, next, persona.templates)[0];
        if (first) templates_used[first.slug] = count;
      }
      return { success: true, pod_id: podId, sessions: 24, persona_draws: draws, persona_samples, templates_used,
        entry_mix: { youtube_search: 12, youtube_home: 12 }, shorts_session_pct: 25, chain_session_pct: 50, avg_watch_seconds: 640,
        mission: next.pods[podId]?.mission || null, sample_only: true };
    };
    bridge.create_persona = async payload => {
      const people = await bridge.list_personas();
      const { key, errors } = playbookContract.validateNewVertical(payload, people);
      if (errors.length) return { success: false, errors };
      const persona = { key, name: String(payload.name).trim(), description: String(payload.description).trim(),
        categories: playbookContract.unique(payload.categories), preferred_websites: playbookContract.unique(payload.websites),
        search_queries: playbookContract.unique(payload.queries), templates: playbookContract.starterTemplates(key, payload.name) };
      authoredPersonas = [...authoredPersonas, persona];
      setSaved('wc-sandbox-authored-personas', authoredPersonas);
      return { success: true, key, persona: structuredClone(persona), templates: persona.templates.map(item => item.slug), sandbox_only: true };
    };
    let rhythm = getSaved('wc-sandbox-rhythm', { enabled: true, daily_minutes_cap: 360, daily_sessions_cap_enabled: true, active_hours_acceptance: true, rest_source: 'persona', rest_start_hour: 23, rest_end_hour: 7, correlation_enabled: true, same_target_cooldown_minutes: 60, exit_alternation_runs: 2, pods: {} });
    bridge.get_rhythm = async () => ({ success: true, config: structuredClone(rhythm) });
    bridge.update_rhythm = async value => {
      const errors = [];
      const inRange = (key, min, max) => { if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) errors.push({ field: key, reason: `Use a whole number from ${min} to ${max}.` }); };
      inRange('daily_minutes_cap', 0, 1440);
      inRange('rest_start_hour', 0, 23);
      inRange('rest_end_hour', 0, 23);
      inRange('same_target_cooldown_minutes', 0, 1440);
      inRange('exit_alternation_runs', 0, 10);
      if (!['persona', 'fixed', 'off'].includes(value.rest_source)) errors.push({ field: 'rest_source', reason: 'Choose a rest window source.' });
      if (errors.length) return { success: false, errors };
      rhythm = { ...rhythm, ...structuredClone(value), pods: structuredClone(value.pods ?? rhythm.pods ?? {}) };
      setSaved('wc-sandbox-rhythm', rhythm);
      return { success: true, config: structuredClone(rhythm) };
    };
    let targetGate = getSaved('wc-sandbox-target-gate', {
      min_onboarding_hours: 0.1,
      min_target_trust_score: 0.5,
      degraded_trust_floor: 0.2,
      challenge_cooldown_hours: 24,
      challenge_retire_count: 3,
      challenge_retire_window_days: 7,
    });
    bridge.get_target_gate = async () => ({ success: true, config: structuredClone(targetGate) });
    bridge.update_target_gate = async value => {
      const errors = [];
      const range = (field, min, max, integer = false) => {
        const current = value?.[field];
        if (!Number.isFinite(current) || (integer && !Number.isInteger(current)) || current < min || current > max) {
          errors.push({ field, reason: `Use ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.` });
        }
      };
      range('min_onboarding_hours', 0, 1000);
      range('min_target_trust_score', 0, 1);
      range('degraded_trust_floor', 0, 1);
      range('challenge_cooldown_hours', 0, 168, true);
      range('challenge_retire_count', 0, 10, true);
      range('challenge_retire_window_days', 1, 30, true);
      if (errors.length) return { success: false, errors };
      targetGate = structuredClone(value);
      setSaved('wc-sandbox-target-gate', targetGate);
      return { success: true, config: structuredClone(targetGate) };
    };
    let resources = getSaved('wc-sandbox-resources', {
      admission_stagger: { enabled: true, min_gap_seconds: 300, jitter_seconds: 120 },
      ram_gate: { warn_available_pct: 15, critical_available_pct: 8, safety_factor: 1.3 },
      cpu_advisory_pct: 90,
      quality_under_pressure: { enabled: true, preset: 'data_saver' },
    });
    bridge.get_resources = async () => ({ success: true, config: structuredClone(resources) });
    bridge.update_resources = async value => {
      const errors = [];
      const range = (field, number, min, max) => { if (!Number.isFinite(number) || number < min || number > max) errors.push({ field, reason: `Use a number from ${min} to ${max}.` }); };
      range('admission_stagger.min_gap_seconds', value.admission_stagger?.min_gap_seconds, 30, 3600);
      range('admission_stagger.jitter_seconds', value.admission_stagger?.jitter_seconds, 0, 300);
      range('cpu_advisory_pct', value.cpu_advisory_pct, 50, 100);
      range('ram_gate.warn_available_pct', value.ram_gate?.warn_available_pct, 1, 50);
      range('ram_gate.critical_available_pct', value.ram_gate?.critical_available_pct, 1, 30);
      range('ram_gate.safety_factor', value.ram_gate?.safety_factor, 1, 3);
      if (value.ram_gate?.critical_available_pct >= value.ram_gate?.warn_available_pct) errors.push({ field: 'ram_gate', reason: 'Critical floor must be below warn floor.' });
      if (errors.length) return { success: false, errors };
      resources = structuredClone(value);
      setSaved('wc-sandbox-resources', resources);
      return { success: true, config: structuredClone(resources) };
    };
    let spend = getSaved('wc-sandbox-spend', { fleet_daily_gb: null, fleet_daily_usd: null, profile_daily_gb: null, profile_daily_usd: null, pods: { 'mock-pod-2': { daily_gb: 2, daily_usd: 8 } }, run_ceiling_mb: null, warn_pct: 80, safety_margin_pct: 0, timezone: 'America/Toronto' });
    bridge.get_spend_guard = async () => ({ success: true, config: structuredClone(spend), timezone: spend.timezone, fleet: { bytes: 580000000, cost_usd: 1.34, effective_bytes: 580000000, effective_cost_usd: 1.34, holds_bytes: 0, unpriced_bytes: 0 }, tiers: [], profiles: [], limits_active: Object.values(spend.pods || {}).length > 0 });
    bridge.update_spend_guard = async value => { spend = structuredClone(value); setSaved('wc-sandbox-spend', spend); return { success: true, config: structuredClone(spend), errors: [] }; };
    bridge.get_pod_reporting = async () => {
      const pods = await bridge.list_pods(); const start = new Date(); start.setHours(0,0,0,0); const end = new Date(start.getTime() + 86400000);
      return { success: true, window: { start: start.toISOString(), end: end.toISOString(), timezone: spend.timezone || 'America/Toronto' }, box: { max_concurrency: 2, active_browsers: 1, ram_available_pct: 61 }, pods: pods.map((item, index) => ({ pod_id: item.id, pod_name: item.name, profiles: item.profile_count, runs_today: [4,6,3,2,1,5][index] || 0, site_runs_today: [0,4,1,2,0,3][index] || 0, site_pages_today: [0,11,3,5,0,8][index] || 0, watch_minutes_today: [83,0,34,0,18,0][index] || 0, bytes_today: ([0.28,0.72,0.36,0.19,0.08,0.42][index] || 0) * 1e9, gb_today: [0.28,0.72,0.36,0.19,0.08,0.42][index] || 0, cost_usd_today: [0.73,1.88,0.94,0.49,0.21,1.09][index] || 0, budget: spend.pods?.[item.id] || { daily_gb: null, daily_usd: null } })) };
    };
    bridge.create_profiles_bulk = async (podId, count, mix = {}, regionId = '', pattern = '{pod}-{index:02d}', dryRun = true) => {
      const pods = await bridge.list_pods(); const current = pods.find(item => item.id === podId); if (!current) return { success: false, error: 'Pod not found.' };
      if (!Number.isInteger(count) || count < 1 || count > 500) return { success: false, error: 'Count must be from 1 to 500.' };
      if (!pattern.includes('{index') || /\{(?!pod\}|region\}|index(?::0\d+d)?\})/.test(pattern)) return { success: false, error: 'Pattern needs {index}; only {pod}, {region}, and {index} are supported.' };
      if (pattern.includes('{region}') && !regionId) return { success: false, error: 'Select a region to use {region} in names.' };
      const windows = Number(mix.windows || 0), macos = Number(mix.macos || 0); if (windows < 0 || macos < 0 || windows + macos <= 0) return { success: false, error: 'Use at least one positive device weight.' };
      const macCount = Math.round(count * macos / (windows + macos)); const winCount = count - macCount;
      const remaining = { windows: 80 - (bulkProfiles[podId] || []).filter(item => item.device_type === 'windows').length, macos: 40 - (bulkProfiles[podId] || []).filter(item => item.device_type === 'macos').length };
      if (winCount > remaining.windows || macCount > remaining.macos) return { success: false, error: 'This batch exceeds the demo identity capacity. Shrink the count or adjust the mix.' };
      const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const names = Array.from({ length: count }, (_, index) => pattern.replaceAll('{pod}', slug(current.name)).replaceAll('{region}', slug(regionId)).replace(/\{index(?::0(\d+)d)?\}/g, (_, width) => String(index + 1).padStart(Number(width || 0), '0')));
      const existing = new Set((await bridge.list_profiles(podId)).map(item => item.name.toLowerCase())); if (names.some(name => existing.has(name.toLowerCase())) || new Set(names.map(x => x.toLowerCase())).size !== names.length) return { success: false, error: 'Names collide with existing profiles. Adjust the pattern.' };
      const classes = [{ device_type: 'windows', count: winCount, identity_capacity: 80, identity_live: 80 - remaining.windows, identity_remaining: remaining.windows },{ device_type: 'macos', count: macCount, identity_capacity: 40, identity_live: 40 - remaining.macos, identity_remaining: remaining.macos }];
      const response = { success: true, pod_id: podId, pod_name: current.name, count, dry_run: dryRun, classes, names, region_id: regionId || null };
      if (!dryRun) { const sequence = [...Array(winCount).fill('windows'), ...Array(macCount).fill('macos')]; bulkProfiles[podId] = [...(bulkProfiles[podId] || []), ...names.map((name, index) => ({ id: `bulk-${podId}-${Date.now()}-${index}`, name, device_type: sequence[index], region_id: regionId || null, trust_score: 0, onboarding_hours: 0, resolution: sequence[index] === 'macos' ? '2560x1600' : '1920x1080', gpu: sequence[index] === 'macos' ? 'Apple GPU' : 'ANGLE' }))]; setSaved('wc-sandbox-bulk-profiles', bulkProfiles); response.created = names.map((name, index) => ({ name, device_type: sequence[index] })); }
      return response;
    };
    bridge.apply_Onboarding_regimen = async (podId, proxyId = '', autoExits = false) => {
      const profiles = await bridge.list_profiles(podId); const regimen = playbook.pods?.[podId]?.Onboarding || {}; const intervalHours = Math.max(1, Math.floor(24 / (regimen.sessions_per_day || 2)));
      const current = await bridge.get_operations_overview(); const existing = (current.schedules || []).filter(job => job.task_type === 'onboarding_run'); const created = [], updated = [], skipped = [], autoAssigned = [];
      for (const profile of profiles) {
        const old = existing.find(job => job.payload?.profile_id === profile.id); const exitId = proxyId || old?.payload?.proxy_id || (profile.id === 'p-warm-1' ? 'preview-residential-exit' : autoExits ? 'preview-residential-exit' : '');
        if (!exitId) { skipped.push({ profile: profile.name, reason: 'No assigned exit. Enable region-matched exit claiming or choose one.' }); continue; }
        if (!old && !proxyId && profile.id !== 'p-warm-1' && autoExits) autoAssigned.push({ profile_id: profile.id, proxy_id: exitId });
        const job = { name: `Onboarding · ${profile.name}`, job_type: 'Onboarding', task_type: 'onboarding_run', enabled: true, trigger_type: 'interval', trigger: { every: intervalHours, unit: 'hours' }, timezone: 'America/Toronto', payload: { profile_id: profile.id, proxy_id: exitId, duration_minutes: regimen.session_minutes_min || 15, seasoning: true } };
        const result = await bridge.save_schedule(job, old?.id); if (!result.success) { skipped.push({ profile: profile.name, reason: result.error }); continue; } (old ? updated : created).push({ profile_id: profile.id, schedule_id: result.schedule.id });
      }
      return { success: true, pod_id: podId, interval_hours: intervalHours, created, updated, skipped, auto_assigned: autoAssigned, regimen };
    };
  };

  // Global controls remain in Configuration. Their forms stay mounted as the
  // operator moves between sections, so unsaved values are not thrown away.
  const globalBehavior = $('pod-global-behavior');
  const globalPlaybook = $('pod-global-playbook');
  let globalBehaviorDirty = false;
  let globalPlaybookDirty = false;
  const friendly = key => key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const errorText = result => (result?.errors || []).map(item => `${item.field}: ${item.reason}`).join(' · ') || result?.error || 'The change could not be saved.';
  const listLines = value => value.split('\n').map(item => item.trim()).filter(Boolean);
  const kvSummary = values => Object.entries(values || {}).map(([key, value]) => `${friendly(key)} ${value}`).join(' · ') || 'No sample values returned.';
  const playbookPreviewHtml = result => {
    const samples = Object.entries(result.persona_samples || {}).map(([key, values]) => `<li><strong>${esc(friendly(key))}</strong>: ${esc((values || []).join(' · ') || 'No sampled queries')}</li>`).join('');
    return `<strong>${esc(result.sessions)} sample sessions${result.sample_only ? ' · illustrative sandbox preview' : ''}</strong><p>Persona draws: ${esc(kvSummary(result.persona_draws))}</p><p>Flows used: ${esc(kvSummary(result.templates_used))}</p><p>Entries: ${esc(kvSummary(result.entry_mix))}</p><small>${esc(result.shorts_session_pct ?? '—')}% shorts · ${esc(result.chain_session_pct ?? '—')}% chains · ${esc(result.avg_watch_seconds ?? '—')}s average watch</small>${samples ? `<details><summary>Sampled queries</summary><ul>${samples}</ul></details>` : ''}`;
  };

  function behaviorDraft() {
    const sections = {};
    globalBehavior.querySelectorAll('[data-global-behavior]').forEach(input => {
      const [section, key] = input.dataset.globalBehavior.split(':');
      sections[section] ||= {};
      sections[section][key] = behaviorValue(input);
    });
    return sections;
  }
  async function renderGlobalBehavior(force = false) {
    if (!globalBehavior || (globalBehaviorDirty && !force)) return;
    const snapshot = await api()?.get_behavior?.();
    if (!snapshot?.success) { globalBehavior.textContent = 'Fleet behavior is unavailable from this bridge.'; return; }
    const config = behaviorContract.normalize(snapshot.config);
    const groups = Object.entries(behaviorLabels).map(([section, title]) => {
      const fields = behaviorContract.fields.filter(field => field.section === section);
      const rows = fields.map(field => behaviorField(field, config[section][field.key], null, 'global')).join('');
      return `<details class="pod-behavior-group" ${section === 'mix' ? 'open' : ''}><summary>${icon('behavior')}<span>${title}</span><small>${fields.length} controls</small></summary><div class="pod-field-grid">${rows}</div></details>`;
    }).join('');
    globalBehavior.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">FLEET DEFAULTS</span><h4>Session behavior</h4><p>Shape future sessions across the fleet. Pod and profile overrides still take precedence.</p></div><span class="pod-scope-label">Revision ${esc(snapshot.revision || '—')}</span></div>${groups}<div class="pod-savebar"><span class="pod-save-note">Preview samples plans without launching a browser or spending proxy traffic.</span><button type="button" class="btn btn-secondary" id="pod-global-behavior-preview">Preview plans</button><button type="button" class="btn btn-primary" id="pod-global-behavior-save">Save fleet behavior</button></div><div class="pod-effects" id="pod-global-behavior-feedback" aria-live="polite"></div>`;
    globalBehaviorDirty = false;
    globalBehavior.querySelectorAll('[data-global-behavior]').forEach(input => input.addEventListener('input', () => { globalBehaviorDirty = true; }));
    $('pod-global-behavior-preview').addEventListener('click', async () => {
      const feedback = $('pod-global-behavior-feedback');
      try { const proposal = behaviorDraft(); const errors = behaviorContract.validate(proposal); if (errors.length) throw new Error(behaviorErrors(errors)); const result = await api().preview_behavior(proposal); if (!result?.success) throw new Error(errorText(result)); feedback.innerHTML = `<strong>${esc(result.sessions)} sample sessions</strong><p>${esc(kvSummary(result.entry_mix))}</p><small>${esc(result.shorts_session_pct)}% shorts · ${esc(result.chain_session_pct)}% chains · ${esc(result.avg_watch_seconds)}s average watch</small>`; }
      catch (error) { feedback.textContent = error.message; }
    });
    $('pod-global-behavior-save').addEventListener('click', async () => {
      const feedback = $('pod-global-behavior-feedback');
      try { const proposal = behaviorDraft(); const errors = behaviorContract.validate(proposal); if (errors.length) throw new Error(behaviorErrors(errors)); const result = await api().update_behavior(proposal); if (!result?.success) throw new Error(errorText(result)); globalBehaviorDirty = false; await renderGlobalBehavior(true); $('pod-global-behavior-feedback').textContent = 'Fleet behavior saved for future sessions.'; }
      catch (error) { feedback.textContent = error.message; }
    });
  }

  function playbookDraft() {
    const verticals = {}; const queries = {};
    globalPlaybook.querySelectorAll('[data-global-vertical]').forEach(input => { if (input.value !== '') verticals[input.dataset.globalVertical] = Number(input.value); });
    globalPlaybook.querySelectorAll('[data-query-persona]').forEach(node => {
      const key = node.dataset.queryPersona;
      const add = listLines(node.querySelector('[data-query-field="add"]').value);
      const shippedInputs = [...node.querySelectorAll('[data-query-shipped]')];
      const shippedNames = new Set(shippedInputs.map(input => input.value));
      const unchecked = shippedInputs.filter(input => !input.checked).map(input => input.value);
      let prior = [];
      try { prior = JSON.parse(node.dataset.queryPriorRemove || '[]'); } catch (_error) { prior = []; }
      // Keep: unchecked shipped queries + prior removals that are not part
      // of the shipped list, so their exact strings stay removable.
      const remove = [...new Set([...unchecked, ...prior.filter(value => !shippedNames.has(value))])];
      if (add.length || remove.length) queries[key] = { add, remove };
    });
    return { verticals, queries, templates: globalFlowStudio?.draft() || {} };
  }
  let globalFlowStudio = null;
  async function renderGlobalPlaybook(force = false) {
    if (!globalPlaybook || (globalPlaybookDirty && !force)) return;
    const [snapshot, people, pods] = await Promise.all([api()?.get_playbook?.(), api()?.list_personas?.() || [], api()?.list_pods?.() || []]);
    if (!snapshot?.success) { globalPlaybook.textContent = 'Fleet Playbooks are unavailable from this bridge.'; return; }
    const config = snapshot.config || {}; const personas = [...new Map([...people.map(p => [p.key,p]), ...Object.keys(config.queries || {}).map(key => [key,people.find(p => p.key === key) || {key,name:friendly(key)}])]).values()];
    const weights = personas.map(persona => `<label class="pod-inline-field"><span>${esc(persona.name)}<small>${esc(persona.key)}</small></span><input class="input-field" type="number" min="0" max="100" step="0.5" placeholder="Uniform" data-global-vertical="${esc(persona.key)}" value="${esc(config.verticals?.[persona.key] ?? '')}"></label>`).join('');
    const queries = personas.map(persona => {
      const shipped = (snapshot.query_stats?.[persona.key]?.shipped_list) || persona.search_queries || [];
      const priorRemoves = config.queries?.[persona.key]?.remove || [];
      const removed = new Set(priorRemoves);
      const additions = config.queries?.[persona.key]?.add || [];
      const shippedRows = shipped.map(query => `<label class="pod-check-inline"><input type="checkbox" data-query-shipped="${esc(persona.key)}" value="${escapeAttribute(query)}" ${removed.has(query) ? '' : 'checked'}><span>${esc(query)}</span></label>`).join('')
        || '<p class="pod-muted">No shipped queries on record for this persona.</p>';
      return `<details class="pod-behavior-group" data-query-persona="${esc(persona.key)}" data-query-prior-remove="${escapeAttribute(JSON.stringify(priorRemoves))}"><summary>${icon('playbook')}<span>${esc(persona.name)}</span><small>${esc(snapshot.query_stats?.[persona.key]?.effective ?? '—')} effective queries</small></summary>
        <div class="pod-divider"><h5>Shipped pool — uncheck to exclude</h5><p>Every query this persona ships with. Unchecked queries are removed; re-checking restores them.</p><div class="pod-check-list">${shippedRows}</div></div>
        <div class="pod-divider"><h5>Your added queries</h5><label>One per line<textarea class="input-field" data-query-field="add" rows="4" placeholder="No additions">${esc(additions.join('\n'))}</textarea></label></div>
      </details>`;
    }).join('');
    globalPlaybook.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">SHARED PLAYBOOK</span><h4>Fleet Playbooks</h4><p>Manage shared session flows, persona direction and query pools. Open only the section you need; pod-specific controls stay with each pod.</p></div><span class="pod-scope-label">Revision ${esc(snapshot.revision || '—')}</span></div>
      <details class="playbook-section" open><summary><span class="playbook-section-copy"><strong>Session flows</strong><small>Choose a persona, then edit a flow’s steps when needed.</small></span><span class="playbook-section-meta">Shared templates</span></summary><div class="playbook-section-body"><p class="playbook-section-note">Keep at least one flow enabled per persona. Changes affect future generated sessions.</p><div id="pod-shared-flow-studio"></div></div></details>
      <details class="playbook-section"><summary><span class="playbook-section-copy"><strong>Default persona direction</strong><small>Set the fleet-wide mix of personas.</small></span><span class="playbook-section-meta">${personas.length} ${personas.length === 1 ? 'persona' : 'personas'}</span></summary><div class="playbook-section-body"><p class="playbook-section-note">Empty weights use the shipped uniform draw. A custom mix needs at least one positive weight.</p><div class="pod-field-grid">${weights}</div></div></details>
      <details class="playbook-section"><summary><span class="playbook-section-copy"><strong>Query pool overlays</strong><small>Add or remove search queries for each persona.</small></span><span class="playbook-section-meta">${personas.length} ${personas.length === 1 ? 'pool' : 'pools'}</span></summary><div class="playbook-section-body"><p class="playbook-section-note">Everything is visible here: the shipped pool with per-query checkboxes, plus your additions. Only differences are stored. At least 50 unique effective queries must remain.</p>${queries}</div></details>
      <details class="playbook-section"><summary><span class="playbook-section-copy"><strong>New vertical</strong><small>Author a persona with its categories, sites and queries.</small></span><span class="playbook-section-meta">Create persona</span></summary><div class="playbook-section-body"><p class="playbook-section-note">Creates a validated persona and three starter session flows. At least 50 unique search queries are required.</p><div class="playbook-author-grid"><label class="playbook-author-field"><span class="playbook-field-copy"><strong>Name</strong><small>Shown in persona lists</small></span><input class="input-field" id="playbook-new-name" placeholder="Shopper Deals"></label><label class="playbook-author-field"><span class="playbook-field-copy"><strong>Description</strong><small>Interests and viewing style</small></span><input class="input-field" id="playbook-new-description" placeholder="Short description"></label><label class="playbook-author-field"><span class="playbook-field-copy"><strong>YouTube categories</strong><small>Comma-separated</small></span><input class="input-field" id="playbook-new-categories" placeholder="Shopping, Howto & Style"></label><label class="playbook-author-field"><span class="playbook-field-copy"><strong>Preferred websites</strong><small>Comma-separated public sites</small></span><input class="input-field" id="playbook-new-websites" placeholder="example.com"></label><label class="playbook-author-field playbook-author-queries"><span class="playbook-field-copy"><strong>Search queries</strong><small>One per line; at least 50 unique</small></span><textarea class="input-field" id="playbook-new-queries" rows="6" placeholder="One query per line"></textarea></label></div><div class="playbook-author-actions"><button class="btn btn-secondary" type="button" id="playbook-create-vertical">Create vertical</button><span class="pod-hint" id="playbook-create-feedback" aria-live="polite"></span></div></div></details>
      <details class="playbook-section"><summary><span class="playbook-section-copy"><strong>Per-pod settings</strong><small>Open Onboarding, mission, behavior or targets for a pod.</small></span><span class="playbook-section-meta">${pods.length} ${pods.length === 1 ? 'pod' : 'pods'}</span></summary><div class="playbook-section-body"><div class="playbook-pod-links">${pods.map(p => `<div class="playbook-pod-row"><strong>${esc(p.name)}</strong>${[['playbook','Onboarding & direction'],['mission','Mission'],['behavior','Behavior'],['targets','Production target']].map(([view,label]) => `<a href="#/operate/pods?pod=${encodeURIComponent(p.id)}&view=${view}">${label} ↗</a>`).join('')}</div>`).join('') || '<span class="pod-muted">No pods available.</span>'}</div></div></details>
      <div class="pod-savebar"><span class="pod-save-note">Preview samples plans without launching a browser.</span><select class="input-field pod-preview-select" id="pod-global-playbook-pod" aria-label="Pod for preview">${pods.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button type="button" class="btn btn-secondary" id="pod-global-playbook-preview" ${pods.length ? '' : 'disabled'}>Preview this pod</button><button type="button" class="btn btn-primary" id="pod-global-playbook-save">Save shared playbook</button></div><div class="pod-effects" id="pod-global-playbook-feedback" aria-live="polite"></div>`;
    globalFlowStudio = window.PlaybookStudio.mount($('pod-shared-flow-studio'), personas, config, snapshot.template_stats, () => { globalPlaybookDirty = true; });
    globalPlaybookDirty = false;
    globalPlaybook.querySelectorAll('[data-global-vertical], [data-query-field]').forEach(input => input.addEventListener('input', () => { globalPlaybookDirty = true; }));
    $('pod-global-playbook-preview').addEventListener('click', async () => {
      const feedback = $('pod-global-playbook-feedback');
      try { const result = await api().preview_playbook($('pod-global-playbook-pod').value, playbookDraft()); if (!result?.success) throw new Error(errorText(result)); feedback.innerHTML = playbookPreviewHtml(result); }
      catch (error) { feedback.textContent = error.message; }
    });
    $('pod-global-playbook-save').addEventListener('click', async () => {
      const feedback = $('pod-global-playbook-feedback');
      try { const result = await api().update_playbook(playbookDraft()); if (!result?.success) throw new Error(errorText(result)); globalPlaybookDirty = false; await renderGlobalPlaybook(true); $('pod-global-playbook-feedback').textContent = 'Fleet playbook saved for future plans.'; }
      catch (error) { feedback.textContent = error.message; }
    });
    $('playbook-create-vertical').addEventListener('click', async () => {
      const feedback = $('playbook-create-feedback');
      try {
        if (globalPlaybookDirty) throw new Error('Save the shared playbook before creating a vertical, so those edits are retained.');
        const value = id => $(id).value.trim();
        const payload = { name: value('playbook-new-name'), description: value('playbook-new-description'), categories: value('playbook-new-categories').split(',').map(x => x.trim()).filter(Boolean), websites: value('playbook-new-websites').split(',').map(x => x.trim()).filter(Boolean), queries: listLines(value('playbook-new-queries')) };
        const check = playbookContract.validateNewVertical(payload, personas);
        if (check.errors.length) throw new Error(errorText({ errors: check.errors }));
        const result = await api().create_persona(payload);
        if (!result?.success) throw new Error(errorText(result));
        await renderGlobalPlaybook(true);
        $('pod-global-playbook-feedback').textContent = `${payload.name} created with starter flows${api().__sandboxPreview ? ' in this browser preview' : ''}.`;
      } catch (error) { feedback.textContent = error.message; }
    });
  }

  // The current sandbox has its own focused Configuration rail. Give every
  // destination an icon and make pod targets a link into the pod workspace.
  document.querySelectorAll('#customize-tab .workspace-tabs a').forEach(link => {
    const key = link.hash.split('/').pop(); const label = link.textContent.trim();
    link.innerHTML = `${icon(key)}<span>${esc(key === 'campaigns' ? 'Campaign policy' : label)}</span>`;
    link.title = key === 'campaigns' ? 'Campaign policy' : label;
  });
  // The old campaign rows remain hidden for compatibility, but a save of any
  // other Configuration section must not re-submit their stale target values.
  const originalCollectCustomizationPayload = collectCustomizationPayload;
  collectCustomizationPayload = function() {
    const payload = originalCollectCustomizationPayload();
    payload.campaign = structuredClone(customizationState?.inputs?.campaign || []);
    return payload;
  };
  const campaignList = $('customize-campaign-list');
  if (campaignList) {
    campaignList.hidden = true;
    const card = campaignList.closest('.customize-card');
    card.querySelector('.card-heading h3').textContent = 'Campaign policy';
    card.querySelector('.card-description').textContent = 'Pod targets now live with each pod. This page holds fleet-wide target growth and links to the affected pod workspaces.';
    const link = document.createElement('div'); link.className = 'pod-campaign-routing';
    link.innerHTML = `<span>${icon('targets')} Configure target, placement, allowlists and playbook from Pods & Profiles.</span><a class="btn btn-secondary" href="#/operate/pods?view=targets">Open pod workspace</a>`;
    card.append(link);
    const rampPanel = document.createElement('section'); rampPanel.className = 'pod-global-ramp';
    rampPanel.innerHTML = `<div class="pod-panel-heading"><div><span class="pod-eyebrow">GLOBAL CAMPAIGN POLICY</span><h4>Gradual ramp</h4><p>Target-contact growth after a profile becomes ready. Per-pod exceptions stay here so the fleet rule remains visible in one place.</p></div></div><div class="pod-field-grid"><label>Ramp<select class="input-field" id="pod-ramp-enabled"><option value="false">Off · use flat weekly cap</option><option value="true">On · use age curve</option></select></label><label>Flat weekly cap<input class="input-field" id="pod-ramp-flat" type="number" min="1" max="7"></label><label>Growth ceiling (%)<input class="input-field" id="pod-ramp-growth" type="number" min="0" max="100"></label><label>Weekly age curve<input class="input-field" id="pod-ramp-curve" placeholder="0, 1, 2"></label></div><div class="pod-divider"><h5>Pod exceptions</h5><p>Leave fields on Inherit to use the global campaign rule. These are growth exceptions, not pod target settings.</p><div id="pod-ramp-overrides"></div></div><div class="pod-savebar"><span class="pod-save-note">All pod exceptions are reviewed with this policy.</span><button class="btn btn-primary" id="pod-ramp-save" type="button">Save ramp policy</button></div><div id="pod-ramp-feedback" class="pod-effects" aria-live="polite"></div>`;
    card.after(rampPanel);
    async function loadRamp() {
      const result = await api()?.get_ramp?.(); if (!result?.success) return;
      const config = result.config || {};
      $('pod-ramp-enabled').value = String(config.enabled === true);
      $('pod-ramp-flat').value = config.flat_weekly_cap ?? '';
      $('pod-ramp-growth').value = config.weekly_growth_pct ?? '';
      $('pod-ramp-curve').value = (config.profile_week_caps || []).join(', ');
      const pods = await api()?.list_pods?.() || [];
      $('pod-ramp-overrides').innerHTML = pods.map(item => {
        const row = config.pods?.[item.id] || {};
        return `<div class="pod-ramp-row" data-ramp-pod="${esc(item.id)}"><strong>${esc(item.name)}</strong><label>Mode<select class="input-field" data-ramp-field="enabled"><option value="">Inherit</option><option value="true" ${row.enabled === true ? 'selected' : ''}>On</option><option value="false" ${row.enabled === false ? 'selected' : ''}>Off</option></select></label><label>Growth ceiling %<input class="input-field" data-ramp-field="weekly_growth_pct" type="number" min="0" max="100" step="any" placeholder="Inherit" value="${esc(row.weekly_growth_pct ?? '')}"></label><label>Weekly age curve<input class="input-field" data-ramp-field="profile_week_caps" placeholder="Inherit" value="${esc((row.profile_week_caps || []).join(', '))}"></label></div>`;
      }).join('') || '<p class="pod-muted">No pods yet.</p>';
    }
    $('pod-ramp-save').addEventListener('click', async () => {
      const feedback = $('pod-ramp-feedback');
      try {
        const latest = await api().get_ramp(); if (!latest?.success) throw new Error('Could not refresh ramp policy.');
        const parseCurve = (raw, label) => {
          const values = raw.split(',').map(x => x.trim()).filter(Boolean).map(Number);
          if (!values.length || values.length > 12 || values.some(x => !Number.isInteger(x) || x < 0 || x > 7)) throw new Error(`${label} needs 1–12 whole-number caps from 0 to 7.`);
          return values;
        };
        const pods = { ...(latest.config?.pods || {}) };
        $('pod-ramp-overrides').querySelectorAll('[data-ramp-pod]').forEach(node => {
          const id = node.dataset.rampPod;
          const mode = node.querySelector('[data-ramp-field="enabled"]').value;
          const growth = node.querySelector('[data-ramp-field="weekly_growth_pct"]').value;
          const curve = node.querySelector('[data-ramp-field="profile_week_caps"]').value;
          const row = {};
          if (mode) row.enabled = mode === 'true';
          if (growth !== '') row.weekly_growth_pct = Number(growth);
          if (curve.trim()) row.profile_week_caps = parseCurve(curve, `${id} curve`);
          if (Object.keys(row).length) pods[id] = row; else delete pods[id];
        });
        const value = { ...latest.config, enabled: $('pod-ramp-enabled').value === 'true', flat_weekly_cap: Number($('pod-ramp-flat').value), weekly_growth_pct: Number($('pod-ramp-growth').value), profile_week_caps: parseCurve($('pod-ramp-curve').value, 'Global curve'), pods };
        const result = await api().update_ramp(value);
        if (!result?.success) throw new Error((result?.errors || []).map(x => `${x.field}: ${x.reason}`).join(' · ') || 'Save failed.');
        feedback.textContent = 'Ramp policy and pod exceptions saved.';
      } catch (error) { feedback.textContent = error.message; }
    });
    const configLink = document.querySelector('#customize-tab .workspace-tabs a[href$="/campaigns"]');
    configLink?.addEventListener('click', () => setTimeout(loadRamp, 0));
    const originalLoadCustomizationInputs = loadCustomizationInputs;
    loadCustomizationInputs = async function(...args) {
      const view = args[0] || null;
      const result = await originalLoadCustomizationInputs(...args);
      if ((!view || view === 'campaigns') && api()?.get_ramp) await loadRamp();
      if (view === 'behavior' || (!view && location.hash.includes('/configure/customization/behavior'))) await renderGlobalBehavior(Boolean(view));
      if (view === 'playbooks' || (!view && location.hash.includes('/configure/customization/playbooks'))) await renderGlobalPlaybook();
      return result;
    };
    window.addEventListener('hashchange', () => {
      if (location.hash.includes('/configure/customization/campaigns')) loadRamp();
      if (location.hash.includes('/configure/customization/behavior')) renderGlobalBehavior();
      if (location.hash.includes('/configure/customization/playbooks')) renderGlobalPlaybook();
    });
  }
})();
