/* Navigation and collection affordances over the existing read contracts.
   No execution, scheduler, activation or storage behavior is implemented here. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => escapeHtml(String(value ?? '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const date = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';

  // Filter/page the returned window without re-creating action controls. Each
  // footer states its scope; this is never presented as whole-database paging.
  function enhanceCollection(id, noun, scope = 'loaded') {
    const body = $(id);
    if (!body) return;
    const wrapper = body.closest('.table-container');
    const bar = document.createElement('div'); bar.className = 'workspace-toolbar workspace-table-filter';
    bar.innerHTML = `<label class="workspace-search">Find ${esc(noun)}<input class="input-field" type="search" placeholder="Search ${esc(scope)} ${esc(noun)}" aria-label="Search ${esc(noun)}"></label><label>Rows<select class="input-field" aria-label="${esc(noun)} per page"><option>10</option><option>25</option><option>50</option></select></label>`;
    const footer = document.createElement('div'); footer.className = 'workspace-page-footer workspace-table-pager';
    footer.innerHTML = '<span role="status"></span><div class="workspace-inline-actions"><button type="button" class="btn btn-secondary btn-sm">Previous</button><button type="button" class="btn btn-secondary btn-sm">Next</button></div>';
    wrapper.before(bar); wrapper.after(footer);
    const search = bar.querySelector('input'), sizeControl = bar.querySelector('select');
    const [previous, next] = footer.querySelectorAll('button');
    const empty = document.createElement('p'); empty.className = 'workspace-empty'; empty.textContent = 'No matching records in this loaded view.'; empty.hidden = true; wrapper.after(empty);
    let page = 1;
    function draw() {
      const rows = [...body.rows].filter(row => row.cells.length > 1);
      const query = search.value.trim().toLocaleLowerCase();
      const matches = rows.filter(row => row.textContent.toLocaleLowerCase().includes(query));
      const size = Number(sizeControl.value);
      page = Math.max(1, Math.min(page, Math.ceil(matches.length / size)));
      const visible = new Set(matches.slice((page - 1) * size, page * size));
      rows.forEach(row => { row.hidden = !visible.has(row); });
      empty.hidden = !rows.length || matches.length > 0;
      footer.querySelector('[role="status"]').textContent = `${matches.length ? `${(page - 1) * size + 1}–${Math.min(page * size, matches.length)} of ${matches.length}` : '0'} matching · ${rows.length} ${scope} ${noun}`;
      previous.disabled = page <= 1; next.disabled = page * size >= matches.length;
    }
    search.addEventListener('input', () => { page = 1; draw(); });
    sizeControl.addEventListener('change', () => { page = 1; draw(); });
    previous.addEventListener('click', () => { page--; draw(); });
    next.addEventListener('click', () => { page++; draw(); });
    new MutationObserver(draw).observe(body, { childList: true });
    draw();
  }
  [
    ['profile-table-body', 'profiles'], ['proxy-table-body', 'proxies'],
    ['workflow-runs-table-body', 'workflow runs'], ['deployments-body', 'deployments'],
    ['operations-profiles-body', 'profile storage records'],
    ['operations-backups-body', 'snapshots', 'recent'],
    ['manual-sessions-body', 'browser sessions'], ['local-runs-body', 'local runs', 'recent'],
  ].forEach(args => enhanceCollection(...args));

  // A stable profile picker replaces a growing wall of identifier chips.
  const profileHost = $('console-profile-chips');
  profileHost.previousElementSibling.textContent = 'Profile';
  profileHost.previousElementSibling.htmlFor = 'workspace-console-profile';
  profileHost.innerHTML = '<select class="input-field workspace-console-profile" id="workspace-console-profile" aria-label="Console profile"><option value="">All profiles</option></select>';
  updateConsoleChips = function() {
    const select = $('workspace-console-profile');
    const profiles = new Map((fleetState?.profiles || []).map(profile => [profile.profile_id, profile.name]));
    consoleEvents.forEach(event => { if (event.profile_id && !profiles.has(event.profile_id)) profiles.set(event.profile_id, event.profile_id); });
    if (consoleProfileFilter && !profiles.has(consoleProfileFilter)) profiles.set(consoleProfileFilter, consoleProfileFilter);
    select.innerHTML = '<option value="">All profiles</option>' + [...profiles].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    select.value = consoleProfileFilter;
  };
  const advanced = document.createElement('details'); advanced.className = 'workspace-disclosure workspace-console-advanced';
  advanced.innerHTML = `<summary>Run, event & time filters</summary><div class="form-row-2">
    <label class="form-group">Run / session ID<input class="input-field" id="workspace-console-run" placeholder="Exact run ID"></label>
    <label class="form-group">Run type<select class="input-field" id="workspace-console-type"><option value="">All run types</option><option value="session">Session</option><option value="workflow">Workflow</option></select></label>
    <label class="form-group">Event type<input class="input-field" id="workspace-console-event" placeholder="For example, profile.action"></label>
    <label class="form-group">From (local time)<input type="datetime-local" class="input-field" id="workspace-console-since"></label>
    <label class="form-group">Until (local time)<input type="datetime-local" class="input-field" id="workspace-console-until"></label>
    </div><button class="btn btn-secondary btn-sm" type="button" data-reset-console-context>Clear run & time filters</button>`;
  document.querySelector('#console-tab .console-stream-meta').before(advanced);
  function extraFilters() {
    const filters = {};
    [['run', 'session_id'], ['type', 'run_type'], ['event', 'event_type'], ['since', 'since'], ['until', 'until']].forEach(([id, key]) => {
      const value = $(`workspace-console-${id}`).value.trim();
      if (value) filters[key] = id === 'since' || id === 'until' ? new Date(value).toISOString() : value;
    });
    return filters;
  }
  const previousFilter = consoleRowPassesFilters;
  consoleRowPassesFilters = event => {
    const filters = extraFilters();
    return previousFilter(event) && (!filters.session_id || event.session_id === filters.session_id)
      && (!filters.run_type || event.run_type === filters.run_type)
      && (!filters.event_type || event.event_type === filters.event_type)
      && (!filters.since || new Date(event.timestamp) >= new Date(filters.since))
      && (!filters.until || new Date(event.timestamp) <= new Date(filters.until));
  };
  let consoleRequest = 0;
  loadConsoleHistory = async function(older = false, force = false) {
    const api = window.desktopBridge?.api;
    if (!api?.get_console_events || (older && !consoleNextBeforeId)) return;
    const request = ++consoleRequest;
    const filters = { ...extraFilters() };
    if (consolePodFilter) filters.pod_id = consolePodFilter;
    if (consoleProfileFilter) filters.profile_id = consoleProfileFilter;
    if (consoleSeverityFilter) filters.severity = consoleSeverityFilter;
    try {
      const result = await api.get_console_events(filters, CONSOLE_HISTORY_LIMIT, older ? consoleNextBeforeId : null);
      if (request !== consoleRequest) return;
      if (!result.success) throw new Error(result.error || 'Console history unavailable.');
      if (!older || force) { consoleEvents = []; consoleEventIds = new Set(); }
      (result.events || []).forEach(event => storeConsoleEvent(event));
      consoleNextBeforeId = result.next_before_id || null; consoleLoadedOnce = true;
      $('console-page-meta').textContent = `${result.total || 0} recorded${consoleNextBeforeId ? ` · ${consoleEvents.length} loaded` : ''}`;
      $('btn-console-older').disabled = !consoleNextBeforeId;
      $('console-feedback').textContent = '';
      renderConsoleStream();
    } catch (error) {
      if (request === consoleRequest) $('console-feedback').textContent = `Could not load console history: ${error.message}`;
    }
  };
  $('workspace-console-profile').addEventListener('change', event => { consoleProfileFilter = event.target.value; loadConsoleHistory(false, true); });
  advanced.addEventListener('change', () => loadConsoleHistory(false, true));
  advanced.querySelector('button').addEventListener('click', () => { advanced.querySelectorAll('input, select').forEach(input => { input.value = ''; }); loadConsoleHistory(false, true); });
  $('console-pod-filter').addEventListener('change', () => queueMicrotask(() => loadConsoleHistory(false, true)));
  $('console-severity-chips').addEventListener('click', () => queueMicrotask(() => loadConsoleHistory(false, true)));
  window.WorkspaceRecords = {
    setConsoleContext(params) {
      if (!params.has('run') && !params.has('profile')) return;
      $('workspace-console-run').value = params.get('run') || '';
      $('workspace-console-type').value = params.get('type') || '';
      consoleProfileFilter = params.get('profile') || '';
      consolePodFilter = ''; $('console-pod-filter').value = '';
      consoleSeverityFilter = ''; updateConsoleSeverityChips();
      ['event', 'since', 'until'].forEach(id => { $(`workspace-console-${id}`).value = ''; });
      $('workspace-console-search').value = '';
      advanced.open = params.has('run');
    },
  };

  // Source dates are UTC. The picker explicitly remains UTC, matching its
  // existing labels and contract; no silent timezone reinterpretation here.
  const reportTable = $('report-history-body').closest('table');
  reportTable.classList.add('workspace-report-table');
  reportTable.tHead.rows[0].innerHTML = ['Run', 'Type', 'Profile', 'Workflow', 'Status', 'Local Playback', 'Timings', 'Retries', 'Evidence'].map(label => `<th>${label}</th>`).join('');
  const previousReportRender = renderReportingDashboard;
  const reportRecords = new Map();
  renderReportingDashboard = function(page) {
    previousReportRender(page);
    (page.reports || []).forEach(report => reportRecords.set(report.report_id, report));
    const body = $('report-history-body');
    if (!(page.reports || []).length) { body.rows[0].cells[0].colSpan = 9; return; }
    [...body.rows].forEach((row, index) => {
      const report = page.reports[index];
      const timings = [
        report.page_load_time_ms == null ? null : `Page ${Math.round(report.page_load_time_ms)} ms`,
        report.playback_startup_time_ms == null ? null : `Startup ${Math.round(report.playback_startup_time_ms)} ms`,
      ].filter(Boolean);
      row.innerHTML = `<td><span class="mono">${esc(report.report_id)}</span></td>
        <td>${esc(report.run_type)}</td><td>${esc(report.profile_name || report.profile_id)}</td><td>${esc(report.workflow_name || '—')}</td>
        <td><span class="workspace-status" data-state="${esc(report.status.toLowerCase())}">${esc(report.status)}</span></td>
        <td>${Math.round(Number(report.local_observed_playback_seconds) || 0)}s <small>local</small></td>
        <td>${timings.length ? timings.map(timing => `<span class="workspace-report-timing">${esc(timing)}</span>`).join('') : '—'}</td>
        <td>${Number(report.retries || 0)}</td>
        <td><button type="button" class="btn btn-secondary btn-sm" data-action="open-report" data-report-id="${esc(report.report_id)}" aria-label="Inspect run ${esc(report.report_id)}">Inspect</button></td>`;
    });
  };
  // Ignore late responses when the user changes report filters quickly.
  let reportRequest = 0;
  loadReportingDashboard = async function() {
    const api = window.desktopBridge?.api; if (!api?.get_reporting_dashboard) return;
    const request = ++reportRequest;
    try {
      const page = await api.get_reporting_dashboard(collectReportFilters());
      if (request !== reportRequest) return;
      if (page.error) throw new Error(page.error);
      reportTotal = page.total || 0; reportPage = page.page || reportPage; reportPageSize = page.page_size || reportPageSize;
      renderReportingDashboard(page); $('report-feedback').textContent = '';
    } catch (error) { if (request === reportRequest) $('report-feedback').textContent = `Could not load reports: ${error.message}`; }
  };
  const originalReportDetail = window.openRunReportDetails;
  window.openRunReportDetails = async function(id) {
    await originalReportDetail(id);
    if ($('report-details-modal').style.display !== 'flex') return;
    const report = reportRecords.get(id);
    if (report) $('report-details-title').textContent = `${report.workflow_name || 'Browser session'} · ${report.profile_name || report.profile_id}`;
    // The typed ID is the reporting service's identity; the raw suffix is the
    // console's session_id for either supported run type.
    const [type, ...suffix] = String(id).split(':');
    const raw = suffix.join(':');
    $('workspace-report-context')?.remove();
    const links = document.createElement('nav'); links.className = 'workspace-report-context'; links.id = 'workspace-report-context'; links.setAttribute('aria-label', 'Run navigation');
    links.innerHTML = `<span class="mono">${esc(id)}</span>${raw && ['session', 'workflow'].includes(type) ? `<a href="#/monitor/console?${new URLSearchParams({ run: raw, type })}">Open this run’s console ↗</a>` : ''}<button class="btn btn-secondary btn-sm" type="button">Copy full ID</button>`;
    links.querySelector('a')?.addEventListener('click', () => { $('report-details-modal').style.display = 'none'; });
    links.querySelector('button').addEventListener('click', async event => {
      try { await navigator.clipboard.writeText(id); event.target.textContent = 'Copied'; }
      catch { event.target.textContent = 'Select the ID to copy'; }
    });
    $('report-details-summary').after(links);
    const evidence = $('report-details-evidence');
    const list = document.createElement('dl'); list.className = 'workspace-report-evidence';
    [...evidence.children].forEach(line => {
      const split = line.textContent.indexOf(':');
      const term = document.createElement('dt'), value = document.createElement('dd');
      term.textContent = line.textContent.slice(0, split); value.textContent = line.textContent.slice(split + 1).trim(); list.append(term, value);
    });
    if (report) {
      [['Created', date(report.created_at)], ['Started', date(report.started_at)], ['Ended', date(report.ended_at)], ['Page load', report.page_load_time_ms == null ? 'Not recorded' : `${Math.round(report.page_load_time_ms)} ms`], ['Playback startup', report.playback_startup_time_ms == null ? 'Not recorded' : `${Math.round(report.playback_startup_time_ms)} ms`]].forEach(([name, text]) => {
        const term = document.createElement('dt'), value = document.createElement('dd'); term.textContent = name; value.textContent = text; list.append(term, value);
      });
    }
    evidence.replaceChildren(list);
  };
})();
