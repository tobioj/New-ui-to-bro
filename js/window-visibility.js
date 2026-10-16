/* Windows & Visibility owner settings. Browser previews remain local. */
(() => {
  'use strict';
  const storageKey = 'wc-sandbox-window-visibility-v1';
  const defaults = Object.freeze({ enabled: true, rotation_minutes: 15, max_slots: 12 });
  const $ = id => document.getElementById(id);
  const feedback = $('visibility-feedback');
  const bridge = () => window.desktopBridge?.api;
  const isPreview = () => Boolean(bridge()?.__sandboxPreview);

  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (value && typeof value.enabled === 'boolean') return value;
      if (value && typeof value.managed_windows === 'boolean') return {
        enabled: value.managed_windows,
        rotation_minutes: value.rotation_cadence_minutes,
        max_slots: value.desktop_slots_max
      };
    } catch (_) { /* Missing or invalid browser storage uses preview defaults. */ }
    return defaults;
  }

  function render(value) {
    $('visibility-managed').value = String(value.enabled);
    $('visibility-cadence').value = value.rotation_minutes;
    $('visibility-slots').value = value.max_slots;
    for (const id of ['visibility-cadence', 'visibility-slots']) $(id).setCustomValidity('');
  }

  async function reload() {
    try {
      if (isPreview()) render(readSaved());
      else {
        if (typeof bridge()?.get_visibility !== 'function') throw new Error('Visibility settings are unavailable from this bridge.');
        const result = await bridge().get_visibility();
        if (!result?.success || !result.config) throw new Error(result?.error || 'Could not load visibility settings.');
        render(result.config);
      }
      feedback.textContent = 'Visibility settings loaded. Unsaved edits were discarded.';
      feedback.dataset.state = 'muted';
    } catch (error) { feedback.textContent = error.message; feedback.dataset.state = 'error'; }
  }

  function readInteger(id, label, min, max) {
    const input = $(id);
    const raw = String(input.value).trim();
    const value = Number(raw);
    const valid = /^\d+$/.test(raw) && Number.isSafeInteger(value) && value >= min && value <= max;
    input.setCustomValidity(valid ? '' : `${label} must be a whole number from ${min} to ${max}.`);
    if (!valid) {
      input.reportValidity();
      input.focus();
      return null;
    }
    return value;
  }

  async function save() {
    const cadence = readInteger('visibility-cadence', 'Rotation cadence', 1, 480);
    if (cadence === null) return;
    const slots = readInteger('visibility-slots', 'Desktop slots', 2, 32);
    if (slots === null) return;
    const value = {
      enabled: $('visibility-managed').value === 'true',
      rotation_minutes: cadence,
      max_slots: slots
    };
    try {
      if (isPreview()) {
        localStorage.setItem(storageKey, JSON.stringify(value));
        feedback.textContent = 'Preview settings saved in this browser.';
      } else {
        if (typeof bridge()?.update_visibility !== 'function') throw new Error('Visibility settings are unavailable from this bridge.');
        const result = await bridge().update_visibility(value);
        if (!result?.success) throw new Error(result?.errors?.map(item => `${item.field}: ${item.reason}`).join('; ') || result?.error || 'Could not save visibility settings.');
        render(result.config || value);
        feedback.textContent = 'Visibility settings saved for the desktop app.';
      }
      feedback.dataset.state = 'success';
    } catch (error) {
      feedback.textContent = error.message;
      feedback.dataset.state = 'error';
    }
  }

  if (!$('customize-visibility-card')) return;
  render(defaults);
  $('btn-visibility-save').addEventListener('click', save);
  for (const id of ['visibility-cadence', 'visibility-slots']) {
    $(id).addEventListener('input', () => $(id).setCustomValidity(''));
  }
  window.WindowVisibility = { reload };
})();
