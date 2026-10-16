/* Frontend visibility derived from PersistentTaskScheduler.validate_definition.
   The backend remains authoritative for validation and execution. */
(function(root) {
  function scheduleFields(trigger, task) {
    const fields = ['schedule-name', 'schedule-task', 'schedule-trigger', 'schedule-timezone'];
    if (trigger === 'interval') fields.push('schedule-interval', 'schedule-unit');
    else fields.push('schedule-time');
    if (trigger === 'weekly') fields.push('schedule-weekdays');
    if (task === 'workflow_run') fields.push('schedule-workflow-id', 'schedule-profile-id');
    if (task === 'onboarding_run') fields.push('schedule-onboarding-profile', 'schedule-onboarding-proxy', 'schedule-onboarding-duration');
    if (task === 'grader_rerun') fields.push('schedule-grader-surfaces', 'schedule-grader-headless', 'schedule-grader-proxy');
    return fields;
  }
  function canWatch(profile) {
    return Boolean(profile?.session?.run_id) && ['RUNNING', 'PAUSED', 'RECOVERING'].includes(String(profile.session.status));
  }
  const rules = { scheduleFields, canWatch };
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.WorkspaceFormRules = rules;
})(typeof window === 'object' ? window : globalThis);
