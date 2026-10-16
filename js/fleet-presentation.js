/* Fleet Monitor presentation rules. Historical failures are never deleted. */
(root => {
  'use strict';

  const timestamp = value => {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
  };

  function OnboardingHours(value) {
    if (value == null || value === '') return '—';
    const hours = Number(value);
    if (!Number.isFinite(hours)) return '—';
    // W3 precision: the bridge supplies full float hours; show thousandths so
    // accrued Onboarding reads exactly (0.001 h = 3.6 s).
    return `${hours.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}h`;
  }

  function errorContext(profile) {
    const error = profile?.last_error;
    if (!error?.message) return { kind: 'none', error: null };
    const errorAt = timestamp(error.timestamp);
    const activity = profile.activity;
    const completedEvent = activity?.event_type === 'run.session_state'
      && /^(?:Session state:\s*|Workflow\s+)COMPLETED\b/i.test(activity.message || '')
      && errorAt != null && timestamp(activity.timestamp) > errorAt;
    const completedRun = String(profile.session?.status || '').toUpperCase() === 'COMPLETED'
      && errorAt != null
      && (timestamp(profile.session.completed_at) > errorAt || timestamp(profile.session.started_at) > errorAt);
    return { kind: completedEvent || completedRun ? 'past' : 'recorded', error };
  }

  function activityContext(profile) {
    const error = errorContext(profile);
    const activity = profile?.activity;
    if (error.kind === 'past' && ['error', 'critical'].includes(activity?.severity)) {
      return { message: 'A later run completed. Earlier error is in profile details.', severity: 'info', timestamp: null };
    }
    return {
      message: activity?.message || 'No recorded activity',
      severity: activity?.severity || 'info',
      timestamp: activity?.timestamp || null,
    };
  }

  const presentation = Object.freeze({ OnboardingHours, errorContext, activityContext });
  if (typeof module === 'object' && module.exports) module.exports = presentation;
  else root.FleetPresentation = presentation;
})(typeof window === 'object' ? window : globalThis);
