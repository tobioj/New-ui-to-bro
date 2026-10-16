/* UI projections and an explicitly browser-only schedule store. No timers or
   launch logic: production scheduling remains owned by the desktop backend. */
(function(root) {
  'use strict';
  const names = { onboarding_run: 'Onboarding session', workflow_run: 'Workflow run', site_run: 'Site visit', database_backup: 'Database backup', profile_compaction: 'Profile cache compaction', profile_readiness_recalculation: 'Readiness recalculation', proxy_health_check: 'Proxy health check', grader_rerun: 'Grader re-test (drift watch)' };
  const graderSurfaces = new Set(['local', 'tls', 'Profiledetector', 'pixelscan', 'creepjs', 'brotector', 'browserleaks_dns', 'browserleaks_webrtc', 'sannysoft']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const domain = job => ['onboarding_run', 'workflow_run', 'site_run'].includes(job?.task_type) ? 'task' : names[job?.task_type] ? 'maintenance' : 'unlinked';
  function partition(jobs, runs, remembered = []) {
    const catalog = new Map([...remembered, ...jobs].map(job => [job.id, job]));
    const groups = { task: { jobs: [], runs: [] }, maintenance: { jobs: [], runs: [] }, unlinked: { jobs: [], runs: [] } };
    jobs.forEach(job => groups[domain(job)].jobs.push(job));
    runs.forEach(run => { const job = catalog.get(run.scheduled_job_id); groups[domain(job)].runs.push({ ...run, schedule: job || null }); });
    return groups;
  }
  function recurrence(job) {
    const t = job.trigger || {};
    if (job.trigger_type === 'interval') return `Every ${t.every} ${Number(t.every) === 1 ? String(t.unit).replace(/s$/, '') : t.unit}`;
    if (job.trigger_type === 'window') { const days = (t.weekdays || []).map(day => day[0].toUpperCase() + day.slice(1)).join(', '); return `${t.fires_per_day ?? 1}×/day between ${String(t.start_hour ?? 0).padStart(2, '0')}:00–${String(t.end_hour ?? 0).padStart(2, '0')}:00` + (days ? ` · ${days}` : ''); }
    const time = `${String(t.hour ?? 0).padStart(2,'0')}:${String(t.minute ?? 0).padStart(2,'0')}`;
    return `${job.trigger_type === 'weekly' ? (t.weekdays || []).map(day => day[0].toUpperCase()+day.slice(1)).join(', ') : 'Daily'} at ${time}`;
  }
  function definition(fields, existing, settings = {}) {
    const type = fields.task;
    const graderPayload = { ...(type === existing?.task_type ? existing.payload : {}), surfaces: String(fields.graderSurfaces ?? '').trim() || 'all', headless: fields.graderHeadless === true };
    if (String(fields.graderProxy ?? '').trim()) graderPayload.proxy_id = fields.graderProxy;
    else delete graderPayload.proxy_id;
    const payload = type === 'onboarding_run' ? { profile_id: fields.onboardingProfile, proxy_id: fields.proxy, duration_minutes: Number(fields.duration), seasoning: true }
      : type === 'workflow_run' ? { workflow_id: fields.workflow, profile_id: fields.profile, browser_visible: settings.browser_visible ?? true, cursor_visible: settings.cursor_visible ?? true }
      : type === 'grader_rerun' ? graderPayload : {};
    const [hour, minute] = fields.time.split(':').map(Number);
    return { name: fields.name.trim(), job_type: type === 'onboarding_run' ? 'Onboarding' : type === 'workflow_run' ? 'workflow' : 'maintenance', task_type: type, enabled: existing ? existing.enabled : true,
      trigger_type: fields.repeat, trigger: fields.repeat === 'interval' ? { every: Number(fields.every), unit: fields.unit } : { hour, minute, ...(fields.repeat === 'weekly' ? { weekdays: fields.weekdays } : {}) }, timezone: fields.timezone.trim(), payload };
  }
  function validate(job) {
    if (!job.name || job.name.length > 160) throw Error('Use a schedule name between 1 and 160 characters.');
    if (!names[job.task_type]) throw Error('Choose a supported task.');
    const expected = job.task_type === 'onboarding_run' ? 'Onboarding' : job.task_type === 'workflow_run' ? 'workflow' : 'maintenance';
    if (job.job_type !== expected) throw Error('The task and schedule category must match.');
    if (!['interval','daily','weekly'].includes(job.trigger_type)) throw Error('Choose a supported recurrence.');
    const t = job.trigger || {};
    if (job.trigger_type === 'interval') {
      if (!Number.isInteger(t.every) || t.every < 1 || t.every > 365 || !['minutes','hours','days','weeks'].includes(t.unit)) throw Error('Use an interval from 1 to 365 and a supported unit.');
    } else {
      if (!Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23 || !Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59) throw Error('Choose a valid local time.');
      if (job.trigger_type === 'weekly' && (!t.weekdays?.length || t.weekdays.some(day => !['mon','tue','wed','thu','fri','sat','sun'].includes(day)))) throw Error('Choose at least one weekday.');
    }
    if (job.timezone) { try { new Intl.DateTimeFormat('en', {timeZone: job.timezone}).format(); } catch { throw Error('Enter a valid timezone, such as America/Toronto.'); } }
    if (job.task_type === 'workflow_run' && (!job.payload?.profile_id || !job.payload?.workflow_id)) throw Error('Choose a workflow and profile.');
    if (job.task_type === 'onboarding_run' && (!job.payload?.profile_id || !job.payload?.proxy_id || !Number.isInteger(job.payload.duration_minutes) || job.payload.duration_minutes < 1 || job.payload.duration_minutes > 120)) throw Error('Onboarding requires a profile, an explicit proxy, and a duration of 1–120 minutes.');
    if (job.task_type === 'grader_rerun') {
      const raw = job.payload?.surfaces;
      if (typeof raw !== 'string' && !Array.isArray(raw)) throw Error("Grader surfaces must be 'all' or a list of surface names.");
      const surfaceText = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (surfaceText === 'all' || (typeof raw === 'string' && !surfaceText)) job.payload.surfaces = 'all';
      else {
        const tokens = (Array.isArray(raw) ? raw : raw.split(',')).map(value => String(value).trim().toLowerCase()).filter(Boolean);
        const unknown = tokens.filter(value => !graderSurfaces.has(value));
        if (unknown.length) throw Error(`Unknown grader surface(s): ${[...new Set(unknown)].sort().join(', ')}.`);
        if (!tokens.length) throw Error('Grader surfaces must name at least one valid surface.');
        job.payload.surfaces = [...new Set(tokens)];
      }
      if (typeof job.payload.headless !== 'boolean') throw Error('Grader re-test headless flag must be a boolean.');
      if (job.payload.proxy_id != null && typeof job.payload.proxy_id !== 'string') throw Error('Grader re-test proxy id must be a string.');
    }
    return job;
  }
  function seeds(now) {
    const base = { enabled: true, is_builtin: false, timezone: 'America/Toronto', last_run_at: null, next_run_at: null };
    const built = (id, name, trigger_type, trigger, enabled = true) => ({ ...base, id, name, job_type: 'maintenance', task_type: id, enabled, is_builtin: true, trigger_type, trigger, payload: {} });
    return [
      {...base, id:'preview-Onboarding-cadence', name:'Morning Onboarding · Preview Onboarding 01', job_type:'Onboarding', task_type:'onboarding_run', trigger_type:'interval', trigger:{every:90,unit:'minutes'}, payload:{profile_id:'p-warm-1',proxy_id:'preview-residential-exit',duration_minutes:4,seasoning:true}, next_run_at:new Date(now+45*60000).toISOString()},
      {...base, id:'preview-workflow-cadence', name:'Weekly playback QA', job_type:'workflow', task_type:'workflow_run', enabled:false, trigger_type:'weekly', trigger:{weekdays:['mon','wed','fri'],hour:10,minute:0}, payload:{profile_id:'p-warm-1',workflow_id:'mock-wf-1',browser_visible:true,cursor_visible:true}},
      built('database_backup','Daily Database Snapshot','daily',{hour:2,minute:30}),
      built('profile_compaction','Routine Profile Cache Compaction','interval',{every:7,unit:'days'}),
      built('profile_readiness_recalculation','Daily Profile Readiness Recalculation','daily',{hour:3,minute:15}),
      built('proxy_health_check','Configured Proxy Health Check','interval',{every:5,unit:'minutes'},false),
      {...built('grader_rerun','Weekly Grader Re-test','weekly',{hour:9,minute:0,weekdays:['mon']}),payload:{surfaces:'all',headless:false}},
    ];
  }
  function createPreviewStore({ saved, now = Date.now(), persist = () => {}, makeId = () => `preview-schedule-${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
    const defaults = seeds(now);
    let jobs = Array.isArray(saved?.jobs) ? copy(saved.jobs) : copy(defaults);
    if (!jobs.some(job => job.id === 'grader_rerun')) jobs.push(copy(defaults.find(job => job.id === 'grader_rerun')));
    const runs = Array.isArray(saved?.runs) ? copy(saved.runs) : [
      {id:'preview-occurrence-warm',scheduled_job_id:'preview-Onboarding-cadence',status:'SKIPPED',scheduled_for:new Date(now-600000).toISOString(),skip_reason:'Profile already has an active run.',launched_run_id:null,launched_run_type:null,outcome:{}},
      {id:'preview-occurrence-workflow',scheduled_job_id:'preview-workflow-cadence',status:'DISPATCHED',scheduled_for:new Date(now-3600000).toISOString(),launched_run_type:'workflow',launched_run_id:'sample-run-002',outcome:{jitter_seconds:181}},
      {id:'preview-occurrence-backup',scheduled_job_id:'database_backup',status:'COMPLETED',scheduled_for:new Date(now-7200000).toISOString(),launched_run_id:null,launched_run_type:null,outcome:{size_bytes:139264}},
    ];
    // Commit only after browser storage accepts the change; a quota/privacy
    // failure must not leave an apparently saved record in memory.
    const commit = nextJobs => { persist(copy({ jobs: nextJobs, runs })); jobs=nextJobs; };
    const find = id => { const job=jobs.find(item=>item.id===id); if(!job) throw Error('Schedule not found.'); return job; };
    return {
      snapshot: () => copy({jobs,runs}),
      save(data,id) {
        validate(data); const old = id ? find(id) : null;
        if(old?.is_builtin && (old.task_type!==data.task_type || old.job_type!==data.job_type)) throw Error('A built-in schedule’s task type cannot be changed.');
        const job={...old,...copy(data),id:old?.id || makeId(),is_builtin:old?.is_builtin || false,next_run_at:null};
        commit(old ? jobs.map(item=>item.id===id?job:item) : [...jobs,job]);
        return copy(job);
      },
      toggle(id,enabled) { const job={...find(id),enabled,next_run_at:null}; commit(jobs.map(item=>item.id===id?job:item)); return copy(job); },
      duplicate(id) { const source=copy(find(id)); source.name=`${source.name} (copy)`.slice(0,160); source.enabled=false; return this.save(source); },
      remove(id) { if(find(id).is_builtin) throw Error('Built-in schedules cannot be deleted. Pause them instead.'); commit(jobs.filter(item=>item.id!==id)); },
      reset(id) { const original=defaults.find(item=>item.id===id && item.is_builtin); if(!original) throw Error('Not a built-in schedule.'); commit(jobs.map(item=>item.id===id?copy(original):item)); return copy(original); },
    };
  }
  const api = { names, domain, partition, recurrence, definition, validate, createPreviewStore };
  if(typeof module === 'object' && module.exports) module.exports=api; else root.WorkspaceScheduleModel=api;
})(typeof window === 'object' ? window : globalThis);
