/* Augment only setupMockBridge, never a connected production API. */
(() => {
  const original = setupMockBridge;
  setupMockBridge = function() {
    original();
    const api = window.desktopBridge.api;
    // Local demo persistence only. Never replace a connected desktop bridge.
    const storageKey = 'Workspace Controller-sandbox-schedules-v1';
    let savedSchedules;
    try { savedSchedules = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Fresh demo if storage is unavailable or malformed. */ }
    const scheduleStore = WorkspaceScheduleModel.createPreviewStore({
      saved: savedSchedules,
      persist: snapshot => localStorage.setItem(storageKey, JSON.stringify(snapshot)),
    });
    const operationRead = api.get_operations_overview;
    api.get_operations_overview = async () => { const data = await operationRead(), snapshot = scheduleStore.snapshot(); return {...data, schedules: snapshot.jobs, schedule_runs: snapshot.runs}; };
    const scheduleAction = action => { try { return {success:true,schedule:action()}; } catch(error) { return {success:false,error:error.message}; } };
    api.save_schedule = async (data,id) => scheduleAction(() => scheduleStore.save(data,id));
    api.set_schedule_enabled = async (id,enabled) => scheduleAction(() => scheduleStore.toggle(id,enabled));
    api.duplicate_schedule = async id => scheduleAction(() => scheduleStore.duplicate(id));
    api.delete_schedule = async id => scheduleAction(() => scheduleStore.remove(id));
    api.reset_builtin_schedule = async id => scheduleAction(() => scheduleStore.reset(id));
    api.run_schedule_now = async () => ({success:false,error:'Sandbox only: no task was launched. Run now uses your real scheduler in the desktop app.'});
    api.start_watch = async () => ({ success: true });
    api.stop_watch = async () => ({ success: true });
    const model = window.WorkspacePreviewModel;
    const reports = model.makeReports(Date.now() - 120000);
    api.get_reporting_dashboard = async filters => model.reportPage(reports, filters);
    api.get_run_report = async id => {
      const report = reports.find(item => item.report_id === id);
      return report ? { found: true, report } : { found: false, error: 'This record is not included in the sandbox sample.' };
    };
    const originalEvents = api.get_console_events;
    const events = reports.map((report, index) => ({
      id: 1000 + reports.length - index, event_id: `sample-event-${index + 1}`,
      event_type: 'run.session_state', timestamp: report.created_at,
      profile_id: report.profile_id, pod_id: 'mock-pod-1', session_id: report.source_run_id, run_type: report.run_type,
      severity: report.status === 'FAILED' ? 'error' : 'info',
      message: report.error_message || `Session state: ${report.status}`,
      payload: { status: report.status, source: 'sandbox sample' },
    }));
    api.get_console_events = async (filters, limit, beforeId) => {
      const old = await originalEvents({}, 200, null);
      return model.eventPage([...events, ...(old.events || [])], filters, limit, beforeId);
    };
  };
})();
