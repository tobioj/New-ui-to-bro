// bridge-mock.js — a representative backend for local development.
// Implements the same async JSON contract the desktop host provides on
// window.desktopBridge.api. Activates only when no real bridge is present.
(() => {
  'use strict';

  if (window.desktopBridge?.api?.get_system_status) return; // a real host is present

  const now = () => new Date().toISOString();
  const ago = ms => new Date(Date.now() - ms).toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));

  // ---------------------------------------------------------------- profiles

  const deviceFor = i => (i % 3 === 1 ? 'macos' : 'windows');
  const resFor = device => (device === 'macos' ? '2560x1600' : '1920x1080');
  const gpuFor = device =>
    device === 'macos' ? 'Apple M-series GPU' : 'ANGLE (NVIDIA, RTX 3060 Direct3D11)';

  let profileSeq = 100;
  const makeProfile = (name, device, trust, hours, status) => ({
    id: `profile-${profileSeq++}`,
    name,
    device_type: device,
    resolution: resFor(device),
    gpu: gpuFor(device),
    trust_score: trust,
    onboarding_hours: hours,
    status: status || 'READY',
    region_id: 'region-us-east',
    playback_quality: 'standard',
    created_at: ago(86400000 * 12),
    last_run_at: ago(3600000 * 5),
  });

  const groups = [
    {
      id: 'group-1',
      name: 'Editorial Review',
      target_url: 'https://example.org/editorial',
      region_id: 'region-us-east',
      profile_count: 6,
      profiles: [
        makeProfile('Editorial 01', 'windows', 0.74, 88.5, 'PRODUCTION'),
        makeProfile('Editorial 02', 'macos', 0.66, 71.0, 'PRODUCTION'),
        makeProfile('Editorial 03', 'windows', 0.52, 44.0, 'READY'),
        makeProfile('Editorial 04', 'windows', 0.31, 19.5, 'Onboarding'),
        makeProfile('Editorial 05', 'macos', 0.69, 79.0, 'READY'),
        makeProfile('Editorial 06', 'windows', 0.58, 52.5, 'READY'),
      ],
    },
    {
      id: 'group-2',
      name: 'Product Research',
      target_url: 'https://example.org/products',
      region_id: 'region-us-west',
      profile_count: 5,
      profiles: [
        makeProfile('Research 01', 'windows', 0.71, 76.0, 'PRODUCTION'),
        makeProfile('Research 02', 'macos', 0.48, 37.0, 'READY'),
        makeProfile('Research 03', 'windows', 0.63, 58.0, 'READY'),
        makeProfile('Research 04', 'macos', 0.34, 21.0, 'Onboarding'),
        makeProfile('Research 05', 'windows', 0.77, 92.5, 'PRODUCTION'),
      ],
    },
    {
      id: 'group-3',
      name: 'Learning Lab',
      target_url: 'https://example.org/learn',
      region_id: 'region-uk',
      profile_count: 4,
      profiles: [
        makeProfile('Learning 01', 'windows', 0.57, 49.0, 'READY'),
        makeProfile('Learning 02', 'macos', 0.46, 40.0, 'READY'),
        makeProfile('Learning 03', 'windows', 0.75, 88.0, 'PRODUCTION'),
        makeProfile('Learning 04', 'macos', 0.29, 14.0, 'Onboarding'),
      ],
    },
  ];

  // ----------------------------------------------------------------- regions

  const regions = [
    { id: 'region-us-east', name: 'United States — East', country: 'US', city: 'New York', timezone: 'America/New_York' },
    { id: 'region-us-west', name: 'United States — West', country: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles' },
    { id: 'region-ca-east', name: 'Canada — East', country: 'CA', city: 'Toronto', timezone: 'America/Toronto' },
    { id: 'region-uk', name: 'United Kingdom', country: 'GB', city: 'London', timezone: 'Europe/London' },
  ];

  // ---------------------------------------------------------------- network

  const tiers = [{ id: 'tier-residential', name: 'Residential', price_per_gb: 2.5, monthly_gb_cap: null }];

  let proxySeq = 200;
  const proxies = [
    { id: 'proxy-201', server: 'http://ny-01.network.example:10001', proxy_type: 'residential', tier_id: 'tier-residential', country: 'US', city: 'New York', timezone: 'America/New_York', status: 'ACTIVE', reputation: { total_requests: 118, failed_requests: 4, average_latency_ms: 412 } },
    { id: 'proxy-202', server: 'http://la-01.network.example:10002', proxy_type: 'residential', tier_id: 'tier-residential', country: 'US', city: 'Los Angeles', timezone: 'America/Los_Angeles', status: 'ACTIVE', reputation: { total_requests: 96, failed_requests: 9, average_latency_ms: 588 } },
    { id: 'proxy-203', server: 'http://tor-01.network.example:10003', proxy_type: 'isp', tier_id: null, country: 'CA', city: 'Toronto', timezone: 'America/Toronto', status: 'ACTIVE', reputation: { total_requests: 64, failed_requests: 2, average_latency_ms: 501 } },
    { id: 'proxy-204', server: 'http://lon-01.network.example:10004', proxy_type: 'residential', tier_id: 'tier-residential', country: 'GB', city: 'London', timezone: 'Europe/London', status: 'ACTIVE', reputation: { total_requests: 143, failed_requests: 6, average_latency_ms: 622 } },
  ];

  // -------------------------------------------------------------- workflows

  const workflows = [
    { id: 'wf-1', name: 'Homepage render check', description: 'Load the homepage, verify the hero and nav render, capture a screenshot.', target_type: 'site', active: true, concurrency_limit: 2, created_at: ago(86400000 * 6) },
    { id: 'wf-2', name: 'Search submission flow', description: 'Type a query, submit, verify a results list renders.', target_type: 'site', active: true, concurrency_limit: 1, created_at: ago(86400000 * 4) },
    { id: 'wf-3', name: 'Article deep-read', description: 'Open an article, scroll to the end, verify related links resolve.', target_type: 'site', active: false, concurrency_limit: 1, created_at: ago(86400000 * 2) },
  ];

  let runSeq = 500;
  const workflowRuns = [
    { id: 'run-501', workflow_id: 'wf-1', workflow_name: 'Homepage render check', profile_id: 'profile-100', profile_name: 'Editorial 01', status: 'COMPLETED', steps_completed: 4, steps_total: 4, started_at: ago(3600000 * 3), completed_at: ago(3600000 * 3 + 92000) },
    { id: 'run-502', workflow_id: 'wf-2', workflow_name: 'Search submission flow', profile_id: 'profile-101', profile_name: 'Editorial 02', status: 'COMPLETED', steps_completed: 3, steps_total: 3, started_at: ago(3600000 * 2), completed_at: ago(3600000 * 2 + 61000) },
    { id: 'run-503', workflow_id: 'wf-1', workflow_name: 'Homepage render check', profile_id: 'profile-105', profile_name: 'Editorial 06', status: 'FAILED', steps_completed: 2, steps_total: 4, error_class: 'timeout', error_message: 'Hero element did not appear within 30s.', started_at: ago(3600000), completed_at: ago(3600000 - 30000) },
  ];

  // ---------------------------------------------------------------- reports

  const runReports = [
    { report_id: 'rep-1', run_id: 'run-501', run_type: 'workflow', profile: 'Editorial 01', workflow: 'Homepage render check', status: 'COMPLETED', local_playback_seconds: 0, duration_seconds: 92, retries: 0, started_at: ago(3600000 * 3) },
    { report_id: 'rep-2', run_id: 'run-505', run_type: 'task', profile: 'Research 01', workflow: null, status: 'COMPLETED', local_playback_seconds: 384, duration_seconds: 612, retries: 1, started_at: ago(3600000 * 5) },
    { report_id: 'rep-3', run_id: 'run-506', run_type: 'task', profile: 'Research 05', workflow: null, status: 'COMPLETED', local_playback_seconds: 522, duration_seconds: 780, retries: 0, started_at: ago(3600000 * 7) },
    { report_id: 'rep-4', run_id: 'run-503', run_type: 'workflow', profile: 'Editorial 06', workflow: 'Homepage render check', status: 'FAILED', local_playback_seconds: 0, duration_seconds: 30, retries: 2, started_at: ago(3600000) },
  ];

  // -------------------------------------------------------------- schedules

  let scheduleSeq = 700;
  const schedules = [
    { id: 'sch-701', name: 'Nightly maintenance', job_type: 'database_backup', trigger: 'daily', time_of_day: '02:30', timezone: 'America/Toronto', enabled: true, next_run_at: ago(-3600000 * 9) },
    { id: 'sch-702', name: 'Profile upkeep', job_type: 'profile_compaction', trigger: 'weekly', timezone: 'America/Toronto', enabled: true, next_run_at: ago(-3600000 * 60) },
    { id: 'sch-703', name: 'Morning onboarding batch', job_type: 'onboarding_run', trigger: 'interval', interval_hours: 4, timezone: 'America/Toronto', enabled: true, next_run_at: ago(-3600000 * 2), profile_id: 'profile-103' },
    { id: 'sch-704', name: 'Network health sweep', job_type: 'proxy_health_check', trigger: 'daily', time_of_day: '06:00', timezone: 'America/Toronto', enabled: false, next_run_at: null },
  ];

  // ---------------------------------------------------------------- alerts

  const warnings = [
    { id: 'w-1', rule_id: 'challenge_flagged', title: 'Challenge detected on a run', severity: 'critical', severity_class: 'call me now', entity_type: 'profile', entity_label: 'Editorial 03', reason: 'A verification page was served during the last run.', first_seen: ago(3600000), last_seen: ago(600000), ack: false },
    { id: 'w-2', rule_id: 'trust_below_gate', title: 'Profile below its readiness threshold', severity: 'warning', severity_class: 'morning summary', entity_type: 'profile', entity_label: 'Editorial 04', reason: 'Onboarding 19.5h but readiness 0.31 is below the 0.50 threshold.', first_seen: ago(7200000), last_seen: ago(1800000), ack: false },
    { id: 'w-3', rule_id: 'disk_low', title: 'Low disk space', severity: 'warning', severity_class: 'morning summary', entity_type: 'system', entity_label: null, reason: 'Disk free 8.2 GB (7.4%) is below the 10 GB floor.', first_seen: ago(86400000), last_seen: ago(43200000), ack: true },
  ];

  // ---------------------------------------------------------------- console

  const consoleEvents = [
    { id: 1, ts: ago(120000), level: 'info', event: 'session.state', message: 'Run started on Editorial 01', profile: 'Editorial 01' },
    { id: 2, ts: ago(118000), level: 'info', event: 'action', message: 'Navigated to https://example.org/editorial', profile: 'Editorial 01' },
    { id: 3, ts: ago(112000), level: 'info', event: 'action', message: 'Scrolled 640px', profile: 'Editorial 01' },
    { id: 4, ts: ago(96000), level: 'warning', event: 'retry', message: 'Selector miss, retrying with fallback', profile: 'Editorial 05' },
    { id: 5, ts: ago(88000), level: 'info', event: 'navigation', message: 'Opened /editorial/feature-2', profile: 'Editorial 05' },
    { id: 6, ts: ago(64000), level: 'error', event: 'error', message: 'Timeout waiting for hero element', profile: 'Editorial 06' },
    { id: 7, ts: ago(42000), level: 'info', event: 'session.state', message: 'Run completed (92 actions)', profile: 'Editorial 01' },
  ];

  // --------------------------------------------------------------- monitor

  const monitorSummary = {
    counts: { active: 2, onboarding: 3, eligible: 12, blocked: 1 },
    resources: { ram_available_mb: 9216, cpu_used_pct: 24.5, concurrency_limit: 4 },
  };

  // ------------------------------------------------------------------ misc

  let mockCustomizationInputs = null;
  let mockDispatches = [];
  let mockManualSessions = [];
  let mockLocalRuns = [];
  let seq = 900;

  const ok = extra => ({ success: true, ...(extra || {}) });
  const fail = error => ({ success: false, error });

  window.desktopBridge = {
    api: {
      // system / status
      get_system_status: async () => ({
        status: 'ready',
        concurrency_limit: 4,
        ram_used_pct: 38.2,
        ram_available_mb: 9216,
        cpu_used_pct: 24.5,
        version: '0.1.0',
      }),
      get_ws_info: async () => ({ port: 0, token: 'preview' }),
      get_recovery_status: async () => ({ issue: null }),

      // profiles / groups
      list_pods: async () => groups.map(({ profiles, ...group }) => ({ ...group, profile_count: profiles.length })),
      list_profiles: async groupId => clone((groups.find(g => g.id === groupId)?.profiles) || []),
      create_pod: async (name, target) => ok({ pod_id: `group-${seq++}`, name }),
      delete_pod: async () => ok(),
      list_regions: async () => ok({ regions: clone(regions) }),
      delete_profile: async () => ok(),
      retire_profile: async () => ok(),
      bulk_create_profiles: async (groupId, payload) => ok({ created: (payload?.names || []).length }),

      // network
      list_proxies: async () => clone(proxies.map(p => ({ ...p, tier_name: tiers.find(t => t.id === p.tier_id)?.name || null }))),
      list_proxy_tiers: async () => ok({ tiers: clone(tiers) }),
      create_proxy: async data => {
        if (!data?.server?.trim()) return fail('A network endpoint is required.');
        const id = `proxy-${seq++}`;
        proxies.unshift({ id, server: data.server.trim(), proxy_type: data.proxy_type, tier_id: data.tier_id || null, country: null, city: null, timezone: null, status: 'UNKNOWN', reputation: { total_requests: 0, failed_requests: 0, average_latency_ms: 0 } });
        return ok({ proxy_id: id });
      },
      delete_proxy: async () => ok(),
      test_proxy: async () => ok({ status: 'ACTIVE', latency_ms: 480 }),
      resolve_proxy_location: async () => ok({ country: 'US', city: 'New York' }),
      get_proxy_report: async () => ok({ total_requests: 0, failed_requests: 0 }),
      update_proxy_tier_assignment: async () => ok(),

      // workflows
      list_workflows: async () => clone(workflows),
      get_workflow: async id => clone(workflows.find(w => w.id === id)),
      create_workflow: async data => ok({ workflow_id: `wf-${seq++}`, ...data }),
      update_workflow: async () => ok(),
      delete_workflow: async () => ok(),
      duplicate_workflow: async () => ok({ workflow_id: `wf-${seq++}` }),
      validate_workflow: async () => ok({ valid: true, errors: [], warnings: [] }),
      launch_workflow: async () => ok({ run_id: `run-${runSeq++}` }),
      list_workflow_runs: async () => clone(workflowRuns),
      get_workflow_run_status: async id => clone(workflowRuns.find(r => r.id === id) || { status: 'COMPLETED' }),
      cancel_workflow_run: async () => ok(),
      resume_workflow_run: async () => ok(),
      get_ai_workflow_settings: async () => ok({ enabled: false, requests_remaining: 0 }),
      generate_ai_workflow: async () => fail('Planning is not available in preview mode.'),

      // onboarding runs / local tools
      launch_session: async () => ok({ session_id: `session-${seq++}` }),
      stop_session: async () => ok(),
      get_fleet_overview: async () => clone(monitorSummary),
      list_personas: async () => clone([
        { key: 'casual_browser', name: 'Casual browser', categories: ['general', 'news', 'lifestyle'] },
        { key: 'researcher', name: 'Researcher', categories: ['reference', 'science', 'education'] },
        { key: 'reader', name: 'Reader', categories: ['editorial', 'longform', 'culture'] },
        { key: 'shopper', name: 'Shopper', categories: ['retail', 'reviews', 'deals'] },
      ]),
      list_activities: async () => ok({ activities: [] }),

      // reports
      get_reporting_dashboard: async () => ok({
        summary: { active: 2, completed: 41, failed: 3, stopped: 1, local_playback_seconds: 18420 },
        reports: clone(runReports),
        page: 1,
        total_pages: 1,
      }),
      get_run_report: async () => ok({ report_id: 'rep-1', evidence: 'No anomalies recorded.', artifacts: [], steps: [] }),
      get_run_artifact: async () => ok({ content: '' }),
      save_run_reports: async (filters, format, outputPath) => ok({ path: outputPath || `/preview/exports/${window.APP_BRAND.files.runReport}.${format}`, size_bytes: 1024 }),

      // schedules
      list_schedules: async () => clone(schedules),
      save_schedule: async (data, id) => ok({ schedule_id: id || `sch-${scheduleSeq++}` }),
      set_schedule_enabled: async () => ok(),
      run_schedule_now: async () => ok(),
      duplicate_schedule: async () => ok({ schedule_id: `sch-${scheduleSeq++}` }),
      delete_schedule: async () => ok(),
      reset_builtin_schedule: async () => ok(),

      // alerts
      list_warnings: async () => clone(warnings),
      acknowledge_warning: async () => ok(),
      acknowledge_all_warnings: async () => ok(),

      // console
      get_console_events: async () => ok({ events: clone(consoleEvents), next_before_id: null }),

      // settings / operations
      get_application_settings: async () => ok({
        browser_visible: true,
        cursor_visible: true,
        automatic_backups: true,
        concurrency: 4,
        proxy_health_url: '',
        data_root: '/preview/data',
        database_path: '/preview/data/app.db',
      }),
      update_application_settings: async () => ok(),
      get_storage_inventory: async () => ok({ sizes: { database: 139264, profiles: 52428800, backups: 10485760, logs: 512000, total_data_root: 63546304 }, disk: { free_bytes: 10000000000 }, paths: { data_root: '/preview/data', database: '/preview/data/app.db', profiles: '/preview/data/profiles', backups: '/preview/data/backups', logs: '/preview/data/logs' } }),
      preview_data_relocation: async () => ok({ token: 'preview-move' }),
      execute_data_relocation: async () => ok(),
      preview_diagnostic_export: async () => ok({ files: 12, size_bytes: 4096 }),
      export_diagnostics: async () => ok({ path: '/preview/exports/diagnostics.zip' }),
      create_database_snapshot: async () => ok({ path: '/preview/data/backups/snapshot.db' }),
      recover_stale_profile_locks: async () => ok({ recovered: 0 }),
      preview_profile_compaction: async () => ok({ reclaimable_bytes: 5242880 }),
      compact_profile_cache: async () => ok({ reclaimed_bytes: 4194304 }),
      list_backups: async () => ok({ backups: [] }),
      list_schedule_outcomes: async () => ok({ outcomes: [] }),
      get_health_status: async () => ok({ overall: 'ok', database: 'ok', scheduler: 'ok', resources: 'ok' }),
      open_local_path: async () => ok(),
      choose_directory: async () => ok({ path: '/preview/exports' }),
      choose_save_path: async (name) => ok({ path: `/preview/exports/${name || 'export'}` }),
      choose_open_file: async () => ok({ path: '/preview/imports/archive' }),

      // report exports
      export_run_reports: async (filters, format) => ok({ filename: `${window.APP_BRAND.files.runReport}.${format}`, content_type: format === 'json' ? 'application/json' : 'text/csv', content: '' }),

      // customization / policies
      get_customization_inputs: async () => ok({ config: mockCustomizationInputs || { session_mix: { warmer_parts: 3, target_parts: 1, max_sessions_per_profile_day: 4 } } }),
      preview_customization_inputs: async value => ok({ effects: [], errors: [] }),
      apply_customization_inputs: async value => { mockCustomizationInputs = clone(value); return ok({ config: clone(value) }); },
      get_behavior: async () => ok({ config: { revision: 'preview' } }),
      update_behavior: async value => ok({ config: clone(value), revision: 'preview' }),
      get_playbook: async () => ok({ config: {} }),
      update_playbook: async value => ok({ config: clone(value), revision: 'preview' }),
      preview_playbook: async () => ok({ sessions: [], sampled_queries: [] }),
      get_rhythm: async () => ok({ config: { enabled: true, daily_minutes_cap: 360, active_hours_acceptance: true, rest_source: 'persona', rest_start_hour: 23, rest_end_hour: 7 } }),
      update_rhythm: async value => ok({ config: clone(value) }),
      get_target_gate: async () => ok({ config: { min_onboarding_hours: 48, min_trust_score: 0.5, degraded_trust_floor: 0.3, challenge_cooldown_hours: 24, challenge_retire_count: 3, challenge_retire_window_days: 7 } }),
      update_target_gate: async value => ok({ config: clone(value) }),
      get_ramp: async () => ok({ config: { enabled: false, weekly_caps: [0, 1, 2], growth_pct: 12 } }),
      update_ramp: async value => ok({ config: clone(value) }),
      get_resources: async () => ok({ config: { admission_pacing_enabled: true, min_gap_seconds: 300, jitter_seconds: 120, cpu_note_threshold: 85, ram_warn_floor: 15, ram_critical_floor: 8 } }),
      update_resources: async value => ok({ config: clone(value) }),
      get_spend_guard: async () => ok({ config: { fleet_daily_gb: null, fleet_daily_usd: null, profile_daily_gb: null, profile_daily_usd: null, run_ceiling_mb: null, warn_pct: 80, safety_margin_pct: 0, timezone: 'America/Toronto' } }),
      update_spend_guard: async value => ok({ config: clone(value), errors: [] }),
      get_window_visibility: async () => ok({ config: { managed: true, rotation_minutes: 5, max_slots: 8 } }),
      update_window_visibility: async value => ok({ config: clone(value) }),

      // batches
      get_dispatch_options: async () => ok({ workflows: clone(workflows), pods: groups.map(g => ({ id: g.id, name: g.name })), regions: clone(regions) }),
      preview_dispatch: async () => ok({ plan: [], warnings: [] }),
      create_dispatch: async data => { mockDispatches.push({ id: `batch-${seq++}`, ...clone(data), state: 'PLANNED', created_at: now() }); return ok(); },
      list_dispatches: async () => ok({ dispatches: clone(mockDispatches) }),
      cancel_dispatch: async () => ok(),
      launch_dispatch: async () => ok(),

      // local tools
      get_local_desk_options: async () => ok({ profiles: groups.flatMap(g => g.profiles.map(p => ({ id: p.id, name: p.name }))), proxies: clone(proxies) }),
      open_manual_session: async () => { const s = { id: `manual-${seq++}`, profile: 'Scratch', url: '', status: 'OPEN', opened_at: now() }; mockManualSessions.push(s); return ok({ session_id: s.id }); },
      close_manual_session: async () => ok(),
      list_manual_sessions: async () => ok({ sessions: clone(mockManualSessions) }),
      ensure_scratch_profile: async () => ok({ profile_id: 'scratch-1' }),
      start_local_run: async () => { const r = { id: `local-${seq++}`, profile: '', target: '', status: 'COMPLETED', tasks: 3, started_at: now() }; mockLocalRuns.push(r); return ok({ run_id: r.id }); },
      list_local_runs: async () => ok({ runs: clone(mockLocalRuns) }),
      get_check_target_gate: async () => ok({ allowed: true }),
      check_target_gate: async () => ok({ allowed: true }),
    },
  };
})();
