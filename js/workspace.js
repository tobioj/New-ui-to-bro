/* Presentation layer. No bridge implementation, execution rules or write
   payloads live here. Keep app.js as the owner of all existing commands. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => escapeHtml(String(value ?? '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const localDate = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
  const state = value => `<span class="workspace-status" data-state="${esc(String(value || 'unknown').toLowerCase())}">${esc(String(value || 'Unknown').toLowerCase().replaceAll('_', ' '))}</span>`;
  const field = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value == null || value === '' ? 'Not recorded' : value)}</dd></div>`;
  const related = links => `<nav class="workspace-related" aria-label="Related views">${links.map(([label, href]) => `<a href="${esc(href)}">${esc(label)} ↗</a>`).join('')}</nav>`;
  const action = (name, text, data = '') => `<button type="button" class="btn btn-secondary btn-sm" data-action="${name}" ${data}>${text}</button>`;
  const profileName = id => fleetState?.profiles?.find(profile => profile.profile_id === id)?.name || id || 'System';
  const queryHref = (path, key, value) => `#/${path}?${new URLSearchParams({ [key]: value })}`;
  const watchAction = profile => window.WorkspaceFormRules?.canWatch(profile) ? `<button type="button" class="btn btn-secondary btn-sm" data-watch-profile="${esc(profile.profile_id)}" aria-label="Watch live: ${esc(profile.name)}">Watch live</button>` : '<span class="workspace-secondary">No live session</span>';
  const fleetTrustOnboarding = profile => {
    const trust = `${Math.round(Number(profile.trust_score || 0) * 100)}%`;
    const Onboarding = window.FleetPresentation.OnboardingHours(profile.onboarding_hours);
    return `<span class="workspace-fleet-trust" aria-label="Trust ${esc(trust)}, Onboarding ${esc(Onboarding)}">${esc(trust)} <span aria-hidden="true">·</span> ${esc(Onboarding)}</span>`;
  };
  const fleetActivityCell = profile => {
    const activity = window.FleetPresentation.activityContext(profile);
    const isError = ['error', 'critical'].includes(activity.severity);
    const placement = profile.placement ? [profile.placement.name, profile.placement.city].filter(Boolean).join(' · ') : 'No region bound';
    return `<div class="workspace-fleet-activity" data-severity="${esc(activity.severity)}">${isError ? '<span class="workspace-fleet-activity-type">Latest error</span>' : ''}<span class="workspace-fleet-activity-message">${esc(activity.message)}</span></div>${isError ? `<button type="button" class="workspace-fleet-error-link" data-inspect-profile="${esc(profile.profile_id)}">Read error details</button>` : ''}<small>${esc(placement)}</small>`;
  };
  const fleetErrorDetail = profile => {
    const context = window.FleetPresentation.errorContext(profile);
    if (!context.error) return '';
    const past = context.kind === 'past';
    return `<section class="workspace-fleet-error-detail" data-history="${past ? 'past' : 'recorded'}"><h3>${past ? 'Past error' : 'Last recorded error'}</h3><p>${past ? 'A later run completed. This failure is retained for history, not shown as a current issue.' : 'No later completed run is recorded for this failure.'}</p>${context.error.timestamp ? `<time datetime="${esc(context.error.timestamp)}">${esc(localDate(context.error.timestamp))}</time>` : ''}<pre>${esc(context.error.message)}</pre>${context.error.message.length >= 512 ? '<p class="workspace-fleet-error-limit">The recorded event reached the backend message limit. Check the profile run report for additional context.</p>' : ''}</section>`;
  };
  const views = new Map();
  const viewMemory = new Map();
  const loadedForms = new Set();
  const scrollPositions = new Map();
  let activeRoute = '';
  let routeSerial = 0;

  // Non-destructive section switches keep the actual form controls mounted.
  function sectionViews(root, prefix, specs, insertAfter) {
    const nav = document.createElement('nav');
    nav.className = 'workspace-tabs';
    nav.setAttribute('aria-label', `${root.getAttribute('aria-label') || root.id.replace('-tab', '')} views`);
    specs.forEach(([key, name, nodes]) => {
      const panel = document.createElement('section');
      panel.dataset.workspacePanel = `${prefix}/${key}`;
      panel.setAttribute('aria-label', name);
      panel.id = `view-${prefix.replaceAll('/', '-')}-${key}`;
      (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean).forEach(node => panel.appendChild(node));
      root.appendChild(panel);
      const link = document.createElement('a');
      link.href = `#/${prefix}/${key}`;
      link.textContent = name;
      link.setAttribute('aria-controls', panel.id);
      nav.appendChild(link);
    });
    if (insertAfter) insertAfter.after(nav); else root.prepend(nav);
    views.set(prefix, { nav, root, specs });
    selectView(prefix, specs[0][0]);
  }
  function selectView(prefix, key) {
    const view = views.get(prefix);
    if (!view) return;
    const selected = view.specs.some(spec => spec[0] === key) ? key : viewMemory.get(prefix) || view.specs[0][0];
    viewMemory.set(prefix, selected);
    if (prefix === 'configure/customization') {
      $('customize-tab').classList.toggle('workspace-guard-active', selected === 'safeguards');
      $('customize-tab').dataset.customizeView = selected;
      const descriptions = {
        campaigns: 'Fleet-wide target growth. Target, placement and allowlists are edited in the pod workspace.',
        sessions: 'Set the shared session mix, then preview and apply this input document.',
        rhythm: 'Set operating windows and scheduled-fire rhythm. Window changes use Preview and Apply; rhythm has its own save.',
        visibility: 'Manage profile windows, rotation cadence and reusable desktop slots.',
        safety: 'Profile target readiness and fleet-wide contact safety, each with its own save.',
        admission: 'Automated admission pacing and resource thresholds. Concurrency is set in Operations.',
        personas: 'Set persona assignment rules, then preview and apply this input document.',
        naming: 'Set naming rules, then preview and apply this input document.',
        behavior: 'Shared session behavior defaults. Save here; pod exceptions live with each pod.',
        playbooks: 'Shared persona direction and query pools. Pod exceptions live with each pod.',
        safeguards: 'Spend limits and safety gates are saved in their own sections.'
      };
      $('customize-tab').querySelector('.action-bar-copy p').textContent = descriptions[selected];
      if (selected === 'visibility') window.WindowVisibility?.reload();
    }
    view.nav.querySelectorAll('a').forEach(link => link.setAttribute('aria-current', link.hash === `#/${prefix}/${selected}` ? 'page' : 'false'));
    view.specs.forEach(([name]) => {
      const panel = view.root.querySelector(`[data-workspace-panel="${prefix}/${name}"]`);
      panel.hidden = name !== selected;
    });
  }
  function toolbar(container, id, placeholder, onInput, options = '') {
    const bar = document.createElement('div');
    bar.className = 'workspace-toolbar';
    bar.innerHTML = `<label class="workspace-search">Search<input id="${id}" class="input-field" type="search" placeholder="${esc(placeholder)}"></label>${options}<span class="workspace-count" id="${id}-count" aria-live="polite"></span>`;
    container.before(bar);
    $(id).addEventListener('input', onInput);
    return bar;
  }
  function table(headers, rows, emptyMessage) {
    return `<div class="workspace-table-wrap"><table class="workspace-table"><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}"><div class="workspace-empty">${esc(emptyMessage)}</div></td></tr>`}</tbody></table></div>`;
  }
  // Pagination is explicitly scoped to the records already returned by the
  // existing endpoint. Reports retain their existing server pagination.
  const pages = new Map();
  function pageRows(key, items, container, render) {
    const size = 12;
    const page = Math.min(pages.get(key) || 1, Math.max(1, Math.ceil(items.length / size)));
    pages.set(key, page);
    const slice = items.slice((page - 1) * size, page * size);
    container.innerHTML = render(slice);
    const footer = document.createElement('div');
    footer.className = 'workspace-page-footer';
    footer.innerHTML = `<span>${items.length ? `${(page - 1) * size + 1}–${Math.min(page * size, items.length)} of ${items.length}` : '0'} loaded records</span><div class="workspace-inline-actions"><button class="btn btn-secondary btn-sm" type="button" data-page="previous" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>${page} / ${Math.max(1, Math.ceil(items.length / size))}</span><button class="btn btn-secondary btn-sm" type="button" data-page="next" ${page * size >= items.length ? 'disabled' : ''}>Next</button></div>`;
    footer.addEventListener('click', event => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      pages.set(key, page + (button.dataset.page === 'next' ? 1 : -1));
      pageRows(key, items, container, render);
    });
    container.appendChild(footer);
  }

  // Shared, keyboard-accessible inspector. Reading a record never executes it.
  const scrim = document.createElement('div');
  scrim.className = 'workspace-scrim'; scrim.hidden = true;
  const drawer = document.createElement('aside');
  drawer.className = 'workspace-drawer'; drawer.hidden = true;
  drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-labelledby', 'workspace-inspector-title');
  document.body.append(scrim, drawer);
  let returnFocus = null;
  function closeInspector() {
    if (drawer.hidden) return;
    drawer.hidden = scrim.hidden = true;
    document.querySelector('.app-container').inert = false;
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  function inspect(title, kind, html) {
    if (drawer.hidden) returnFocus = document.activeElement;
    window.MissionControl?.closeInfo();
    drawer.innerHTML = `<header><div><span class="section-kicker">${esc(kind)}</span><h2 id="workspace-inspector-title">${esc(title)}</h2></div><button type="button" class="workspace-close" aria-label="Close details">×</button></header><div class="workspace-drawer-body">${html}</div>`;
    drawer.hidden = scrim.hidden = false;
    document.querySelector('.app-container').inert = true;
    drawer.querySelector('.workspace-close').addEventListener('click', closeInspector);
    drawer.querySelector('.workspace-close').focus();
  }
  scrim.addEventListener('click', closeInspector);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-watch-profile]');
    if (!button) return;
    const profile = fleetState?.profiles?.find(item => item.profile_id === button.dataset.watchProfile);
    if (!profile) return;
    closeInspector(); window.openFleetWatch(profile);
  });
  drawer.addEventListener('click', event => { if (event.target.closest('a')) closeInspector(); });
  drawer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeInspector(); }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('a, button, input, select, textarea')].filter(el => !el.disabled && el.getClientRects().length);
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  });

  sectionViews($('workflows-tab'), 'operate/workflows', [
    ['library', 'Workflow library', $('workflow-list-container')],
    ['runs', 'Recent runs & checkpoints', $('workflow-runs-section')],
  ], $('workflows-tab').querySelector('.action-bar'));
  const customizationPanels = [...document.querySelectorAll('#customize-tab .customize-grid > .customize-card')];
  const globalBehaviorPanel = document.createElement('div'); globalBehaviorPanel.id = 'pod-global-behavior';
  const globalPlaybookPanel = document.createElement('div'); globalPlaybookPanel.id = 'pod-global-playbook';
  sectionViews($('customize-tab'), 'configure/customization', [
    ['campaigns', 'Campaign setup', customizationPanels[0]],
    ['sessions', 'Session mix', customizationPanels[1]],
    ['rhythm', 'Timing & rhythm', [$('customize-window-card'), $('global-rhythm-card')]],
    ['visibility', 'Windows & Visibility', $('customize-visibility-card')],
    ['safety', 'Fleet Safety', [$('target-gate-card'), $('global-safety-card')]],
    ['admission', 'Admission & Resources', $('global-resources-card')],
    ['personas', 'Personas', $('customize-personas-card')],
    ['naming', 'Naming', $('customize-naming-card')],
    ['behavior', 'Behavior', globalBehaviorPanel],
    ['playbooks', 'Fleet Playbooks', globalPlaybookPanel],
    ['safeguards', 'Safeguards', $('spend-guard-card')],
  ], $('customize-tab').querySelector('.action-bar'));
  const configShell = document.createElement('div');
  configShell.className = 'config-workspace-shell';
  const configView = views.get('configure/customization');
  configView.nav.after(configShell);
  const configRail = document.createElement('div');
  configRail.className = 'config-subnav-shell';
  const configToggle = document.createElement('button');
  configToggle.type = 'button';
  configToggle.className = 'config-subnav-toggle shell-rail-toggle';
  configToggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  configView.nav.prepend(configToggle);
  const configOutline = document.createElement('span');
  configOutline.className = 'config-subnav-outline';
  configOutline.setAttribute('aria-hidden', 'true');
  configRail.append(configView.nav, configOutline);
  configShell.append(configRail, ...[...$('customize-tab').querySelectorAll(':scope > [data-workspace-panel^="configure/customization/"]')]);
  function setConfigRailCollapsed(collapsed) {
    document.body.classList.toggle('config-subnav-collapsed', collapsed);
    const label = collapsed ? 'Expand Customization navigation' : 'Collapse Customization navigation';
    configToggle.setAttribute('aria-label', label);
    configToggle.setAttribute('aria-expanded', String(!collapsed));
    configToggle.title = label;
    try { localStorage.setItem('Workspace Controller-config-nav-collapsed', String(collapsed)); } catch (_) { /* Storage may be unavailable. */ }
  }
  let configWasCollapsed = false;
  try { configWasCollapsed = localStorage.getItem('Workspace Controller-config-nav-collapsed') === 'true'; } catch (_) { /* Use expanded navigation. */ }
  setConfigRailCollapsed(configWasCollapsed);
  configToggle.addEventListener('click', () => setConfigRailCollapsed(!document.body.classList.contains('config-subnav-collapsed')));
  // Keep preview and feedback below every focused customization section.
  ['customize-preview-card', 'customize-errors', 'customize-feedback'].forEach(id => $('customize-tab').appendChild($(id)));
  document.querySelector('#customize-tab .customize-grid').remove();

  const deployPanels = [...document.querySelectorAll('#deploy-tab > .card')];
  const dispatchButtons = document.createElement('div'); dispatchButtons.className = 'workspace-inline-actions';
  dispatchButtons.append($('btn-dispatch-preview'), $('btn-dispatch-confirm'));
  deployPanels[0].appendChild(dispatchButtons);
  sectionViews($('deploy-tab'), 'operate/deployments', [
    ['history', 'Deployments', deployPanels.at(-1)],
    ['compose', 'New dispatch', [deployPanels[0], $('dispatch-preview-card'), $('dispatch-errors')]],
  ], $('deploy-tab').querySelector('.action-bar'));
  $('deploy-tab').appendChild($('deploy-feedback'));
  const manualPanels = [...document.querySelectorAll('#manual-tab > .card')];
  sectionViews($('manual-tab'), 'operate/manual', [
    ['browser', 'Browser sessions', manualPanels[0]],
    ['tasks', 'Local tasks', manualPanels[1]],
    ['history', 'Run history', manualPanels[2]],
  ], $('manual-tab').querySelector('.action-bar'));

  // Place storage transfers beside backups, without changing their handlers.
  const backupPanel = document.querySelector('[data-operations-panel="backups"]');
  const backupCards = [...backupPanel.querySelectorAll('.operations-grid > .card')];
  const profileBackup = document.querySelector('#system-tab .backup-card');
  const workspaceBackup = $('ws-export-passphrase')?.closest('.card');
  sectionViews(backupPanel, 'system/operations/backups', [
    ['snapshots', 'Database snapshots', backupCards[0]],
    ['profiles', 'Profile archives', profileBackup],
    ['workspace', 'Workspace transfer', workspaceBackup],
  ]);
  backupPanel.querySelector('.operations-grid')?.remove();
  $('system-tab').insertAdjacentHTML('beforeend', related([['Backups & workspace transfer', '#/system/operations/backups'], ['Maintenance schedules', '#/system/operations/schedules'], ['Task schedules', '#/operate/schedules']]));
  $('workflows-tab').querySelector('.action-bar-copy p').textContent = 'Build reusable workflows, inspect their steps, and follow each execution into its reports. These are deterministic QA checks, scripted step by step — not the guided Onboarding behavior.';
  $('console-tab').querySelector('.action-bar-copy p').textContent = 'Follow live activity or investigate an event. Select a row for its complete context and payload.';
  $('alerts-tab').querySelector('.action-bar-copy p').textContent = 'Review what needs attention, inspect the reason, and open the affected workspace. Acknowledging a warning does not resolve it.';
  $('customize-tab').querySelector('.action-bar-copy p').textContent = 'Configure one area at a time. Preview the combined changes before applying them.';
  $('manual-tab').querySelector('.action-bar-copy p').textContent = 'Open a browser by hand or rehearse a local task list. Manual browsing can use direct access or a metered residential proxy. It is not counted as Onboarding or engagement.';
  const workflowLabel = document.querySelector('[data-tab="workflows-tab"] .nav-copy');
  if (workflowLabel) workflowLabel.textContent = 'Workflows';
  $('btn-open-create-workflow').title = 'Create an automation workflow';

  // Collapse the schedule composer, and give every field a permanent label.
  const scheduleEditor = document.querySelector('.schedule-editor');
  if (scheduleEditor) {
    const disclosure = document.createElement('details'); disclosure.className = 'workspace-disclosure';
    disclosure.innerHTML = '<summary>Create or edit a schedule</summary>';
    scheduleEditor.before(disclosure); disclosure.appendChild(scheduleEditor);
  }
  const scheduleLabels = { 'schedule-name': 'Schedule name', 'schedule-task': 'Task', 'schedule-trigger': 'Repeat', 'schedule-time': 'Local time', 'schedule-interval': 'Every', 'schedule-unit': 'Interval unit', 'schedule-weekdays': 'Weekdays', 'schedule-timezone': 'Schedule timezone', 'schedule-workflow-id': 'Workflow', 'schedule-profile-id': 'Profile', 'schedule-onboarding-profile': 'Onboarding profile', 'schedule-onboarding-proxy': 'Explicit proxy exit', 'schedule-onboarding-duration': 'Duration (minutes)' };
  Object.entries(scheduleLabels).forEach(([id, title]) => {
    const input = $(id); if (!input) return;
    const label = document.createElement('label');
    label.className = 'workspace-schedule-field'; label.htmlFor = id; label.textContent = title;
    if (id === 'schedule-grader-headless') label.classList.add('workspace-schedule-checkbox');
    input.before(label); label.appendChild(input);
  });
  const scheduleDisclosure = document.querySelector('.workspace-disclosure');
  document.addEventListener('click', event => { if (event.target.closest('[data-schedule-action="edit"]') && scheduleDisclosure) scheduleDisclosure.open = true; });

  // Spend Guard uses the source app's existing fields and commands, arranged
  // into usage, limits and pricing. Sample values never reach the live bridge.
  const guard = $('spend-guard-card');
  const guardFields = guard.querySelector('.form-row-2');
  const guardActions = $('btn-sg-save').parentElement;
  const guardReadout = $('sg-readout');
  const tierHeading = guardReadout.nextElementSibling;
  const tierHint = tierHeading.nextElementSibling;
  const tierTable = $('sg-tier-body').closest('.table-container');
  const tierFields = $('sg-tier-name').closest('.form-row-2');
  const tierActions = $('btn-sg-tier-add').parentElement;
  const newTier = document.createElement('details'); newTier.className = 'workspace-disclosure';
  newTier.innerHTML = '<summary>Add a priced tier</summary>'; newTier.append(tierFields, tierActions);
  sectionViews(guard, 'configure/customization/safeguards', [
    ['usage', 'Today’s usage', guardReadout],
    ['limits', 'Budget limits', [guardFields, guardActions]],
    ['tiers', 'Tiers & prices', [tierHeading, tierHint, tierTable, newTier]],
  ], guard.querySelector('.card-description'));
  guard.append($('sg-feedback'));
  guard.querySelector('.card-description').textContent = 'Metered bandwidth, budgets and priced proxy tiers. Automated launches follow your existing limits; by-hand routed reads are metered but are never blocked.';
  guardReadout.style.whiteSpace = 'normal'; guardReadout.className = 'workspace-spend-readout';
  let guardLoaded = false;
  renderSpendGuardReadout = function(snapshot) {
    const fleet = snapshot.fleet || {}, cfg = snapshot.config || {};
    const metric = (name, value, hint) => `<div class="metric-card"><h4>${esc(name)}</h4><p class="metric-value">${esc(value)}</p><small>${esc(hint)}</small></div>`;
    guardReadout.innerHTML = `<div class="workspace-usage-period"><div><strong>Today</strong><span>${esc(snapshot.timezone || cfg.timezone || 'System timezone')}</span></div>${state(snapshot.limits_active ? 'enforcing' : 'metering only')}</div><div class="metrics-grid">${metric('Measured bandwidth', `${formatGbs(fleet.bytes)} GB`, cfg.fleet_daily_gb == null ? 'No fleet GB limit set' : `${cfg.fleet_daily_gb} GB daily limit`)}${metric('Measured spend', `$${Number(fleet.cost_usd || 0).toFixed(2)}`, cfg.fleet_daily_usd == null ? 'No fleet dollar limit set' : `$${cfg.fleet_daily_usd} daily limit`)}${metric('In-flight holds', `${formatGbs(fleet.holds_bytes)} GB`, 'Reserved for active work')}${metric('Effective bandwidth', `${formatGbs(fleet.effective_bytes)} GB`, 'Used for the existing budget checks')}</div><h4>Profile usage</h4>${table(['Profile', 'Measured GB', 'Measured spend'], (snapshot.profiles || []).map(profile => `<tr><td>${esc(profile.name || profile.profile_id)}</td><td>${formatGbs(profile.bytes)} GB</td><td>$${Number(profile.cost_usd || 0).toFixed(2)}</td></tr>`).join(''), 'No profile usage recorded today.')}<h4 class="workspace-subheading">Tier usage</h4>${table(['Tier', 'Today', 'Cost today', 'Monthly usage / cap'], (snapshot.tiers || []).map(tier => `<tr><td>${esc(tier.name)}</td><td>${formatGbs(tier.day_bytes)} GB</td><td>${tier.price_per_gb == null ? 'Unpriced' : `$${Number(tier.day_cost_usd || 0).toFixed(2)}`}</td><td>${formatGbs(tier.month_bytes)} GB / ${tier.monthly_gb_cap == null ? 'No cap' : `${esc(tier.monthly_gb_cap)} GB`}</td></tr>`).join(''), 'No priced tiers configured.')}<p class="form-hint">${snapshot.unpriced_active_exits ? `${Number(snapshot.unpriced_active_exits)} active exits are unpriced. GB is metered, but dollar budgets cannot account for those exits.` : 'Historic spend retains the price recorded at the time of the event.'}</p>${related([['Proxy inventory', '#/configure/proxies'], ['Pulse warnings', '#/monitor/pulse']])}`;
  };
  renderSpendGuardTiers = function() {
    const body = $('sg-tier-body');
    body.innerHTML = spendGuardTiers.map(tier => `<tr><td><strong>${esc(tier.name)}</strong></td><td>${tier.price_per_gb == null ? 'Unpriced' : `$${Number(tier.price_per_gb).toFixed(2)}`}</td><td>${tier.monthly_gb_cap == null ? 'No cap' : `${esc(tier.monthly_gb_cap)} GB`}</td><td>${esc(tier.session_duration_minutes ?? 120)} min</td><td>${tier.ip_roll_policy === 'abort_on_roll' ? 'Abort session' : 'Continue session'}</td><td>${Number(tier.assigned_proxies || 0)}</td><td><button class="btn btn-secondary btn-sm" type="button" data-edit-guard-tier="${esc(tier.id)}">Details & edit</button></td></tr>`).join('') || '<tr><td colspan="7">No tiers configured. Add a tier to price your exits.</td></tr>';
  };
  loadSpendGuard = async function() {
    const api = window.desktopBridge?.api;
    const feedback = $('sg-feedback');
    try {
      const isPreview = previewBridgeActive && typeof api?.get_spend_guard !== 'function';
      if (!isPreview && typeof api?.get_spend_guard !== 'function') { feedback.textContent = 'The Spend Guard bridge is not available in this process.'; return; }
      const snapshot = isPreview ? {
        success: true, timezone: 'America/Toronto', limits_active: true,
        config: { fleet_daily_gb: 5, fleet_daily_usd: 12, profile_daily_gb: 1, profile_daily_usd: 3, run_ceiling_mb: 150, warn_pct: 80, safety_margin_pct: 5, timezone: 'America/Toronto' },
        fleet: { bytes: 1280000000, cost_usd: 3.20, holds_bytes: 180000000, effective_bytes: 1533000000 },
        profiles: [{ profile_id: 'preview-active', name: 'Preview Active 01', bytes: 780000000, cost_usd: 1.95 }, { profile_id: 'preview-Onboarding-1', name: 'Preview Onboarding 01', bytes: 500000000, cost_usd: 1.25 }],
        tiers: [{ id: 'sample-tier', tier_id: 'sample-tier', name: 'Residential · sample tier', price_per_gb: 2.5, monthly_gb_cap: 100, session_duration_minutes: 120, ip_roll_policy: 'continue', assigned_proxies: 2, day_bytes: 1280000000, day_cost_usd: 3.2, month_bytes: 4800000000 }], unpriced_active_exits: 0,
      } : await api.get_spend_guard();
      if (!snapshot.success) throw new Error(snapshot.error || 'Spend Guard unavailable');
      // Readout tier_id is not the editable inventory id. Join Profileh existing
      // endpoints so prices and pin policies are not silently misidentified.
      if (!isPreview && typeof api.list_proxy_tiers === 'function') {
        const listing = await api.list_proxy_tiers();
        const tiers = Array.isArray(listing) ? listing : listing.tiers || [];
        snapshot.tiers = tiers.map(tier => ({ ...(snapshot.tiers || []).find(usage => (usage.tier_id || usage.id) === tier.id), ...tier }));
      }
      renderSpendGuard(snapshot); guardLoaded = true;
      $('btn-sg-save').disabled = isPreview;
      $('btn-sg-tier-add').disabled = isPreview;
      feedback.textContent = isPreview ? 'Sandbox sample data — these are not your actual usage or prices. Saving is disabled in this preview.' : '';
    } catch (error) { feedback.textContent = `Could not load Spend Guard: ${error.message}`; }
  };
  $('btn-sg-save').addEventListener('click', saveSpendGuard);
  $('btn-sg-tier-add').addEventListener('click', addSpendGuardTier);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-guard-tier]'); if (!button) return;
    const tier = spendGuardTiers.find(item => String(item.id) === button.dataset.editGuardTier); if (!tier) return;
    const editable = typeof window.desktopBridge?.api?.update_proxy_tier === 'function';
    const input = (name, attr, value, type = 'number', extra = '') => `<label class="form-group">${name}<input class="input-field" type="${type}" ${attr} value="${esc(value ?? '')}" ${extra}></label>`;
    inspect(tier.name, 'Tier & price', `<p>Prices apply to new spend events. Historic costs keep their original price snapshot.</p><div class="workspace-tier-editor">${input('Name', 'data-tier-name', tier.name, 'text')}${input('Price per GB ($)', 'data-tier-price', tier.price_per_gb, 'number', 'min="0" step="0.01"')}${input('Monthly cap (GB)', 'data-tier-cap', tier.monthly_gb_cap, 'number', 'min="0" step="0.1"')}${input('Pin window (minutes)', 'data-tier-pin', tier.session_duration_minutes, 'number', 'min="1" max="1440"')}<label class="form-group">If the exit IP rolls<select class="input-field" data-tier-roll><option value="continue">Continue the session</option><option value="abort_on_roll">Abort the session</option></select></label><div class="workspace-inline-actions"><button type="button" class="btn btn-primary" data-save-tier ${editable ? '' : 'disabled'}>Save tier</button><button type="button" class="btn btn-danger-outline" data-delete-tier ${editable ? '' : 'disabled'}>Delete tier</button></div><p class="workspace-tier-feedback" role="status"></p></div>`);
    drawer.querySelector('[data-tier-roll]').value = tier.ip_roll_policy || 'continue';
    drawer.querySelector('[data-save-tier]').addEventListener('click', async () => {
      await saveSpendGuardTier(tier.id, drawer.querySelector('.workspace-tier-editor'));
      drawer.querySelector('.workspace-tier-feedback').textContent = $('sg-feedback').textContent;
    });
    drawer.querySelector('[data-delete-tier]').addEventListener('click', async () => {
      await deleteSpendGuardTier(tier.id, tier.name);
      drawer.querySelector('.workspace-tier-feedback').textContent = $('sg-feedback').textContent;
    });
  });

  // Forms are retained in memory on navigation, never persisted to disk.
  const fieldDrafts = new Map();
  function retainDraftFields(root) {
    root.querySelectorAll('input[id], select[id], textarea[id]').forEach(input => {
      const value = fieldDrafts.get(input.id);
      if (!value) return;
      if (input.type === 'checkbox' || input.type === 'radio') input.checked = value.checked;
      else if (input.multiple) [...input.options].forEach(option => { option.selected = value.selected.includes(option.value); });
      else input.value = value.value;
    });
  }
  ['customize-tab', 'deploy-tab', 'manual-tab', 'operations-tab'].forEach(id => {
    const root = $(id);
    root.addEventListener('input', event => {
      if (!event.target.matches('input, select, textarea')) return;
      const input = event.target;
      if (input.id && !input.id.startsWith('schedule-') && input.type !== 'password') fieldDrafts.set(input.id, { value: input.value, checked: input.checked, selected: [...(input.selectedOptions || [])].map(option => option.value) });
    });
  });
  // Live status refreshes must never replace an edited select or budget.
  const originalDispatchOptions = renderDispatchComposerOptions;
  renderDispatchComposerOptions = function() {
    originalDispatchOptions(); retainDraftFields($('deploy-tab')); syncDispatchFieldVisibility();
  };
  const originalRuntimeSettings = applyRuntimeSettings;
  applyRuntimeSettings = function(settings, renderForm = false) {
    originalRuntimeSettings(settings, renderForm);
    if (renderForm) retainDraftFields($('operations-tab'));
  };
  const originalOperationsLoad = loadOperationsOverview;
  loadOperationsOverview = async function() {
    await originalOperationsLoad(); await window.WorkspaceSchedules?.refreshChoices(); retainDraftFields($('operations-tab'));
  };

  // Workflow library: an actual register, with read-only details on demand.
  renderWorkflows = function() {
    const container = $('workflow-list-container');
    const query = $('workspace-workflow-search').value.toLowerCase();
    const workflows = (workflowsList || []).filter(wf => `${wf.name} ${wf.description} ${wf.id}`.toLowerCase().includes(query));
    $('workspace-workflow-search-count').textContent = `${workflows.length} workflows`;
    pageRows('workflows', workflows, container, rows => table(['Workflow', 'Steps', 'Active limit', 'Source', 'Actions'], rows.map(wf => {
      const attrs = `data-workflow-id="${esc(wf.id)}" data-workflow-name="${esc(wf.name)}"`;
      return `<tr><td><button class="workspace-record-name" type="button" data-inspect-workflow="${esc(wf.id)}">${esc(wf.name)}</button><small>${esc(wf.description || 'No description provided')}</small></td><td>${esc(wf.total_steps ?? wf.steps?.length ?? 0)}</td><td>${esc(wf.concurrency_limit ?? 2)} concurrent</td><td>${esc(wf.generation_source || 'manual')}</td><td><div class="workspace-inline-actions">${action('launch-workflow', 'Run', attrs)}${action('edit-workflow', 'Edit', attrs)}${action('duplicate-workflow', 'Copy', attrs)}${action('delete-workflow', 'Delete', attrs)}</div></td></tr>`;
    }).join(''), query ? 'No workflows match your search.' : 'No workflows yet. Create one with New Workflow.'));
  };
  toolbar($('workflow-list-container'), 'workspace-workflow-search', 'Workflow name, description or ID', () => { pages.set('workflows', 1); renderWorkflows(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-inspect-workflow]');
    if (!button) return;
    const wf = workflowsList.find(item => String(item.id) === button.dataset.inspectWorkflow);
    if (!wf) return;
    inspect(wf.name, 'Workflow details', `<p>${esc(wf.description || 'No description provided.')}</p><dl>${field('Workflow ID', wf.id)}${field('Type', wf.target_type)}${field('Active limit', wf.concurrency_limit)}${field('Channels', (wf.allowlist_channels || []).join(', '))}${field('Videos', (wf.allowlist_videos || []).join(', '))}${field('Updated', localDate(wf.updated_at))}</dl><h3>Steps</h3><ol>${(wf.steps || []).map(step => `<li>${esc(step.name || step.step_type || step.type || 'Step')}</li>`).join('') || '<li>No step detail returned</li>'}</ol>${related([['Run reports', queryHref('monitor/reports', 'workflow', wf.id)], ['Schedule a run', `#/operate/schedules?create=workflow&workflow=${encodeURIComponent(wf.id)}`], ['Deployments', '#/operate/deployments/history']])}`);
  });

  // Fleet is pod-first. The bridge snapshot already supplies pod_id/pod_name;
  // grouping and pagination are presentation only, not new execution paths.
  let selectedFleetPod = '';
  const fleetProfileToolbar = toolbar($('fleet-container'), 'workspace-fleet-search', 'Profile name or ID', () => { pages.set('fleet', 1); renderFleet(); }, '<label>State<select id="workspace-fleet-state" class="input-field"><option value="">All states</option><option value="active">Active</option><option value="Onboarding">Onboarding</option><option value="eligible">Eligible</option><option value="quarantined">Quarantined</option><option value="blocked">Blocked</option></select></label>');
  const fleetPodBar = document.createElement('div');
  fleetPodBar.className = 'workspace-fleet-podbar';
  fleetPodBar.innerHTML = '<label class="workspace-fleet-picker">Pod<select id="workspace-fleet-pod" class="input-field" aria-label="Choose a pod"><option value="">All pods</option></select></label><label class="workspace-fleet-pod-search">Find pod<input id="workspace-fleet-pod-search" class="input-field" type="search" placeholder="Pod name or target"></label>';
  const fleetPodCount = document.createElement('span');
  fleetPodCount.className = 'workspace-count';
  fleetPodCount.id = 'workspace-fleet-pod-count';
  fleetPodCount.setAttribute('aria-live', 'polite');
  fleetProfileToolbar.before(fleetPodBar);
  function fleetPodGroups(profiles) {
    const groups = new Map();
    const ensure = (id, name, target = '') => {
      const key = String(id || 'unassigned');
      if (!groups.has(key)) groups.set(key, { id:key, name:name || 'Unassigned profiles', target, profiles:[] });
      return groups.get(key);
    };
    (fleetState?.pods || []).forEach(pod => ensure(pod.id, pod.name, pod.target_url));
    profiles.forEach(profile => ensure(profile.pod_id, profile.pod_name).profiles.push(profile));
    return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  function selectFleetPod(id, updateUrl = false) {
    selectedFleetPod = String(id || '');
    pages.set('fleet', 1); pages.set('fleet-pods', 1);
    if (updateUrl) history.replaceState(null, '', `${location.pathname}${location.search}#/monitor/fleet${selectedFleetPod ? `?pod=${encodeURIComponent(selectedFleetPod)}` : ''}`);
    if (fleetState) renderFleet();
  }
  buildFleetCards = buildFleetTable = function(container, profiles) {
    container.className = 'workspace-fleet-register';
    const groups = fleetPodGroups(profiles);
    const selected = groups.find(group => group.id === selectedFleetPod);
    container.dataset.fleetView = selected ? 'profiles' : 'pods';
    const selector = $('workspace-fleet-pod');
    selector.innerHTML = `<option value="">All pods</option>${groups.map(group => `<option value="${esc(group.id)}">${esc(group.name)} · ${group.profiles.length}</option>`).join('')}`;
    selector.value = selected?.id || '';
    fleetProfileToolbar.hidden = !selected;
    fleetPodBar.querySelector('.workspace-fleet-pod-search').hidden = Boolean(selected);
    if (!selected) {
      const query = $('workspace-fleet-pod-search').value.trim().toLowerCase();
      const filtered = groups.filter(group => `${group.name} ${group.target} ${group.id}`.toLowerCase().includes(query));
      fleetPodCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'pod' : 'pods'} · ${profiles.length} profiles`;
      container.innerHTML = '<div class="workspace-fleet-heading" data-view="pods"><div class="workspace-fleet-heading-copy"><h4>All pods</h4><div class="workspace-fleet-heading-detail"><p>Choose a pod to see its profiles, current work and live views.</p></div></div></div>';
      container.querySelector('.workspace-fleet-heading-detail').appendChild(fleetPodCount);
      const register = document.createElement('div'); container.appendChild(register);
      pageRows('fleet-pods', filtered, register, rows => table(['Pod', 'Profiles', 'Active now', 'Onboarding', 'Eligible', 'Attention', 'Next scheduled'], rows.map(group => {
        const count = bucket => group.profiles.filter(profile => profile.bucket === bucket).length;
        const next = group.profiles.map(profile => profile.next_scheduled_at).filter(Boolean).sort()[0];
        return `<tr><td><button class="workspace-record-name workspace-fleet-pod-name" type="button" data-fleet-open-pod="${esc(group.id)}"><strong>${esc(group.name)}</strong><small>${esc(group.target || 'Open profiles')}</small></button></td><td>${group.profiles.length}</td><td>${count('active')}</td><td>${count('Onboarding')}</td><td>${count('eligible')}</td><td>${count('quarantined') + count('blocked')}</td><td>${next ? esc(localDate(next)) : 'Not scheduled'}</td></tr>`;
      }).join(''), query ? 'No pods match this search.' : 'No pods in the fleet yet.'));
      return;
    }
    const query = $('workspace-fleet-search').value.trim().toLowerCase();
    const bucket = $('workspace-fleet-state').value;
    const filtered = selected.profiles.filter(profile => (!bucket || profile.bucket === bucket) && `${profile.name} ${profile.profile_id}`.toLowerCase().includes(query));
    fleetPodCount.textContent = `${filtered.length} of ${selected.profiles.length} profiles`;
    const count = name => selected.profiles.filter(profile => profile.bucket === name).length;
    container.innerHTML = `<div class="workspace-fleet-heading"><div class="workspace-fleet-heading-copy"><h4>${esc(selected.name)}</h4><div class="workspace-fleet-heading-detail"><p>${esc(selected.target || 'Profiles and current activity')}</p></div></div><div class="workspace-fleet-counts"><span class="is-active"><strong>${count('active')}</strong> active</span><span><strong>${count('Onboarding')}</strong> Onboarding</span><span><strong>${count('eligible')}</strong> eligible</span><span class="is-attention"><strong>${count('quarantined') + count('blocked')}</strong> attention</span></div><button type="button" class="btn btn-secondary btn-sm" data-fleet-open-pod="">All pods</button></div>`;
    container.querySelector('.workspace-fleet-heading-detail').appendChild(fleetPodCount);
    const register = document.createElement('div'); container.appendChild(register);
    pageRows('fleet', filtered, register, rows => table(['Profile', 'State', 'Score / onboarding', 'Latest activity', 'Next scheduled', 'Live view'], rows.map(profile => `<tr><td><button type="button" class="workspace-record-name" data-inspect-profile="${esc(profile.profile_id)}">${esc(profile.name)}</button><small>${esc(profile.device_type || 'Unknown device')}</small></td><td>${state(profile.bucket)}</td><td>${fleetTrustOnboarding(profile)}</td><td>${fleetActivityCell(profile)}</td><td>${profile.next_scheduled_at ? esc(localDate(profile.next_scheduled_at)) : 'Not scheduled'}</td><td>${watchAction(profile)}</td></tr>`).join(''), selected.profiles.length ? 'No profiles match these filters.' : 'No profiles in this pod yet.'));
  };
  $('workspace-fleet-pod').addEventListener('change', event => selectFleetPod(event.target.value, true));
  $('workspace-fleet-pod-search').addEventListener('input', () => { pages.set('fleet-pods', 1); renderFleet(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-fleet-open-pod]');
    if (button) selectFleetPod(button.dataset.fleetOpenPod, true);
  });
  $('workspace-fleet-state').addEventListener('change', () => { pages.set('fleet', 1); renderFleet(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-inspect-profile]'); if (!button) return;
    const profile = fleetState?.profiles?.find(item => item.profile_id === button.dataset.inspectProfile); if (!profile) return;
    inspect(profile.name, 'Profile context', `${state(profile.bucket)}<div class="workspace-inline-actions">${watchAction(profile)}</div><dl>${field('Pod', profile.pod_name)}${field('Profile ID', profile.profile_id)}${field('Device', profile.device_type)}${field('Trust', profile.trust_score)}${field('Onboarding hours', window.FleetPresentation.OnboardingHours(profile.onboarding_hours))}${field('Target readiness', profile.gate_message)}${field('Placement', profile.placement ? [profile.placement.name, profile.placement.city].filter(Boolean).join(' · ') : 'No region bound')}${field('Activity', fleetActivityLine(profile))}${field('Latest session', profile.session ? `${profile.session.status} · ${profile.session.actions_completed || 0} actions` : 'No session')}${field('Next scheduled', profile.next_scheduled_at ? localDate(profile.next_scheduled_at) : 'None')}</dl>${fleetErrorDetail(profile)}${related([['Schedule Onboarding', `#/operate/schedules?create=Onboarding&profile=${encodeURIComponent(profile.profile_id)}`], ['Task schedules', queryHref('operate/schedules', 'profile', profile.profile_id)], ['Profile runs', queryHref('monitor/reports', 'profile', profile.profile_id)], ['Profile console', queryHref('monitor/console', 'profile', profile.profile_id)], ['Pods & profiles', queryHref('operate/pods', 'pod', profile.pod_id || '')]])}`);
  });

  // Pulse separates urgency, subject and acknowledgement instead of stacking
  // multi-paragraph cards. All warning content is still in the inspector.
  renderPulseBoard = function() {
    $('pulse-counts').className = 'workspace-pulse-summary';
    $('pulse-counts').innerHTML = `<span><strong>${Number(pulseCounts.unacked || 0)}</strong> unacknowledged</span><span class="is-critical"><strong>${Number(pulseCounts.critical || 0)}</strong> critical</span><span><strong>${Number(pulseCounts.open || 0)}</strong> open</span>`;
    const query = $('workspace-pulse-search').value.toLowerCase();
    const mode = $('workspace-pulse-ack').value;
    const rows = pulseWarnings.filter(warning => (!mode || (mode === 'unread' ? !warning.ack : warning.ack)) && `${warning.title} ${warning.reason} ${pulseEntityLabel(warning)}`.toLowerCase().includes(query));
    $('workspace-pulse-search-count').textContent = `${rows.length} warnings`;
    pageRows('pulse', rows, $('pulse-board'), items => table(['Attention', 'Warning', 'Affected', 'Last seen', 'Action'], items.map(warning => `<tr><td>${state(warning.severity)}<small>${esc(PULSE_SEVERITY_LABELS[warning.severity] || '')}</small></td><td><button class="workspace-record-name" type="button" data-inspect-warning="${esc(warning.id)}">${esc(warning.title)}</button><small>${esc(warning.reason)}</small></td><td>${esc(pulseEntityLabel(warning))}</td><td>${esc(localDate(warning.last_seen))}</td><td>${warning.resolved_at ? state('resolved') : warning.ack ? state('acknowledged') : action('ack-warning', 'Acknowledge', `data-warning-id="${esc(warning.id)}"`)}</td></tr>`).join(''), 'No warnings match this view.'));
  };
  toolbar($('pulse-board'), 'workspace-pulse-search', 'Warning, reason or affected profile', () => { pages.set('pulse', 1); renderPulseBoard(); }, '<label>Acknowledgement<select class="input-field" id="workspace-pulse-ack"><option value="">All</option><option value="unread">Needs acknowledgement</option><option value="read">Acknowledged</option></select></label>');
  $('workspace-pulse-ack').addEventListener('change', () => { pages.set('pulse', 1); renderPulseBoard(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-inspect-warning]'); if (!button) return;
    const warning = pulseWarnings.find(item => String(item.id) === button.dataset.inspectWarning); if (!warning) return;
    inspect(warning.title, 'Pulse · warning detail', `${state(warning.severity)}<p>${esc(warning.reason)}</p><dl>${field('Affected', pulseEntityLabel(warning))}${field('Entity ID', warning.entity_id)}${field('First seen', localDate(warning.first_seen))}${field('Last seen', localDate(warning.last_seen))}${field('Acknowledged', warning.ack ? localDate(warning.ack_at) : 'Not acknowledged')}${field('Resolved', warning.resolved_at ? localDate(warning.resolved_at) : 'Still open')}</dl><div class="workspace-inline-actions">${action('pulse-goto', 'Open affected workspace', `data-alerts-tab="${esc(pulseTabForEntity(warning.entity_type))}"`)}</div>`);
    drawer.querySelector('[data-action="pulse-goto"]').addEventListener('click', closeInspector);
  });

  // Console's existing pause, history cursor and clear-view behavior are kept.
  const originalConsoleFilter = consoleRowPassesFilters;
  consoleRowPassesFilters = event => originalConsoleFilter(event) && `${event.message} ${event.event_type} ${event.profile_id} ${event.session_id}`.toLowerCase().includes(($('workspace-console-search')?.value || '').toLowerCase());
  buildConsoleRow = function(event) {
    const row = document.createElement('tr'); row.className = 'workspace-log-row';
    row.innerHTML = `<td class="workspace-log-time">${esc(consoleFormatTime(event.timestamp))}</td><td>${state(event.severity)}</td><td class="workspace-log-type">${esc(CONSOLE_TYPE_LABELS[event.event_type] || event.event_type)}</td><td class="workspace-log-message">${esc(event.message || '(no message)')}</td><td>${esc(profileName(event.profile_id))}</td><td><button class="workspace-log-open" type="button" aria-label="Inspect event ${esc(event.event_id || '')}">↗</button></td>`;
    row.addEventListener('click', () => inspect(CONSOLE_TYPE_LABELS[event.event_type] || event.event_type, 'Console event', `${state(event.severity)}<p>${esc(event.message)}</p><dl>${field('Time', localDate(event.timestamp))}${field('Profile', profileName(event.profile_id))}${field('Profile ID', event.profile_id)}${field('Pod', podsById.get(event.pod_id)?.name || event.pod_id)}${field('Run type', event.run_type)}${field('Session / run', event.session_id)}${field('Event ID', event.event_id)}</dl><h3>Event payload</h3><pre>${esc(JSON.stringify(event.payload || {}, null, 2))}</pre>${event.profile_id ? related([['Runs for this profile', queryHref('monitor/reports', 'profile', event.profile_id)]]) : ''}`));
    return row;
  };
  const originalConsoleRender = renderConsoleStream;
  renderConsoleStream = function() {
    originalConsoleRender();
    $('workspace-console-search-count').textContent = `${consoleEvents.filter(consoleRowPassesFilters).length} visible`;
  };
  const consoleSearchBar = toolbar(document.querySelector('#console-tab .console-toolbar'), 'workspace-console-search', 'Search loaded events, run ID or message', renderConsoleStream);
  consoleSearchBar.classList.add('workspace-console-mainbar');
  consoleSearchBar.append(document.querySelector('#console-tab > .action-bar .action-bar-controls'));
  document.querySelector('#console-tab .console-stream-heading').append($('workspace-console-search-count'));

  // The run ID is the row identity; Inspect is the sole report-opening action.
  const originalReportRender = renderReportingDashboard;
  renderReportingDashboard = function(page) {
    originalReportRender(page);
    const rows = [...$('report-history-body').rows];
    (page.reports || []).forEach((report, index) => {
      const cell = rows[index]?.cells[0]; if (!cell) return;
      cell.innerHTML = `<span class="mono">${esc(report.report_id)}</span>`;
    });
  };
  const reportFooter = $('btn-report-prev').parentElement; reportFooter.classList.add('workspace-page-footer');
  const pageSize = document.createElement('label'); pageSize.className = 'workspace-inline-actions';
  pageSize.innerHTML = 'Rows per page <select class="input-field" id="workspace-report-size" aria-label="Report rows per page"><option>25</option><option>50</option><option>100</option></select>';
  reportFooter.appendChild(pageSize);
  $('workspace-report-size').addEventListener('change', event => { reportPageSize = Number(event.target.value); reportPage = 1; loadReportingDashboard(); });
  // Named choices assist selection without removing support for exact IDs.
  const profilesList = document.createElement('datalist'); profilesList.id = 'workspace-profile-options';
  const workflowsOptions = document.createElement('datalist'); workflowsOptions.id = 'workspace-workflow-options';
  document.body.append(profilesList, workflowsOptions);
  ['report-profile-filter', 'schedule-profile-id'].forEach(id => $(id).setAttribute('list', profilesList.id));
  ['report-workflow-filter', 'schedule-workflow-id'].forEach(id => $(id).setAttribute('list', workflowsOptions.id));
  async function refreshNamedOptions() {
    const api = window.desktopBridge?.api; if (!api) return;
    const results = await Promise.allSettled([api.get_fleet_overview?.(), api.list_workflows?.()]);
    const fleet = results[0].status === 'fulfilled' ? results[0].value : null;
    const workflows = results[1].status === 'fulfilled' ? results[1].value : null;
    if (fleet?.success) {
      if (!fleetState) fleetState = fleet;
      profilesList.innerHTML = (fleet.profiles || []).map(profile => `<option value="${esc(profile.profile_id)}">${esc(profile.name)} · ${esc(profile.pod_name)}</option>`).join('');
    }
    if (Array.isArray(workflows)) workflowsOptions.innerHTML = workflows.map(wf => `<option value="${esc(wf.id)}">${esc(wf.name)}</option>`).join('');
  }

  // Keep all action owners. Route changes control only visibility, loaded form
  // retention, context filters and return position. No data is saved here.
  setupNavigation = function() {
    const routes = {
      'operate/pods': ['pods-tab', 'Pods & Profiles', loadPods],
      'operate/accounts': ['accounts-tab', 'Accounts', () => window.AccountWorkspace?.load?.()],
      'operate/workflows': ['workflows-tab', 'Workflows', () => Promise.all([loadWorkflows(), loadWorkflowRuns()])],
      'operate/schedules': ['task-schedules-tab', 'Task Schedules', loadOperationsOverview],
      'operate/deployments': ['deploy-tab', 'Deployments', loadDeployTab],
      'operate/manual': ['manual-tab', 'Manual Tasks', loadManualTab],
      'operate/site-traffic': ['site-traffic-tab', 'Site Traffic', () => window.SiteTrafficWorkspace?.load?.()],
      'monitor/fleet': ['monitor-tab', 'Fleet Monitor', loadFleetOverview],
      'monitor/pulse': ['alerts-tab', 'Pulse', loadPulseBoard],
      'monitor/console': ['console-tab', 'Console', activateConsoleTab],
      'monitor/reports': ['reports-tab', 'Run Reports', loadReportingDashboard],
      'configure/customization': ['customize-tab', 'Customization', loadCustomizationInputs],
      'configure/proxies': ['proxies-tab', 'Proxy Inventory', loadProxies],
      'system/operations': ['operations-tab', 'Operations', loadOperationsOverview],
      'system/health': ['system-tab', 'System Health', loadOperationsOverview],
    };
    const formTabs = new Set(['customize-tab', 'deploy-tab', 'manual-tab', 'operations-tab']);
    const apply = async () => {
      const serial = ++routeSerial;
      const [rawPath, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
      const parts = rawPath.split('/'); const prefix = parts.slice(0, 2).join('/');
      const route = routes[prefix] || routes['operate/pods']; const [tab, title, loader] = route;
      const scroll = document.querySelector('.content-scroll');
      if (activeRoute) scrollPositions.set(activeRoute, scroll.scrollTop);
      const sameRoot = activeRoute.split('/').slice(0, 2).join('/') === prefix;
      activeRoute = rawPath;
      window.WorkspaceSchedules?.routeLeaving();
      closeInspector(); window.MissionControl.closeInfo();
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.id === tab));
      document.querySelectorAll('.nav-item').forEach(item => { item.classList.toggle('active', item.dataset.tab === tab); item.setAttribute('aria-current', item.dataset.tab === tab ? 'page' : 'false'); });
      document.body.classList.toggle('operations-active', tab === 'operations-tab');
      document.body.classList.toggle('customization-active', tab === 'customize-tab');
      $('view-title').textContent = title; document.querySelector('.topbar-eyebrow').textContent = prefix.split('/')[0];
      if (tab === 'operations-tab') {
        window.MissionControl.setOperationsView(parts[2] || 'overview');
        if (parts[2] === 'backups') selectView('system/operations/backups', parts[3]);
      } else selectView(prefix, parts[2]);
      window.WorkspaceSchedules?.routeView(rawPath, new URLSearchParams(search));
      if (prefix === 'configure/customization' && (parts[2] === 'safeguards' || viewMemory.get(prefix) === 'safeguards')) {
        selectView('configure/customization/safeguards', parts[3]);
        if (!guardLoaded) await loadSpendGuard();
      }
      const params = new URLSearchParams(search);
      if (tab === 'monitor-tab') selectFleetPod(params.get('pod') || '');
      if (tab === 'reports-tab' && (params.has('profile') || params.has('workflow'))) {
        $('report-profile-filter').value = params.get('profile') || '';
        $('report-workflow-filter').value = params.get('workflow') || '';
        $('report-search').value = ''; $('report-status-filter').value = ''; reportPage = 1;
        $('report-advanced-fields').classList.add('open');
        $('report-more-filters').setAttribute('aria-expanded', 'true');
      }
      if (tab === 'console-tab') window.WorkspaceRecords?.setConsoleContext(params);
      try {
        if (!(formTabs.has(tab) && loadedForms.has(tab)) && !(sameRoot && views.has(prefix))) {
          await loader(); loadedForms.add(tab);
        }
        if (serial !== routeSerial) return;
        if (tab === 'console-tab' && params.has('profile')) {
          consoleProfileFilter = params.get('profile'); await loadConsoleHistory(false, true);
        }
        if (tab === 'console-tab' && params.has('run')) await loadConsoleHistory(false, true);
        if (tab === 'reports-tab' && params.has('report')) await window.openRunReportDetails(params.get('report'));
        if (tab === 'pods-tab' && params.has('pod')) {
          const pod = podsById.get(params.get('pod')); if (pod) await selectPod(pod.id, pod.name, pod.target_url);
        }
        scroll.scrollTop = scrollPositions.get(rawPath) || 0;
        if (['reports-tab', 'operations-tab', 'console-tab'].includes(tab)) refreshNamedOptions();
        await window.WorkspaceSchedules?.routeReady(rawPath, params);
      } catch (error) { console.error(`Could not display ${title}:`, error); }
    };
    window.applyMissionRoute = apply;
    document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => {
      const path = Object.keys(routes).find(key => routes[key][0] === item.dataset.tab); if (!path) return;
      if (location.hash === `#/${path}`) apply(); else location.hash = `#/${path}`;
    }));
    window.addEventListener('hashchange', () => { if (appInitialized) apply(); });
  };
})();
