/* Browser-local mirror of the fleet_playbook_v1 save and resolution rules.
   The desktop bridge remains authoritative when this UI runs outside preview. */
(function (root, factory) {
  const contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.PlaybookContract = contract;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const stepTypes = ['entry', 'watch', 'recommendation_chain', 'engagement', 'shorts', 'browse_home', 'cooldown'];
  const entrySources = ['youtube_search', 'youtube_home', 'google_search', 'suggested_video', 'external_link'];
  const durations = ['short', 'medium', 'long'];
  const actions = ['comment_scroll', 'not_interested'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const unique = values => [...new Map((values || []).map(value => String(value).trim()).filter(Boolean).map(value => [value.toLowerCase(), value])).values()];
  const empty = () => ({ version: 1, verticals: {}, queries: {}, templates: {}, pods: {}, profiles: {} });
  const normalize = raw => ({ ...empty(), ...(raw || {}), verticals: { ...(raw?.verticals || {}) }, queries: { ...(raw?.queries || {}) }, templates: { ...(raw?.templates || {}) }, pods: { ...(raw?.pods || {}) }, profiles: { ...(raw?.profiles || {}) } });
  const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const issue = (field, reason) => ({ field, reason });
  const inRange = (value, low, high, integer = false) => Number.isFinite(value) && value >= low && value <= high && (!integer || Number.isInteger(value));

  function starterTemplates(key, label = key) {
    const templates = [
      ['morning_check', 'Morning check', [{ type: 'entry', source: 'youtube_home' }, { type: 'watch', duration_mode: 'short' }, { type: 'cooldown' }]],
      ['deep_dive', 'Deep dive', [{ type: 'entry', source: 'youtube_search' }, { type: 'watch', duration_mode: 'long' }, { type: 'recommendation_chain', depth: [1, 3] }, { type: 'cooldown' }]],
      ['external_read', 'External read', [{ type: 'entry', source: 'external_link' }, { type: 'watch', duration_mode: 'medium' }, { type: 'cooldown' }]],
    ];
    return templates.map(([suffix, name, flow]) => ({ slug: `${key}_${suffix}`, name: `${String(label).slice(0, 60)} · ${name}`, persona_key: key, flow, preferred_hours: null }));
  }

  function effectiveVerticals(document, podId = '', profileId = '') {
    const config = normalize(document);
    return { ...(config.profiles[profileId]?.verticals && Object.keys(config.profiles[profileId].verticals).length ? config.profiles[profileId].verticals
      : config.pods[podId]?.verticals && Object.keys(config.pods[podId].verticals).length ? config.pods[podId].verticals : config.verticals) };
  }

  function effectiveQueries(key, document, shipped, podId = '', profileId = '') {
    const config = normalize(document);
    const overlay = config.queries[key] || {};
    const removed = new Set((overlay.remove || []).map(value => String(value).trim().toLowerCase()));
    return unique([...(shipped || []).filter(value => !removed.has(String(value).toLowerCase())), ...(overlay.add || []), ...((config.pods[podId]?.query_extra || {})[key] || []), ...((config.profiles[profileId]?.query_extra || {})[key] || [])]);
  }

  function effectiveTemplates(key, document, shipped) {
    const overlay = normalize(document).templates[key] || {};
    const disabled = new Set(overlay.disabled || []);
    return [...(shipped || []).map(base => {
      const override = overlay.overrides?.[base.slug] || {};
      return { ...clone(base), flow: override.steps ? clone(override.steps) : clone(base.flow), preferred_hours: Object.prototype.hasOwnProperty.call(override, 'hours') ? (override.hours.length ? clone(override.hours) : null) : clone(base.preferred_hours) };
    }), ...(overlay.additions || []).map(clone)].filter(template => !disabled.has(template.slug));
  }

  function validateFlow(template, field) {
    const errors = [];
    if (!/^[a-z0-9_]{3,64}$/.test(template.slug || '')) errors.push(issue(`${field}.slug`, 'Use a lowercase slug of 3–64 letters, numbers, or underscores.'));
    if (String(template.name || '').length < 2 || String(template.name || '').length > 120) errors.push(issue(`${field}.name`, 'Use a name of 2–120 characters.'));
    const flow = template.flow || [];
    if (flow.length < 3 || flow.length > 12) errors.push(issue(`${field}.flow`, 'Use 3–12 steps.'));
    if (flow[0]?.type !== 'entry' || flow.filter(step => step.type === 'entry').length !== 1) errors.push(issue(`${field}.flow`, 'Start with exactly one entry step.'));
    if (!flow.some(step => step.type === 'watch')) errors.push(issue(`${field}.flow`, 'Include at least one watch step.'));
    flow.forEach((step, index) => {
      const prefix = `${field}.flow.${index}`;
      if (!stepTypes.includes(step.type)) errors.push(issue(prefix, 'Unknown step type.'));
      if (step.type === 'entry' && !entrySources.includes(step.source)) errors.push(issue(prefix, 'Choose a supported entry source.'));
      if (step.type === 'watch' && !durations.includes(step.duration_mode || 'medium')) errors.push(issue(prefix, 'Choose short, medium, or long.'));
      if (step.type === 'recommendation_chain' && !(Array.isArray(step.depth) && step.depth.length === 2 && inRange(step.depth[0], 1, 4, true) && inRange(step.depth[1], step.depth[0], 4, true))) errors.push(issue(prefix, 'Chain depth must be 1–4, minimum ≤ maximum.'));
      if (step.type === 'shorts' && !(Array.isArray(step.count) && step.count.length === 2 && inRange(step.count[0], 1, 10, true) && inRange(step.count[1], step.count[0], 10, true))) errors.push(issue(prefix, 'Shorts count must be 1–10, minimum ≤ maximum.'));
      if (step.type === 'shorts' && index < flow.length - 1 && !['cooldown', 'browse_home'].includes(flow[index + 1].type)) errors.push(issue(prefix, 'Follow shorts with cooldown or home browsing.'));
      if (step.type === 'browse_home' && !(Array.isArray(step.scroll_depth) && step.scroll_depth.length === 2 && inRange(step.scroll_depth[0], Number.EPSILON, 1) && inRange(step.scroll_depth[1], step.scroll_depth[0], 1))) errors.push(issue(prefix, 'Browse depth must be above 0 through 1, minimum ≤ maximum.'));
      if (step.type === 'engagement' && !(Array.isArray(step.actions) && step.actions.length && step.actions.every(action => actions.includes(action)))) errors.push(issue(prefix, 'Choose a supported engagement action.'));
    });
    if (template.preferred_hours != null) validateHours(template.preferred_hours, `${field}.preferred_hours`, errors, false);
    return errors;
  }

  function validateHours(hours, field, errors, allowEmpty) {
    if (!Array.isArray(hours) || hours.length > 4 || (!allowEmpty && !hours.length) || hours.some(pair => !Array.isArray(pair) || pair.length !== 2 || !inRange(pair[0], 0, 23, true) || !inRange(pair[1], pair[0] + 1, 24, true))) {
      errors.push(issue(field, allowEmpty ? 'Use no preference or 1–4 valid hour windows.' : 'Use 1–4 valid hour windows.'));
    }
  }

  function validate(document, catalog = []) {
    const config = normalize(document);
    const errors = [];
    const people = new Map(catalog.map(persona => [persona.key, persona]));
    const weights = (value, field) => {
      if (Object.keys(value || {}).length > 64) errors.push(issue(field, 'Use at most 64 personas.'));
      if (Object.keys(value || {}).length && !Object.values(value).some(weight => inRange(weight, 0, 100) && weight > 0)) errors.push(issue(field, 'At least one weight must be positive.'));
      for (const [key, weight] of Object.entries(value || {})) {
        if (!people.has(key)) errors.push(issue(field, `Unknown persona ${key}.`));
        if (!inRange(weight, 0, 100)) errors.push(issue(`${field}.${key}`, 'Use a weight from 0 to 100.'));
      }
    };
    weights(config.verticals, 'verticals');
    for (const bucket of ['pods', 'profiles']) for (const [id, row] of Object.entries(config[bucket])) {
      weights(row?.verticals, `${bucket}.${id}.verticals`);
      for (const [key, extras] of Object.entries(row?.query_extra || {})) {
        if (!people.has(key)) errors.push(issue(`${bucket}.${id}.query_extra`, `Unknown persona ${key}.`));
        if (!Array.isArray(extras) || unique(extras).length > 100) errors.push(issue(`${bucket}.${id}.query_extra.${key}`, 'Use at most 100 extra queries.'));
      }
      const warm = row?.Onboarding || {};
      for (const [key, low, high] of [['sessions_per_day',1,12],['session_minutes_min',5,60],['session_minutes_max',5,120],['min_gap_minutes',0,720]]) if (warm[key] != null && !inRange(warm[key],low,high,true)) errors.push(issue(`${bucket}.${id}.Onboarding.${key}`, `Use ${low}–${high}.`));
      if (warm.session_minutes_min != null && warm.session_minutes_max != null && warm.session_minutes_min > warm.session_minutes_max) errors.push(issue(`${bucket}.${id}.Onboarding`, 'Minimum minutes cannot exceed maximum.'));
    }
    if (Object.keys(config.queries).length > 64) errors.push(issue('queries', 'Use at most 64 query overlays.'));
    for (const [key, overlay] of Object.entries(config.queries)) {
      const person = people.get(key);
      if (!person) { errors.push(issue(`queries.${key}`, `Unknown persona ${key}.`)); continue; }
      if ((overlay.add || []).length > 200 || (overlay.remove || []).length > 300) errors.push(issue(`queries.${key}`, 'Use at most 200 additions and 300 removals.'));
      if (effectiveQueries(key, config, person.search_queries || []).length < 50) errors.push(issue(`queries.${key}`, 'At least 50 unique effective queries must remain.'));
    }
    if (Object.keys(config.templates).length > 64) errors.push(issue('templates', 'Use at most 64 persona overlays.'));
    for (const [key, overlay] of Object.entries(config.templates)) {
      const person = people.get(key);
      if (!person) { errors.push(issue(`templates.${key}`, `Unknown persona ${key}.`)); continue; }
      const shipped = person.templates || [];
      const additions = overlay.additions || [];
      const overrides = overlay.overrides || {};
      const all = [...shipped, ...additions];
      const slugs = new Set();
      if (additions.length > 6 || Object.keys(overrides).length > 12 || (overlay.disabled || []).length > 24) errors.push(issue(`templates.${key}`, 'Template overlay exceeds backend limits.'));
      for (const template of all) {
        if (slugs.has(template.slug)) errors.push(issue(`templates.${key}`, `Duplicate template slug ${template.slug}.`));
        slugs.add(template.slug);
      }
      for (const template of additions) {
        if (template.persona_key !== key) errors.push(issue(`templates.${key}.additions`, 'Template persona must match the selected persona.'));
        errors.push(...validateFlow(template, `templates.${key}.additions.${template.slug || 'new'}`));
      }
      for (const disabled of overlay.disabled || []) if (!slugs.has(disabled)) errors.push(issue(`templates.${key}.disabled`, `Unknown template ${disabled}.`));
      for (const [slug, override] of Object.entries(overrides)) {
        const base = all.find(template => template.slug === slug);
        if (!base) { errors.push(issue(`templates.${key}.overrides`, `Unknown template ${slug}.`)); continue; }
        if (!Object.prototype.hasOwnProperty.call(override, 'steps') && !Object.prototype.hasOwnProperty.call(override, 'hours')) errors.push(issue(`templates.${key}.overrides.${slug}`, 'Choose steps or preferred hours to override.'));
        if (Object.prototype.hasOwnProperty.call(override, 'hours')) validateHours(override.hours, `templates.${key}.overrides.${slug}.hours`, errors, true);
        errors.push(...validateFlow({ ...base, flow: override.steps || base.flow }, `templates.${key}.overrides.${slug}`));
      }
      if (!effectiveTemplates(key, config, shipped).length) errors.push(issue(`templates.${key}`, 'Keep at least one enabled template.'));
    }
    return errors;
  }

  function validateNewVertical(payload, catalog = []) {
    const key = slug(payload.name).slice(0, 40);
    const errors = [];
    if (String(payload.name || '').trim().length < 2 || String(payload.name || '').trim().length > 64 || key.length < 3) errors.push(issue('name', 'Use a name of 2–64 characters that yields a key with at least 3 letters or digits.'));
    if (catalog.some(persona => persona.key === key)) errors.push(issue('name', 'That vertical already exists.'));
    if (String(payload.description || '').trim().length < 5 || String(payload.description || '').trim().length > 256) errors.push(issue('description', 'Use a description of 5–256 characters.'));
    if (!(payload.categories || []).length) errors.push(issue('categories', 'Add a YouTube category.'));
    if (!(payload.websites || []).length) errors.push(issue('websites', 'Add a preferred website.'));
    if (unique(payload.queries).length < 50) errors.push(issue('queries', 'Add at least 50 unique search queries.'));
    return { key, errors };
  }

  return { stepTypes, entrySources, durations, actions, empty, normalize, unique, slug, starterTemplates, effectiveVerticals, effectiveQueries, effectiveTemplates, validateFlow, validate, validateNewVertical };
});
