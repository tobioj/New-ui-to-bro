/* Browser-preview mirror of src/schemas/behavior.py (behavior_v1).
   Keep this list in backend order; the desktop bridge remains authoritative. */
(function (root, factory) {
  const contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.BehaviorContract = contract;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const number = (section, key, value, min, max) => ({ section, key, default: value, min, max, kind: 'number' });
  const bool = (section, key, value) => ({ section, key, default: value, kind: 'bool' });
  const list = (section, key) => ({ section, key, default: [], kind: 'array' });
  const fields = [
    number('mix', 'entry_search', 1, .25, 3), number('mix', 'entry_home', 1, .25, 3),
    number('mix', 'entry_suggested', 1, .25, 3), number('mix', 'entry_google', 1, .25, 3),
    number('mix', 'entry_external', 1, .25, 3), number('mix', 'variety_penalty', .5, .2, 1),
    number('mix', 'shorts_scale', 1, 0, 1.5), number('mix', 'shorts_cap_pct', 100, 0, 100),
    number('mix', 'comment_scroll_scale', 1, 0, 1.5), number('mix', 'comment_scroll_cap_pct', 100, 0, 100),
    number('mix', 'not_interested_scale', 1, 0, 1.5), number('mix', 'not_interested_cap_pct', 100, 0, 100),
    bool('mix', 'chains_enabled', true), number('mix', 'chains_min', 1, 1, 5),
    number('mix', 'chains_max', 3, 1, 5), number('mix', 'external_pages_min', 2, 1, 6),
    number('mix', 'external_pages_max', 4, 1, 6), bool('mix', 'external_hops', true),

    number('watch', 'watch_scale_short', .7, .5, 1.5), number('watch', 'watch_scale_medium', 1, .5, 1.5),
    number('watch', 'watch_scale_long', 1.3, .5, 1.5), number('watch', 'watch_floor_seconds', 10, 5, 60),
    number('watch', 'chain_floor_seconds', 15, 5, 120), number('watch', 'mid_video_scale', 1, 0, 2),
    number('watch', 'mid_video_cap_pct', 100, 0, 100), number('watch', 'ad_skip_scale', 1, 0, 2),
    number('watch', 'ad_ignore_scale', 1, 0, 2), number('watch', 'fidget_fullscreen_scale', 1, 0, 2),
    number('watch', 'fidget_speed_scale', 1, 0, 2), number('watch', 'fidget_rewind_scale', 1, 0, 2),
    number('watch', 'fidget_density', 1, 0, 2), list('watch', 'fidget_disabled_kinds'),
    number('watch', 'reads_wpm_min', 200, 80, 400), number('watch', 'reads_wpm_max', 250, 80, 400),
    number('watch', 'reads_coverage_min', .3, 0, 1), number('watch', 'reads_coverage_max', .7, 0, 1),
    number('watch', 'reads_dwell_min_seconds', 8, 4, 60), number('watch', 'reads_dwell_max_seconds', 120, 10, 600),
    number('watch', 'shorts_seconds_min', 15, 5, 60), number('watch', 'shorts_seconds_max', 60, 10, 120),

    number('physics', 'typo_rate', .03, 0, .1), number('physics', 'typing_pace', 1, .6, 1.6),
    number('physics', 'trajectory_speed', 1, .7, 1.4), bool('physics', 'overshoot_enabled', true),
    number('physics', 'overshoot_probability', .3, 0, .6), number('physics', 'scroll_notch_min_px', 90, 60, 200),
    number('physics', 'scroll_notch_max_px', 130, 60, 200), number('physics', 'scroll_backtrack_pct', 12, 0, 30),
    number('physics', 'reading_pause_min_s', .3, .05, 5), number('physics', 'reading_pause_max_s', 1.5, .05, 5),
    number('physics', 'hesitation_scale', 1, .5, 1.5),
  ];
  const fidgetKinds = [
    'wander', 'hover_controls', 'comments', 'fullscreen', 'volume_adjust', 'micro_rewind',
    'speed_change', 'progress_hover', 'description_peek', 'related_scroll', 'micro_scroll',
    'drift', 'nothing',
  ];
  const orderedPairs = [
    ['mix', 'chains_min', 'chains_max'], ['mix', 'external_pages_min', 'external_pages_max'],
    ['watch', 'reads_wpm_min', 'reads_wpm_max'], ['watch', 'reads_coverage_min', 'reads_coverage_max'],
    ['watch', 'reads_dwell_min_seconds', 'reads_dwell_max_seconds'],
    ['watch', 'shorts_seconds_min', 'shorts_seconds_max'],
    ['physics', 'scroll_notch_min_px', 'scroll_notch_max_px'],
    ['physics', 'reading_pause_min_s', 'reading_pause_max_s'],
  ];
  const wholeNumbers = new Set(['chains_min', 'chains_max', 'external_pages_min', 'external_pages_max']);
  function defaults() {
    const config = { mix: {}, watch: {}, physics: {}, pods: {}, profiles: {} };
    for (const field of fields) config[field.section][field.key] = Array.isArray(field.default) ? [] : field.default;
    return config;
  }
  function normalize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    for (const section of ['mix', 'watch', 'physics']) {
      if (raw[section] && typeof raw[section] === 'object' && !Array.isArray(raw[section])) {
        base[section] = { ...base[section], ...raw[section] };
      }
    }
    for (const key of ['pods', 'profiles']) {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) base[key] = raw[key];
    }
    return base;
  }
  function effective(globalConfig, row) {
    const config = normalize(globalConfig);
    for (const section of ['mix', 'watch', 'physics']) config[section] = { ...config[section], ...(row?.[section] || {}) };
    return config;
  }
  function validate(config) {
    const errors = [];
    for (const field of fields) {
      const value = config?.[field.section]?.[field.key];
      const path = `${field.section}.${field.key}`;
      if (field.kind === 'number' && (!Number.isFinite(value) || value < field.min || value > field.max || (wholeNumbers.has(field.key) && !Number.isInteger(value)))) {
        errors.push({ field: path, reason: `Use ${wholeNumbers.has(field.key) ? 'a whole number' : 'a number'} from ${field.min} to ${field.max}.` });
      } else if (field.kind === 'bool' && typeof value !== 'boolean') {
        errors.push({ field: path, reason: 'Choose On or Off.' });
      } else if (field.kind === 'array' && (!Array.isArray(value) || value.some(kind => !fidgetKinds.includes(kind)))) {
        errors.push({ field: path, reason: 'Choose only supported fidget kinds.' });
      }
    }
    for (const [section, minKey, maxKey] of orderedPairs) {
      if (config?.[section]?.[minKey] > config?.[section]?.[maxKey]) {
        errors.push({ field: `${section}.${maxKey}`, reason: `Must be at least ${minKey.replaceAll('_', ' ')}.` });
      }
    }
    return errors;
  }
  return { fields, fidgetKinds, defaults, normalize, effective, validate };
});
