/* A linear editor for local rehearsal tasks. The existing textarea remains the
   source submitted to preview_local_tasks / run_local_tasks. */
(() => {
  const source = document.getElementById('local-tasks-input');
  const group = source?.closest('.form-group');
  if (!source || !group) return;
  const verbs = [
    ['navigate', 'Navigate', 'HTTP(S) URL', 'https://example.com'],
    ['wait', 'Wait', 'Seconds (0–120)', '1'],
    ['scroll', 'Scroll', 'Pixels (−5000 to 5000)', '600'],
    ['click', 'Click', 'CSS selector', 'button.submit'],
    ['screenshot', 'Screenshot', 'Artifact name', 'opening'],
    ['read_title', 'Read title', 'Optional argument', ''],
  ];
  const byVerb = Object.fromEntries(verbs.map(item => [item[0], item]));
  let steps = [];
  let selected = 0;
  let insertAt = null;
  let textMode = false;

  const root = document.createElement('section');
  root.className = 'local-flow';
  root.innerHTML = `
    <div class="local-flow-head"><h4>Task path</h4><button type="button" class="local-flow-toggle" aria-pressed="false">Text editor</button></div>
    <div class="workflow-canvas-layout local-flow-layout">
      <aside class="wf-palette" aria-label="Local task actions"><h5 class="wf-pane-label">Actions</h5><p class="wf-pane-hint">Click to append or drag into the path.</p><div class="wf-palette-list"></div></aside>
      <section class="wf-canvas" aria-label="Local task sequence"><div class="wf-canvas-head"><strong>Execution path</strong><span class="wf-step-count"></span></div><div class="local-flow-track"></div></section>
      <aside class="wf-inspector" aria-label="Selected local task"></aside>
    </div><p class="local-flow-note">Preview validates this path before Run is enabled. Maximum 50 tasks.</p>`;
  group.before(root);
  const toggle = root.querySelector('.local-flow-toggle');
  const palette = root.querySelector('.wf-palette-list');
  const track = root.querySelector('.local-flow-track');
  const inspector = root.querySelector('.wf-inspector');
  const count = root.querySelector('.wf-step-count');

  function parse(text) {
    return text.split(/\r?\n/).map(raw => raw.trim()).filter(Boolean).map(line => {
      const split = line.search(/\s/);
      return { verb: (split < 0 ? line : line.slice(0, split)).toLowerCase(), arg: split < 0 ? '' : line.slice(split).trim() };
    });
  }
  function invalidate() {
    localTasksPreviewValid = false;
    document.getElementById('btn-local-run').disabled = true;
    const preview = document.getElementById('local-task-preview');
    if (preview) preview.style.display = 'none';
  }
  function write() {
    source.value = steps.map(step => `${step.verb}${step.arg ? ` ${step.arg}` : ''}`).join('\n');
    source.dispatchEvent(new Event('input', { bubbles: true }));
    invalidate();
  }
  function setTextMode(value) {
    textMode = value;
    root.classList.toggle('local-flow-text-mode', value);
    group.classList.toggle('local-flow-source-hidden', !value);
    toggle.textContent = value ? 'Flow diagram' : 'Text editor';
    toggle.setAttribute('aria-pressed', String(value));
    if (!value) {
      steps = parse(source.value);
      if (steps.some(step => step.verb.startsWith('#'))) {
        setTextMode(true);
        root.querySelector('.local-flow-note').textContent = 'Comment lines are preserved in the text editor. Remove them to use the diagram.';
        return;
      }
      selected = Math.min(selected, Math.max(0, steps.length - 1)); render();
    }
  }
  function add(verb, at = insertAt) {
    if (!byVerb[verb] || steps.length >= 50) return;
    const index = Math.max(0, Math.min(Number.isInteger(at) ? at : steps.length, steps.length));
    steps.splice(index, 0, { verb, arg: byVerb[verb][3] });
    selected = index; insertAt = null;
    write(); render();
  }
  function slot(at) {
    const element = document.createElement('div');
    element.className = 'wf-connector'; element.dataset.insertIndex = at;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '+';
    button.setAttribute('aria-label', `Insert task at position ${at + 1}`);
    button.addEventListener('click', () => {
      insertAt = at;
      root.querySelector('.wf-pane-hint').textContent = `Choose an action for position ${at + 1}.`;
      palette.querySelector('button')?.focus();
    });
    element.appendChild(button);
    element.addEventListener('dragover', event => { event.preventDefault(); element.classList.add('is-drop-target'); });
    element.addEventListener('dragleave', () => element.classList.remove('is-drop-target'));
    element.addEventListener('drop', event => {
      event.preventDefault(); element.classList.remove('is-drop-target');
      try {
        const data = JSON.parse(event.dataTransfer.getData('application/x-wc-local-task'));
        if (data.kind === 'new') add(data.verb, at);
        else if (data.kind === 'move' && Number.isInteger(data.from) && steps[data.from]) {
          const [step] = steps.splice(data.from, 1);
          selected = at > data.from ? at - 1 : at;
          steps.splice(selected, 0, step);
          write(); render();
        }
      } catch (_) { /* Ignore unrelated dragged content. */ }
    });
    return element;
  }
  function inspectorRender() {
    const step = steps[selected];
    if (!step) { inspector.innerHTML = '<div class="wf-inspector-empty">Choose a task to edit.</div>'; return; }
    const [verb, label, argLabel] = byVerb[step.verb] || [step.verb, 'Unknown task', 'Argument'];
    inspector.innerHTML = `<h5 class="wf-pane-label">Task ${selected + 1} · ${escapeHtml(label)}</h5>
      <p class="wf-pane-hint">Runs in sequence after the previous task.</p>
      <div class="form-group"><label for="local-flow-verb">Action</label><select id="local-flow-verb" class="input-field">${verbs.map(([value, title]) => `<option value="${value}" ${verb === value ? 'selected' : ''}>${escapeHtml(title)}</option>`).join('')}${byVerb[verb] ? '' : `<option value="${escapeAttribute(verb)}" selected>${escapeHtml(verb)} (unsupported)</option>`}</select></div>
      <div class="form-group"><label for="local-flow-arg">${escapeHtml(argLabel)}</label><input id="local-flow-arg" class="input-field" value="${escapeAttribute(step.arg)}" placeholder="${escapeAttribute(byVerb[verb]?.[3] || '')}"></div>`;
    inspector.querySelector('#local-flow-verb').addEventListener('change', event => {
      step.verb = event.target.value;
      step.arg = byVerb[step.verb]?.[3] || '';
      write(); render();
    });
    inspector.querySelector('#local-flow-arg').addEventListener('input', event => {
      step.arg = event.target.value;
      write();
      const titleNode = track.querySelector(`.wf-node[data-index="${selected}"] .wf-node-title`);
      if (titleNode) titleNode.textContent = step.arg || '(no argument)';
    });
  }
  function render() {
    count.textContent = `${steps.length}/50 tasks`;
    track.replaceChildren();
    if (!steps.length) track.innerHTML = '<div class="wf-empty"><strong>Build your lookout path</strong><span>Choose an action to begin.</span></div>';
    else {
      for (let index = 0; index <= steps.length; index++) {
        track.appendChild(slot(index));
        if (index === steps.length) break;
        const step = steps[index];
        const node = document.createElement('div');
        node.className = `step-card wf-node${index === selected ? ' is-selected' : ''}`;
        node.dataset.index = index; node.draggable = true;
        node.innerHTML = `<button type="button" class="wf-node-main" aria-label="Edit task ${index + 1}"><span class="wf-node-type">${String(index + 1).padStart(2, '0')} · ${escapeHtml(byVerb[step.verb]?.[1] || step.verb)}</span><span class="wf-node-title">${escapeHtml(step.arg || '(no argument)')}</span></button>
          <div class="wf-node-controls"><button type="button" data-local-move="-1" aria-label="Move task left" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" data-local-move="1" aria-label="Move task right" ${index === steps.length - 1 ? 'disabled' : ''}>→</button><button type="button" data-local-remove aria-label="Remove task">×</button></div>`;
        node.querySelector('.wf-node-main').addEventListener('click', () => { selected = index; render(); });
        node.querySelectorAll('[data-local-move]').forEach(button => button.addEventListener('click', () => {
          const target = index + Number(button.dataset.localMove);
          [steps[index], steps[target]] = [steps[target], steps[index]];
          selected = target; write(); render();
        }));
        node.querySelector('[data-local-remove]').addEventListener('click', () => {
          steps.splice(index, 1); selected = Math.max(0, Math.min(index, steps.length - 1)); write(); render();
        });
        node.addEventListener('dragstart', event => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-wc-local-task', JSON.stringify({ kind: 'move', from: index }));
        });
        track.appendChild(node);
      }
    }
    inspectorRender();
  }
  for (const [verb, label] of verbs) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'wf-palette-item'; button.draggable = true;
    button.innerHTML = `<span class="wf-palette-plus" aria-hidden="true">+</span><span>${escapeHtml(label)}</span>`;
    button.addEventListener('click', () => add(verb));
    button.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-wc-local-task', JSON.stringify({ kind: 'new', verb }));
    });
    palette.appendChild(button);
  }
  toggle.addEventListener('click', () => setTextMode(!textMode));
  source.addEventListener('input', () => { if (textMode) { steps = parse(source.value); invalidate(); } });
  document.getElementById('local-target-url')?.addEventListener('input', invalidate);
  setTextMode(false);
})();
