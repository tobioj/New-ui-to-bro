/* Deterministic browser-demo records, isolated from the desktop bridge. */
(function(root) {
  'use strict';
  function makeReports(now) {
    return Array.from({ length: 64 }, (_, index) => {
      const status = ['COMPLETED', 'COMPLETED', 'FAILED', 'STOPPED', 'RUNNING', 'QUEUED', 'COMPLETED', 'COMPLETED'][index % 8];
      const type = index % 3 === 0 ? 'session' : 'workflow';
      const id = `sample-run-${String(index + 1).padStart(3, '0')}`;
      const profile = index % 2 === 0 ? 'p-active' : 'p-warm-1';
      const created = new Date(now - index * 37 * 60000).toISOString();
      return {
        report_id: `${type}:${id}`, source_run_id: id, run_type: type, status,
        created_at: created, started_at: status === 'QUEUED' ? null : created,
        ended_at: ['COMPLETED', 'FAILED', 'STOPPED'].includes(status) ? new Date(now - index * 37 * 60000 + 90000).toISOString() : null,
        profile_id: profile, profile_name: profile === 'p-active' ? 'Preview Active 01' : 'Preview Onboarding 01',
        workflow_id: type === 'workflow' ? 'mock-wf-1' : null,
        workflow_name: type === 'workflow' ? 'YouTube Channel & Playback QA Suite' : `Seasoning Session — ${profile === 'p-active' ? 'Preview Active 01' : 'Preview Onboarding 01'}`,
        local_observed_playback_seconds: status === 'COMPLETED' ? 42 : 0,
        // These preview sessions have no timing telemetry; the real reporting
        // service can enrich either run type when telemetry exists.
        page_load_time_ms: type === 'workflow' && status !== 'QUEUED' ? 820 : null,
        playback_startup_time_ms: type === 'workflow' && status !== 'QUEUED' ? 1140 : null,
        actions_or_steps_completed: status === 'COMPLETED' ? 2 : 0,
        failed_actions_or_steps: status === 'FAILED' ? 1 : 0,
        retries: type === 'workflow' && status === 'FAILED' ? 1 : 0,
        error_class: status === 'FAILED' ? 'NavigationTimeout' : null,
        error_message: status === 'FAILED' ? 'The page did not become ready within the configured timeout.' : null,
        checkpoint: { step_index: status === 'COMPLETED' ? 2 : 0 }, resource_usage: {}, artifacts: [],
        step_results: type === 'workflow' && status === 'COMPLETED' ? [{ status: 'PASSED', name: 'Navigate to channel', duration_ms: 820 }, { status: 'PASSED', name: 'Verify playback', duration_ms: 1140 }] : type === 'workflow' && status === 'FAILED' ? [{ status: 'FAILED', name: 'Navigate to channel', duration_ms: 820, retry_count: 1 }] : [],
      };
    });
  }
  function reportPage(reports, filters = {}) {
    const query = (filters.query || '').trim().toLowerCase();
    const matching = reports.filter(report =>
      (!filters.statuses?.length || filters.statuses.includes(report.status)) &&
      (!filters.run_types?.length || filters.run_types.includes(report.run_type)) &&
      (!filters.profile_id || report.profile_id === filters.profile_id) &&
      (!filters.workflow_id || report.workflow_id === filters.workflow_id) &&
      (!filters.start_utc || new Date(report.created_at) >= new Date(filters.start_utc)) &&
      (!filters.end_utc || new Date(report.created_at) <= new Date(filters.end_utc)) &&
      (!query || [report.report_id, report.profile_name, report.workflow_name, report.error_message].join(' ').toLowerCase().includes(query))
    ).sort((a, b) => (new Date(b.created_at) - new Date(a.created_at)) * (filters.sort_desc === false ? -1 : 1));
    const size = Math.min(100, Math.max(1, Number(filters.page_size) || 25));
    const page = Math.min(Math.max(1, Number(filters.page) || 1), Math.max(1, Math.ceil(matching.length / size)));
    const summary = { active: 0, completed: 0, failed: 0, stopped: 0, local_observed_playback_seconds: 0 };
    matching.forEach(report => {
      const key = ['RUNNING', 'QUEUED'].includes(report.status) ? 'active' : report.status.toLowerCase();
      if (key in summary) summary[key]++;
      summary.local_observed_playback_seconds += report.local_observed_playback_seconds || 0;
    });
    return { reports: matching.slice((page - 1) * size, page * size), total: matching.length, page, page_size: size, summary };
  }
  function eventPage(events, filters = {}, limit = 200, beforeId = null) {
    const matches = events.filter(event => ['profile_id', 'pod_id', 'session_id', 'run_type', 'event_type', 'severity'].every(key => !filters[key] || event[key] === filters[key]) && (!filters.since || new Date(event.timestamp) >= new Date(filters.since)) && (!filters.until || new Date(event.timestamp) <= new Date(filters.until)));
    const eligible = matches.filter(event => !beforeId || Number(event.id) < Number(beforeId)).sort((a, b) => b.id - a.id);
    const page = eligible.slice(0, limit);
    return { success: true, events: page, total: matches.length, next_before_id: eligible.length > limit ? page.at(-1).id : null };
  }
  const model = { makeReports, reportPage, eventPage };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.WorkspacePreviewModel = model;
})(typeof window === 'object' ? window : globalThis);
