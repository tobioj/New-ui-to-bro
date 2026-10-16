/* Canonical policy controls. Window inputs belong to customization_inputs;
   scheduled rhythm, fleet safety and resource admission have separate bridges. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = () => window.desktopBridge?.api;
  const value = id => $(id)?.value;
  const boolean = id => value(id) === 'true';
  const number = (id, min, max, integer = false) => {
    const input = $(id);
    const raw = input?.value?.trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
      throw new Error(`${input?.labels?.[0]?.textContent || id} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
    }
    return parsed;
  };
  const set = (id, raw) => { if ($(id)) $(id).value = String(raw); };
  const errorText = result => (result?.errors || []).map(entry => `${entry.field}: ${entry.reason}`).join(' · ') || result?.error || 'Could not save this policy.';
  const feedback = (id, message) => { if ($(id)) $(id).textContent = message; };

  async function loadRhythm(section = 'all') {
    if (!api()?.get_rhythm) {
      feedback(section === 'safety' ? 'global-safety-feedback' : 'global-rhythm-feedback', 'Rhythm policy is unavailable from this bridge.');
      return;
    }
    try {
      const result = await api().get_rhythm();
      if (!result?.success) throw new Error(errorText(result));
      const config = result.config || {};
      if (section === 'all' || section === 'daily') {
        set('global-rhythm-enabled', Boolean(config.enabled));
        set('global-rhythm-rest-source', config.rest_source ?? 'persona');
        set('global-rhythm-minutes-cap', config.daily_minutes_cap ?? 360);
        set('global-rhythm-daily-sessions', Boolean(config.daily_sessions_cap_enabled));
        set('global-rhythm-rest-start', config.rest_start_hour ?? 23);
        set('global-rhythm-rest-end', config.rest_end_hour ?? 7);
        set('global-rhythm-active-hours', Boolean(config.active_hours_acceptance));
        $('global-rhythm-state').textContent = 'Loaded';
        feedback('global-rhythm-feedback', '');
      }
      if (section === 'all' || section === 'safety') {
        set('global-safety-enabled', Boolean(config.correlation_enabled));
        set('global-safety-cooldown', config.same_target_cooldown_minutes ?? 60);
        set('global-safety-exit-runs', config.exit_alternation_runs ?? 2);
        $('global-safety-state').textContent = 'Loaded';
        feedback('global-safety-feedback', '');
      }
    } catch (error) {
      if (section === 'all' || section === 'daily') feedback('global-rhythm-feedback', error.message);
      if (section === 'all' || section === 'safety') feedback('global-safety-feedback', error.message);
    }
  }

  async function saveRhythm(section) {
    const destination = section === 'safety' ? 'global-safety-feedback' : 'global-rhythm-feedback';
    try {
      if (!api()?.get_rhythm || !api()?.update_rhythm) throw new Error('Rhythm policy is unavailable from this bridge.');
      const snapshot = await api().get_rhythm();
      if (!snapshot?.success) throw new Error(errorText(snapshot));
      const patch = section === 'safety' ? {
        correlation_enabled: boolean('global-safety-enabled'),
        same_target_cooldown_minutes: number('global-safety-cooldown', 0, 1440, true),
        exit_alternation_runs: number('global-safety-exit-runs', 0, 10, true),
      } : {
        enabled: boolean('global-rhythm-enabled'),
        rest_source: value('global-rhythm-rest-source'),
        daily_minutes_cap: number('global-rhythm-minutes-cap', 0, 1440, true),
        daily_sessions_cap_enabled: boolean('global-rhythm-daily-sessions'),
        rest_start_hour: number('global-rhythm-rest-start', 0, 23, true),
        rest_end_hour: number('global-rhythm-rest-end', 0, 23, true),
        active_hours_acceptance: boolean('global-rhythm-active-hours'),
      };
      // Merge against the latest document so pod exceptions and the other
      // global section survive even when edited elsewhere since this load.
      const result = await api().update_rhythm({ ...snapshot.config, ...patch });
      if (!result?.success) throw new Error(errorText(result));
      await loadRhythm(section);
      feedback(destination, section === 'safety' ? 'Fleet safety saved.' : 'Daily rhythm saved.');
    } catch (error) { feedback(destination, error.message); }
  }

  async function loadTargetGate() {
    if (!api()?.get_target_gate) {
      feedback('target-gate-feedback', 'Readiness rules policy is unavailable from this bridge.');
      return;
    }
    try {
      const result = await api().get_target_gate();
      if (!result?.success) throw new Error(errorText(result));
      const config = result.config || {};
      set('target-gate-onboarding-hours', config.min_onboarding_hours ?? 0.1);
      set('target-gate-trust-score', config.min_target_trust_score ?? 0.5);
      set('target-gate-degraded-floor', config.degraded_trust_floor ?? 0.2);
      set('target-gate-challenge-cooldown', config.challenge_cooldown_hours ?? 24);
      set('target-gate-challenge-retire', config.challenge_retire_count ?? 3);
      set('target-gate-challenge-window', config.challenge_retire_window_days ?? 7);
      $('target-gate-state').textContent = 'Loaded';
      feedback('target-gate-feedback', '');
    } catch (error) { feedback('target-gate-feedback', error.message); }
  }

  async function saveTargetGate() {
    try {
      if (!api()?.update_target_gate) throw new Error('Readiness rules policy is unavailable from this bridge.');
      const result = await api().update_target_gate({
        min_onboarding_hours: number('target-gate-onboarding-hours', 0, 1000),
        min_target_trust_score: number('target-gate-trust-score', 0, 1),
        degraded_trust_floor: number('target-gate-degraded-floor', 0, 1),
        challenge_cooldown_hours: number('target-gate-challenge-cooldown', 0, 168, true),
        challenge_retire_count: number('target-gate-challenge-retire', 0, 10, true),
        challenge_retire_window_days: number('target-gate-challenge-window', 1, 30, true),
      });
      if (!result?.success) throw new Error(errorText(result));
      await loadTargetGate();
      feedback('target-gate-feedback', 'Readiness rules saved.');
    } catch (error) { feedback('target-gate-feedback', error.message); }
  }

  async function loadResources() {
    if (!api()?.get_resources) {
      feedback('global-resources-feedback', 'Resource policy is unavailable from this bridge.');
      return;
    }
    try {
      const result = await api().get_resources();
      if (!result?.success) throw new Error(errorText(result));
      const config = result.config || {};
      const stagger = config.admission_stagger || {};
      const ram = config.ram_gate || {};
      set('global-resources-enabled', Boolean(stagger.enabled));
      set('global-resources-gap', stagger.min_gap_seconds ?? 300);
      set('global-resources-jitter', stagger.jitter_seconds ?? 120);
      set('global-resources-cpu', config.cpu_advisory_pct ?? 90);
      set('global-resources-ram-warn', ram.warn_available_pct ?? 15);
      set('global-resources-ram-critical', ram.critical_available_pct ?? 8);
      set('global-resources-factor', ram.safety_factor ?? 1.3);
      set('global-resources-pressure', Boolean(config.quality_under_pressure?.enabled));
      $('global-resources-state').textContent = stagger.enabled ? `Paced · ${stagger.min_gap_seconds}s+` : 'Unpaced';
      feedback('global-resources-feedback', '');
    } catch (error) { feedback('global-resources-feedback', error.message); }
  }

  async function saveResources() {
    try {
      if (!api()?.get_resources || !api()?.update_resources) throw new Error('Resource policy is unavailable from this bridge.');
      const snapshot = await api().get_resources();
      if (!snapshot?.success) throw new Error(errorText(snapshot));
      const current = snapshot.config || {};
      const warn = number('global-resources-ram-warn', 1, 50);
      const critical = number('global-resources-ram-critical', 1, 30);
      if (critical >= warn) throw new Error('RAM critical floor must be below the warn floor.');
      const result = await api().update_resources({
        ...current,
        admission_stagger: {
          ...current.admission_stagger,
          enabled: boolean('global-resources-enabled'),
          min_gap_seconds: number('global-resources-gap', 30, 3600, true),
          jitter_seconds: number('global-resources-jitter', 0, 300, true),
        },
        cpu_advisory_pct: number('global-resources-cpu', 50, 100),
        ram_gate: {
          ...current.ram_gate,
          warn_available_pct: warn,
          critical_available_pct: critical,
          safety_factor: number('global-resources-factor', 1, 3),
        },
        quality_under_pressure: {
          ...current.quality_under_pressure,
          enabled: boolean('global-resources-pressure'),
        },
      });
      if (!result?.success) throw new Error(errorText(result));
      await loadResources();
      feedback('global-resources-feedback', 'Admission and resource policy saved.');
    } catch (error) { feedback('global-resources-feedback', error.message); }
  }

  $('btn-global-rhythm-save')?.addEventListener('click', () => saveRhythm('daily'));
  $('btn-global-safety-save')?.addEventListener('click', () => saveRhythm('safety'));
  $('btn-target-gate-save')?.addEventListener('click', saveTargetGate);
  $('btn-global-resources-save')?.addEventListener('click', saveResources);

  // The main app creates its preview bridge asynchronously. Its customization
  // loader is the stable point at which Profileh real and preview APIs are ready.
  const originalLoad = window.loadCustomizationInputs;
  if (typeof originalLoad === 'function') {
    window.loadCustomizationInputs = async function(...args) {
      const view = args[0] || null;
      const result = await originalLoad(...args);
      if (!view) await Promise.all([loadRhythm(), loadResources(), loadTargetGate()]);
      else if (view === 'rhythm') await loadRhythm('daily');
      else if (view === 'safety') await Promise.all([loadTargetGate(), loadRhythm('safety')]);
      else if (view === 'admission') await loadResources();
      return result;
    };
  }
})();
