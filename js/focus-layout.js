/* Presentation-only density and contextual help. Existing form/route nodes remain intact. */
(() => {
  const title = document.getElementById('view-title');
  if (!title) return;
  const row = document.createElement('div');
  row.className = 'topbar-title-row';
  title.parentNode.insertBefore(row, title);
  row.appendChild(title);

  const popover = document.createElement('div');
  popover.id = 'page-info-popover';
  popover.className = 'page-info-popover';
  popover.hidden = true;
  popover.setAttribute('role', 'tooltip');
  document.body.appendChild(popover);
  let activeButton = null;
  let hideTimer = 0;

  function activeDescription() {
    const pane = document.querySelector('.tab-pane.active');
    return pane?.querySelector(':scope > .action-bar .action-bar-copy p')?.textContent.trim()
      || (pane?.id === 'system-tab' ? pane.querySelector(':scope > .card .card-description')?.textContent.trim() : '')
      || '';
  }
  function hide() {
    clearTimeout(hideTimer);
    if (activeButton) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = null;
    popover.hidden = true;
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 130); }
  function show(button) {
    clearTimeout(hideTimer);
    const description = button._infoText?.() || '';
    if (!description) return;
    if (activeButton && activeButton !== button) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = button;
    button.setAttribute('aria-expanded', 'true');
    popover.textContent = description;
    popover.hidden = false;
    const rect = button.getBoundingClientRect();
    const edge = 12;
    const gap = 10;
    const preferredWidth = Math.min(360, window.innerWidth - edge * 2);
    const rightRoom = window.innerWidth - rect.right - gap - edge;
    const leftRoom = rect.left - gap - edge;
    const toRight = rightRoom >= Math.min(preferredWidth, 240) || rightRoom >= leftRoom;
    const room = toRight ? rightRoom : leftRoom;
    const width = Math.min(preferredWidth, Math.max(120, room));
    popover.style.width = `${width}px`;
    const desiredLeft = toRight ? rect.right + gap : rect.left - gap - width;
    const left = Math.max(edge, Math.min(desiredLeft, window.innerWidth - width - edge));
    const height = popover.offsetHeight;
    const top = Math.max(edge, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - edge));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }
  function infoButton(source, label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = 'i';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-controls', popover.id);
    button.setAttribute('aria-expanded', 'false');
    button._infoText = source;
    button.addEventListener('pointerenter', () => show(button));
    button.addEventListener('pointerleave', scheduleHide);
    button.addEventListener('focus', () => show(button));
    button.addEventListener('blur', scheduleHide);
    button.addEventListener('click', event => {
      event.stopPropagation();
      show(button);
    });
    return button;
  }
  const pageInfo = infoButton(activeDescription, 'About this page', 'page-info-button');
  row.appendChild(pageInfo);
  popover.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  popover.addEventListener('pointerleave', scheduleHide);
  document.addEventListener('pointerdown', event => {
    if (activeButton && !activeButton.contains(event.target) && !popover.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('hashchange', () => { hide(); requestAnimationFrame(sync); });
  window.addEventListener('resize', hide);
  document.querySelector('.content-scroll')?.addEventListener('scroll', hide, true);

  // Keep the original controls (and their event handlers) while placing them
  // beside the navigation or filters they operate on. A schedule render may
  // replace its tab strip, so retain each control node across that redraw.
  const pageActions = new Map([...document.querySelectorAll('.tab-pane > .action-bar')]
    .map(bar => [bar.parentElement.id, bar.querySelector('.action-bar-controls')])
    .filter(([, controls]) => controls));
  function dockBeside(paneId, selector) {
    const pane = document.getElementById(paneId);
    const anchor = pane?.querySelector(selector);
    const controls = pageActions.get(paneId);
    if (!anchor || !controls) return;
    let row = anchor.parentElement.classList.contains('page-utility-row') ? anchor.parentElement : null;
    if (!row) {
      row = document.createElement('div');
      row.className = 'page-utility-row';
      anchor.before(row);
      row.appendChild(anchor);
    }
    if (controls.parentElement !== row) row.appendChild(controls);
  }
  function dockInside(paneId, selector) {
    const pane = document.getElementById(paneId);
    const anchor = pane?.querySelector(selector);
    const controls = pageActions.get(paneId);
    if (!anchor || !controls || controls.parentElement === anchor) return;
    anchor.classList.add('has-page-actions');
    anchor.insertBefore(controls, anchor.querySelector('.workspace-count'));
  }
  function dockInContent(paneId, selector) {
    const pane = document.getElementById(paneId);
    const content = pane?.querySelector(selector);
    const controls = pageActions.get(paneId);
    if (!content || !controls) return;
    let row = content.querySelector(':scope > .page-utility-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'page-utility-row page-utility-row-content';
      content.prepend(row);
    }
    if (controls.parentElement !== row) row.appendChild(controls);
  }
  function dockBefore(paneId, selector) {
    const pane = document.getElementById(paneId);
    const anchor = pane?.querySelector(selector);
    const controls = pageActions.get(paneId);
    if (!anchor || !controls) return;
    let row = pane.querySelector(':scope > .page-utility-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'page-utility-row page-utility-row-solo';
      anchor.before(row);
    }
    if (controls.parentElement !== row) row.appendChild(controls);
  }
  function rehomeActions() {
    dockBeside('pods-tab', '#pod-list-container');
    dockBeside('accounts-tab', '.account-workspace-nav');
    dockBeside('workflows-tab', ':scope > .workspace-tabs');
    dockBeside('task-schedules-tab', '#task-schedule-workspace > .workspace-tabs');
    dockBeside('deploy-tab', ':scope > .workspace-tabs');
    dockBeside('manual-tab', ':scope > .workspace-tabs');
    dockInside('reports-tab', '.report-filter-head');
    const reportHead = document.querySelector('#reports-tab .report-filter-head');
    const reportFeedback = document.getElementById('report-feedback');
    if (reportHead && reportFeedback && reportFeedback.previousElementSibling !== reportHead) {
      reportHead.after(reportFeedback);
    }
    dockInside('monitor-tab', '.workspace-fleet-podbar');
    dockInside('alerts-tab', '.workspace-toolbar');
    dockInside('console-tab', '.workspace-toolbar');
    dockInContent('operations-tab', '.operations-content');
    dockInContent('customize-tab', '.config-workspace-shell');
    dockInside('proxies-tab', '.workspace-table-filter');
    const status = document.getElementById('operations-feedback');
    const operationsControls = pageActions.get('operations-tab');
    if (status && operationsControls && status.parentNode !== operationsControls) operationsControls.prepend(status);
  }

  function attachInline(root, headingSelector, copySelector, label) {
    const heading = root.querySelector(headingSelector);
    const copy = root.querySelector(copySelector);
    if (!heading || !copy || heading.parentNode.querySelector(':scope > .inline-info-button')) return;
    copy.classList.add('info-collapsed');
    const button = infoButton(() => copy.textContent.trim(), label, 'inline-info-button');
    heading.after(button);
  }
  function sync() {
    const pane = document.querySelector('.tab-pane.active');
    pageInfo.hidden = !activeDescription();
    rehomeActions();
    document.querySelectorAll('.tab-pane > .action-bar').forEach(bar => {
      const controls = bar.querySelector('.action-bar-controls');
      bar.classList.toggle('no-page-actions', !controls || !controls.querySelector('button, select, a, input, .operations-status-chip'));
    });
    document.querySelectorAll('.pod-overview-intro').forEach(root =>
      attachInline(root, 'h4', 'p', 'About this pod overview'));
    document.querySelectorAll('.pod-panel-heading').forEach(root =>
      attachInline(root, 'h4', ':scope > div > p', 'About this section'));
    document.querySelectorAll('.operations-view:not([data-operations-panel="privacy"]) .card').forEach(root =>
      attachInline(root, '.card-heading h3', ':scope > .card-description', 'About this section'));
    const visibilityCard = document.getElementById('customize-visibility-card');
    if (visibilityCard) attachInline(visibilityCard, '.card-heading h3', ':scope > .card-description', 'About Windows & Visibility');
    const tierPanel = document.getElementById('view-configure-customization-safeguards-tiers');
    if (tierPanel) attachInline(tierPanel, 'h4', ':scope > .form-hint', 'About tiers and prices');
    document.querySelector('#system-tab > .card .card-description')?.classList.add('info-collapsed');
    if (pane && activeButton && !pane.contains(activeButton) && activeButton !== pageInfo) hide();
  }
  const watched = document.querySelector('.content-scroll');
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  }).observe(watched, { childList: true, subtree: true });
  sync();
})();
