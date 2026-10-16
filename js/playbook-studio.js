/* Shared flow authoring in the sandbox. Data shape mirrors fleet_playbook_v1. */
(function (root) {
  'use strict';
  const contract = root.PlaybookContract;
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const options = (values, selected) => values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value.replaceAll('_', ' '))}</option>`).join('');
  const defaultStep = type => ({
    entry: { type, source: 'youtube_search' }, watch: { type, duration_mode: 'medium' },
    recommendation_chain: { type, depth: [1, 2] }, engagement: { type, actions: ['comment_scroll'] },
    shorts: { type, count: [3, 5] }, browse_home: { type, scroll_depth: [0.2, 0.8] }, cooldown: { type }
  })[type];
  const parseHours = text => String(text || '').split('\n').map(value => value.trim()).filter(Boolean).map(value => value.split(/\s*[-–]\s*/).map(Number));

  function mount(host, personas, config, stats, onChange) {
    const overlays = clone(config.templates || {});
    let selectedPersona = personas[0]?.key || '';
    let selectedSlug = '';
    let editorOpen = false;
    const editingHours = new Set();
    const shipped = key => stats?.[key]?.shipped || personas.find(persona => persona.key === key)?.templates || [];
    const overlay = key => overlays[key] ||= { disabled: [], overrides: {}, additions: [] };
    const all = key => [...shipped(key), ...(overlay(key).additions || [])];
    const active = () => all(selectedPersona).find(template => template.slug === selectedSlug);
    const isAddition = slug => (overlay(selectedPersona).additions || []).some(template => template.slug === slug);
    const effective = template => {
      if (!template) return null;
      const change = overlay(selectedPersona).overrides?.[template.slug] || {};
      return { ...clone(template), flow: clone(change.steps || template.flow), preferred_hours: Object.prototype.hasOwnProperty.call(change, 'hours') ? clone(change.hours) : clone(template.preferred_hours) };
    };
    const mark = () => onChange?.();
    function editor() {
      const base = active();
      if (!base) return '<p class="pod-muted">Choose a flow to edit its steps and preferred hours.</p>';
      const template = effective(base);
      const hoursOverride = overlay(selectedPersona).overrides?.[base.slug];
      const hoursMode = editingHours.has(base.slug) ? 'custom' : isAddition(base.slug) ? (template.preferred_hours ? 'custom' : 'none') : !hoursOverride || !Object.prototype.hasOwnProperty.call(hoursOverride, 'hours') ? 'inherit' : template.preferred_hours ? 'custom' : 'none';
      const stepField = (index, label, field, value, attrs = '') => `<label>${label}<input class="input-field" data-step-index="${index}" data-step-field="${field}" value="${esc(value)}" ${attrs}></label>`;
      const rows = template.flow.map((step, index) => {
        let fields = '';
        if (step.type === 'entry') fields = `<label>Source<select class="input-field" data-step-index="${index}" data-step-field="source">${options(contract.entrySources, step.source)}</select></label>`;
        if (step.type === 'watch') fields = `<label>Duration<select class="input-field" data-step-index="${index}" data-step-field="duration_mode">${options(contract.durations, step.duration_mode)}</select></label>`;
        if (step.type === 'recommendation_chain') fields = stepField(index, 'Min depth', 'depth:0', step.depth?.[0] ?? 1, 'type="number" min="1" max="4"') + stepField(index, 'Max depth', 'depth:1', step.depth?.[1] ?? 2, 'type="number" min="1" max="4"');
        if (step.type === 'shorts') fields = stepField(index, 'Min shorts', 'count:0', step.count?.[0] ?? 3, 'type="number" min="1" max="10"') + stepField(index, 'Max shorts', 'count:1', step.count?.[1] ?? 5, 'type="number" min="1" max="10"');
        if (step.type === 'browse_home') fields = stepField(index, 'Min scroll depth', 'scroll_depth:0', step.scroll_depth?.[0] ?? 0.2, 'type="number" min="0.01" max="1" step="0.01"') + stepField(index, 'Max scroll depth', 'scroll_depth:1', step.scroll_depth?.[1] ?? 0.8, 'type="number" min="0.01" max="1" step="0.01"');
        if (step.type === 'engagement') fields = `<label>Action<select class="input-field" data-step-index="${index}" data-step-field="actions:0">${options(contract.actions, step.actions?.[0])}</select></label>`;
        return `<div class="playbook-step"><div class="playbook-step-top"><strong>${String(index + 1).padStart(2, '0')} · ${esc(step.type.replaceAll('_', ' '))}</strong><div><button class="btn btn-secondary" type="button" data-step-move="${index}:up" ${index === 0 ? 'disabled' : ''} aria-label="Move step up">↑</button><button class="btn btn-secondary" type="button" data-step-move="${index}:down" ${index === template.flow.length - 1 ? 'disabled' : ''} aria-label="Move step down">↓</button><button class="btn btn-secondary" type="button" data-step-remove="${index}" aria-label="Remove step">Remove</button></div></div>${fields ? `<div class="playbook-step-fields">${fields}</div>` : ''}</div>`;
      }).join('');
      return `<div class="playbook-flow-head"><div><strong>${esc(template.name)}</strong><small class="pod-hint">${esc(template.slug)} · ${isAddition(template.slug) ? 'Custom flow' : 'Shipped flow with optional overrides'}</small></div><div class="playbook-editor-actions">${isAddition(template.slug) ? '<button class="btn btn-secondary" type="button" data-flow-remove>Remove custom flow</button>' : '<button class="btn btn-secondary" type="button" data-flow-reset>Reset flow</button>'}<button class="btn btn-secondary" type="button" data-flow-close>Close editor</button></div></div><div class="playbook-steps">${rows}</div><div class="playbook-add-step"><label>Add step<select class="input-field" id="playbook-step-type">${options(contract.stepTypes.filter(type => type !== 'entry'), 'watch')}</select></label><button class="btn btn-secondary" type="button" data-step-add>Add step</button></div><div class="playbook-hours"><label>Preferred local hours<select class="input-field" id="playbook-hours-mode"><option value="inherit" ${hoursMode === 'inherit' ? 'selected' : ''} ${isAddition(base.slug) ? 'disabled' : ''}>Inherit shipped preference</option><option value="none" ${hoursMode === 'none' ? 'selected' : ''}>No preference</option><option value="custom" ${hoursMode === 'custom' ? 'selected' : ''}>Custom windows</option></select></label><label>Windows, one per line (start–end, 24-hour clock)<textarea class="input-field" id="playbook-hours" rows="2" placeholder="9-12" ${hoursMode !== 'custom' ? 'disabled' : ''}>${esc((template.preferred_hours || []).map(pair => pair.join('-')).join('\n'))}</textarea></label></div><div class="playbook-copy-block"><strong>Copy this flow to other personas</strong><p class="pod-hint">Copies the current step list as a new custom flow under each selected persona. Names that already exist there are skipped.</p><div class="playbook-copy-personas">${personas.filter(persona => persona.key !== selectedPersona).map(persona => `<label class="pod-check-inline"><input type="checkbox" data-copy-persona="${esc(persona.key)}"><span>${esc(persona.name)}</span></label>`).join('')}</div><button class="btn btn-secondary" type="button" data-flow-copy>Copy flow</button><div class="pod-effects" id="playbook-copy-note" aria-live="polite"></div></div><div class="pod-effects" id="playbook-flow-errors" aria-live="polite"></div>`;
    }
    function render() {
      if (!selectedSlug || !all(selectedPersona).some(template => template.slug === selectedSlug)) selectedSlug = all(selectedPersona)[0]?.slug || '';
      const rows = all(selectedPersona).map(template => {
        const enabled = !(overlay(selectedPersona).disabled || []).includes(template.slug);
        return `<div class="playbook-template-row"><label class="pod-check-inline"><input type="checkbox" data-flow-enable="${esc(template.slug)}" ${enabled ? 'checked' : ''}><span><strong>${esc(template.name)}</strong><small class="pod-hint">${esc(template.slug)} · ${isAddition(template.slug) ? 'Custom' : 'Shipped'}</small></span></label><button class="btn btn-secondary" type="button" data-flow-select="${esc(template.slug)}" aria-expanded="${editorOpen && selectedSlug === template.slug}" aria-controls="playbook-flow-editor">${editorOpen && selectedSlug === template.slug ? 'Close editor' : 'Edit steps'}</button></div>${editorOpen && selectedSlug === template.slug ? `<div class="playbook-flow-editor" id="playbook-flow-editor">${editor()}</div>` : ''}`;
      }).join('');
      host.innerHTML = `<label class="playbook-persona-select">Persona<select class="input-field" id="playbook-flow-persona">${personas.map(persona => `<option value="${esc(persona.key)}" ${persona.key === selectedPersona ? 'selected' : ''}>${esc(persona.name)}</option>`).join('')}</select></label><div class="playbook-template-list">${rows || '<p class="pod-muted">No flows available.</p>'}</div><div class="playbook-flow-actions"><label>New template name<input class="input-field" id="playbook-add-name" placeholder="Evening Browse"></label><button class="btn btn-secondary" type="button" data-flow-add>Add template</button><button class="btn btn-secondary" type="button" data-persona-reset>Reset persona to shipped</button></div><div class="pod-effects" id="playbook-add-error" aria-live="polite"></div>${editorOpen ? '' : '<div class="playbook-flow-editor" id="playbook-flow-editor" hidden></div>'}`;
    }
    function mutableFlow() {
      const base = active(); if (!base) return null;
      if (isAddition(base.slug)) return base.flow;
      const change = overlay(selectedPersona).overrides[base.slug] ||= {};
      return change.steps ||= clone(base.flow);
    }
    host.addEventListener('change', event => {
      const target = event.target;
      if (target.id === 'playbook-flow-persona') { selectedPersona = target.value; selectedSlug = ''; editorOpen = false; render(); return; }
      if (target.dataset.flowEnable) { const list = overlay(selectedPersona).disabled; const slug = target.dataset.flowEnable; if (target.checked) overlay(selectedPersona).disabled = list.filter(value => value !== slug); else if (!list.includes(slug)) list.push(slug); mark(); return; }
      if (target.id === 'playbook-hours-mode' || target.id === 'playbook-hours') {
        const base = active(); if (!base) return;
        const mode = host.querySelector('#playbook-hours-mode').value;
        if (mode === 'custom') editingHours.add(base.slug); else editingHours.delete(base.slug);
        const hours = mode === 'custom' ? parseHours(host.querySelector('#playbook-hours').value) : [];
        if (isAddition(base.slug)) base.preferred_hours = mode === 'custom' ? hours : null;
        else if (mode === 'inherit') { const row = overlay(selectedPersona).overrides[base.slug]; if (row) { delete row.hours; if (!Object.keys(row).length) delete overlay(selectedPersona).overrides[base.slug]; } }
        else (overlay(selectedPersona).overrides[base.slug] ||= {}).hours = hours;
        mark(); if (target.id === 'playbook-hours-mode') render(); return;
      }
      if (target.dataset.stepField) {
        const step = mutableFlow()?.[Number(target.dataset.stepIndex)]; if (!step) return;
        const [field, position] = target.dataset.stepField.split(':');
        const value = target.type === 'number' ? Number(target.value) : target.value;
        if (position == null) step[field] = value; else step[field][Number(position)] = value;
        mark();
      }
    });
    host.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.flowSelect) { editorOpen = !(editorOpen && selectedSlug === button.dataset.flowSelect); selectedSlug = button.dataset.flowSelect; render(); return; }
      if (button.hasAttribute('data-flow-close')) { editorOpen = false; render(); return; }
      if (button.hasAttribute('data-persona-reset')) { delete overlays[selectedPersona]; selectedSlug = ''; editorOpen = false; mark(); render(); return; }
      if (button.hasAttribute('data-flow-add')) {
        const name = host.querySelector('#playbook-add-name').value.trim();
        const slug = contract.slug(name);
        if (name.length < 2 || name.length > 120 || slug.length < 3 || slug.length > 64) { host.querySelector('#playbook-add-error').textContent = 'Use a name of 2–120 characters that yields a 3–64 character slug.'; return; }
        if (all(selectedPersona).some(item => item.slug === slug)) { host.querySelector('#playbook-add-error').textContent = 'A flow with this name already exists.'; return; }
        const template = { slug, name: name.trim(), persona_key: selectedPersona, flow: [defaultStep('entry'), defaultStep('watch'), defaultStep('cooldown')], preferred_hours: null };
        overlay(selectedPersona).additions.push(template); selectedSlug = slug; editorOpen = true; mark(); render(); return;
      }
      if (button.hasAttribute('data-flow-remove')) { const row = overlay(selectedPersona); row.additions = row.additions.filter(item => item.slug !== selectedSlug); row.disabled = row.disabled.filter(slug => slug !== selectedSlug); selectedSlug = ''; editorOpen = false; mark(); render(); return; }
      if (button.hasAttribute('data-flow-reset')) { delete overlay(selectedPersona).overrides[selectedSlug]; mark(); render(); return; }
      if (button.hasAttribute('data-step-add')) { const type = host.querySelector('#playbook-step-type').value; mutableFlow()?.push(defaultStep(type)); mark(); render(); return; }
      if (button.hasAttribute('data-flow-copy')) {
        const base = active(); if (!base) return;
        const template = effective(base);
        const note = host.querySelector('#playbook-copy-note');
        const targets = [...host.querySelectorAll('[data-copy-persona]:checked')].map(input => input.dataset.copyPersona);
        if (!targets.length) { note.textContent = 'Pick at least one persona to copy to.'; return; }
        let copied = 0; const skipped = [];
        for (const key of targets) {
          if (all(key).some(item => item.slug === template.slug)) { skipped.push(key); continue; }
          const copy = clone(template);
          copy.persona_key = key;
          overlay(key).additions.push(copy);
          copied += 1;
        }
        host.querySelectorAll('[data-copy-persona]').forEach(input => { input.checked = false; });
        mark();
        note.textContent = `Copied to ${copied} persona${copied === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length} where the flow name already exists` : ''}. Save shared playbook to keep it.`;
      }
      if (button.dataset.stepRemove != null) { mutableFlow()?.splice(Number(button.dataset.stepRemove), 1); mark(); render(); return; }
      if (button.dataset.stepMove) { const [raw, direction] = button.dataset.stepMove.split(':'); const flow = mutableFlow(); const index = Number(raw), other = index + (direction === 'up' ? -1 : 1); if (flow && other >= 0 && other < flow.length) [flow[index], flow[other]] = [flow[other], flow[index]]; mark(); render(); }
    });
    render();
    return { draft: () => clone(overlays), validate: () => contract.validate({ ...contract.empty(), templates: overlays }, personas) };
  }
  root.PlaybookStudio = { mount };
})(window);
