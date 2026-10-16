/* The visual editor remains a projection of the existing ordered `builderSteps`.
   Save, preview, validation, and the backend payload are unchanged. */
(() => {
  const modal = document.getElementById('workflow-builder-modal');
  const fields = document.getElementById('builder-fields');
  const chooser = document.getElementById('builder-kind-chooser');
  const container = document.getElementById('builder-steps-container');
  if (!modal || !fields || !chooser || !container) return;

  let selectedIndex = 0;
  let insertionIndex = null;
  const formRow = fields.querySelector('.form-row-2');
  const nameGroup = formRow?.children[0];
  const concurrencyGroup = formRow?.children[1];
  const descriptionGroup = document.getElementById('builder-desc-input')?.closest('.form-group');
  const allowlists = document.getElementById('builder-allowlist-row');
  const header = fields.querySelector('.builder-steps-header');
  const feedback = document.getElementById('builder-feedback');

  const namebar = document.createElement('div');
  namebar.className = 'workflow-canvas-namebar';
  namebar.innerHTML = '<span>Runs from left to right →</span>';
  if (nameGroup) namebar.prepend(nameGroup);
  const layout = document.createElement('div');
  layout.className = 'workflow-canvas-layout';
  layout.innerHTML = `
    <aside class="wf-palette" aria-label="Available actions">
      <h4 class="wf-pane-label">Actions</h4>
      <p class="wf-pane-hint">Click to add, or drag between steps.</p>
      <div class="wf-palette-list"></div>
    </aside>
    <section class="wf-canvas" aria-label="Workflow sequence">
      <div class="wf-canvas-head"><strong>Execution path</strong><span class="wf-step-count"></span></div>
    </section>
    <aside class="wf-inspector" aria-label="Selected step settings"></aside>`;
  layout.querySelector('.wf-canvas').appendChild(container);
  const settings = document.createElement('details');
  settings.className = 'wf-settings';
  settings.innerHTML = '<summary>Workflow settings · concurrency, description &amp; allowlists</summary>';
  for (const item of [concurrencyGroup, descriptionGroup, allowlists]) if (item) settings.appendChild(item);
  fields.replaceChildren(namebar, layout, settings, feedback);
  if (header) fields.appendChild(header);
  const palette = layout.querySelector('.wf-palette-list');
  const inspector = layout.querySelector('.wf-inspector');
  const count = layout.querySelector('.wf-step-count');

  function labelFor(type) {
    return (BUILDER_STEP_OPTIONS[builderKind] || []).find(([value]) => value === type)?.[1]
      || type.replaceAll('_', ' ');
  }
  function makeStep(type) {
    const config = DEFAULT_STEP_CONFIGS[type] || {};
    return {
      step_order: 0, step_type: type,
      name: config.name || labelFor(type),
      params: JSON.parse(JSON.stringify(config.params || {})),
      is_critical: config.is_critical !== false,
      retry_count: config.retry_count ?? 2,
      timeout_seconds: config.timeout_seconds ?? 30,
    };
  }
  function insert(type, at) {
    if (!builderKind || !(BUILDER_STEP_OPTIONS[builderKind] || []).some(([value]) => value === type)) return;
    const target = Math.max(0, Math.min(Number.isInteger(at) ? at : builderSteps.length, builderSteps.length));
    builderSteps.splice(target, 0, makeStep(type));
    selectedIndex = target;
    insertionIndex = null;
    renderBuilderSteps();
    container.querySelector(`.wf-node[data-index="${target}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function paletteRender() {
    palette.replaceChildren();
    const options = BUILDER_STEP_OPTIONS[builderKind] || [];
    for (const [type, label] of options) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'wf-palette-item';
      button.draggable = true; button.dataset.stepType = type;
      button.innerHTML = `<span class="wf-palette-plus" aria-hidden="true">+</span><span>${escapeHtml(label)}</span>`;
      button.title = `Add ${label}`;
      button.addEventListener('click', () => insert(type, insertionIndex));
      button.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-wc-step', JSON.stringify({ kind: 'new', type }));
      });
      palette.appendChild(button);
    }
    const hint = layout.querySelector('.wf-palette .wf-pane-hint');
    hint.textContent = insertionIndex === null
      ? 'Click to append, or drag between steps.'
      : `Choose an action to insert at position ${insertionIndex + 1}.`;
  }
  function inspectorRender() {
    inspector.replaceChildren();
    const step = builderSteps[selectedIndex];
    if (!step) {
      inspector.innerHTML = '<div class="wf-inspector-empty">Choose a step to edit its settings.</div>';
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'step-card'; wrapper.dataset.index = selectedIndex;
    wrapper.innerHTML = `
      <div class="step-card-header"><div class="step-card-info"><span class="step-order-badge">#${selectedIndex + 1}</span><span class="step-name-title">${escapeHtml(labelFor(step.step_type))}</span></div></div>
      <div class="step-card-body">
        <div class="form-group"><label>Step label</label><input type="text" class="input-field" value="${escapeAttribute(step.name || '')}" data-step-field="name"></div>
        <div class="step-param-grid">${renderStepParamInputs(step, selectedIndex)}</div>
        <div class="step-flags-row">
          <label class="check-row"><input type="checkbox" ${step.is_critical !== false ? 'checked' : ''} data-step-field="critical"><span>Critical · stop on failure</span></label>
          <div><label>Retries</label><input type="number" class="input-field" min="0" max="5" value="${escapeAttribute(step.retry_count ?? 2)}" data-step-field="retry"></div>
          <div><label>Timeout (seconds)</label><input type="number" class="input-field" min="1" max="300" value="${escapeAttribute(step.timeout_seconds ?? 30)}" data-step-field="timeout"></div>
        </div>
      </div>`;
    inspector.appendChild(wrapper);
  }
  function select(index) {
    if (index < 0 || index >= builderSteps.length) return;
    selectedIndex = index;
    container.querySelectorAll('.wf-node').forEach(node => node.classList.toggle('is-selected', Number(node.dataset.index) === index));
    inspectorRender();
  }
  function connector(at) {
    const slot = document.createElement('div');
    slot.className = 'wf-connector'; slot.dataset.insertIndex = at;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '+';
    button.setAttribute('aria-label', `Insert step at position ${at + 1}`);
    button.addEventListener('click', () => {
      insertionIndex = at; paletteRender(); palette.querySelector('button')?.focus();
    });
    slot.appendChild(button);
    slot.addEventListener('dragover', event => { event.preventDefault(); slot.classList.add('is-drop-target'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('is-drop-target'));
    slot.addEventListener('drop', event => {
      event.preventDefault(); slot.classList.remove('is-drop-target');
      try {
        const data = JSON.parse(event.dataTransfer.getData('application/x-wc-step'));
        if (data.kind === 'new') insert(data.type, at);
        else if (data.kind === 'move' && Number.isInteger(data.from) && builderSteps[data.from]) {
          const [step] = builderSteps.splice(data.from, 1);
          const target = at > data.from ? at - 1 : at;
          builderSteps.splice(target, 0, step);
          selectedIndex = target; renderBuilderSteps();
        }
      } catch (_) { /* Ignore unrelated dragged content. */ }
    });
    return slot;
  }

  renderBuilderSteps = function renderWorkflowCanvas() {
    const left = container.scrollLeft;
    container.replaceChildren();
    count.textContent = `${builderSteps.length} ${builderSteps.length === 1 ? 'step' : 'steps'}`;
    if (!builderKind) {
      container.innerHTML = '<div class="wf-empty"><strong>Choose a workflow type</strong><span>Your available actions will appear here.</span></div>';
    } else if (!builderSteps.length) {
      container.innerHTML = '<div class="wf-empty"><strong>Build the execution path</strong><span>Choose an action on the left to begin.</span></div>';
    } else {
      if (selectedIndex >= builderSteps.length) selectedIndex = builderSteps.length - 1;
      for (let index = 0; index <= builderSteps.length; index++) {
        container.appendChild(connector(index));
        if (index === builderSteps.length) break;
        const step = builderSteps[index]; step.step_order = index;
        const node = document.createElement('div');
        node.className = `step-card wf-node${index === selectedIndex ? ' is-selected' : ''}`;
        node.dataset.index = index; node.draggable = true;
        node.innerHTML = `
          <button type="button" class="wf-node-main" data-wf-select="${index}" aria-label="Edit step ${index + 1}: ${escapeAttribute(step.name || labelFor(step.step_type))}">
            <span class="wf-node-type">${String(index + 1).padStart(2, '0')} · ${escapeHtml(labelFor(step.step_type))}</span>
            <span class="wf-node-title">${escapeHtml(step.name || labelFor(step.step_type))}</span>
            <span class="wf-node-meta">${step.is_critical !== false ? 'Critical' : 'Optional'} · ${step.timeout_seconds ?? 30}s timeout</span>
          </button>
          <div class="wf-node-controls">
            <button type="button" data-action="move-step-up" aria-label="Move step left" title="Move left" ${index === 0 ? 'disabled' : ''}>←</button>
            <button type="button" data-action="move-step-down" aria-label="Move step right" title="Move right" ${index === builderSteps.length - 1 ? 'disabled' : ''}>→</button>
            <button type="button" data-action="remove-step" aria-label="Remove step" title="Remove">×</button>
          </div>`;
        node.querySelector('[data-wf-select]').addEventListener('click', () => select(index));
        node.addEventListener('dragstart', event => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-wc-step', JSON.stringify({ kind: 'move', from: index }));
          requestAnimationFrame(() => node.classList.add('is-dragging'));
        });
        node.addEventListener('dragend', () => node.classList.remove('is-dragging'));
        container.appendChild(node);
      }
    }
    container.scrollLeft = left;
    inspectorRender();
  };

  const originalApplyKind = applyBuilderKind;
  applyBuilderKind = function applyCanvasKind(kind) {
    originalApplyKind(kind);
    chooser.style.display = '';
    fields.style.display = '';
    chooser.querySelectorAll('.builder-kind-card').forEach(button => {
      const ownKind = button.id.endsWith('site') ? 'site' : 'youtube';
      button.classList.toggle('is-selected', kind === ownKind);
      button.disabled = builderMode !== 'create';
      button.setAttribute('aria-pressed', String(kind === ownKind));
    });
    paletteRender(); renderBuilderSteps();
  };

  const originalMove = moveBuilderStep;
  moveBuilderStep = function moveCanvasStep(index, delta) {
    if (index >= 0 && index < builderSteps.length && index + delta >= 0 && index + delta < builderSteps.length) selectedIndex = index + delta;
    originalMove(index, delta);
  };
  const originalRemove = removeBuilderStep;
  removeBuilderStep = function removeCanvasStep(index) {
    if (index < selectedIndex) selectedIndex--;
    else if (index === selectedIndex) selectedIndex = Math.max(0, selectedIndex - 1);
    originalRemove(index);
  };
  const originalAdd = addBuilderStep;
  addBuilderStep = function addCanvasStep(type) {
    selectedIndex = builderSteps.length;
    originalAdd(type);
  };

  inspector.addEventListener('input', event => {
    const input = event.target.closest('[data-step-field], [data-step-param]');
    if (!input || !builderSteps[selectedIndex]) return;
    const value = input.type === 'checkbox' ? input.checked : input.value;
    if (input.dataset.stepField === 'name') {
      builderSteps[selectedIndex].name = value;
      const node = container.querySelector(`.wf-node[data-index="${selectedIndex}"]`);
      if (node) node.querySelector('.wf-node-title').textContent = value || labelFor(builderSteps[selectedIndex].step_type);
    } else if (input.dataset.stepField === 'critical') builderSteps[selectedIndex].is_critical = value;
    else if (input.dataset.stepField === 'retry') builderSteps[selectedIndex].retry_count = Number.parseInt(value, 10) || 0;
    else if (input.dataset.stepField === 'timeout') builderSteps[selectedIndex].timeout_seconds = Number.parseFloat(value) || 30;
    else if (input.dataset.stepParam) {
      builderSteps[selectedIndex].params ||= {};
      builderSteps[selectedIndex].params[input.dataset.stepParam] = input.dataset.valueType === 'int' ? Number.parseInt(value, 10)
        : input.dataset.valueType === 'float' ? Number.parseFloat(value) : value;
    }
  });
  inspector.addEventListener('change', event => {
    if (event.target.matches('[data-step-field="critical"]')) renderBuilderSteps();
  });
  paletteRender(); renderBuilderSteps();
})();
