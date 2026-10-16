/* Mission Control shell. The existing app.js remains the bridge and action owner. */
(() => {
  const groups = [
    { label: 'Operate', tabs: ['pods-tab', 'accounts-tab', 'workflows-tab', 'task-schedules-tab', 'deploy-tab', 'manual-tab', 'site-traffic-tab'] },
    { label: 'Monitor', tabs: ['monitor-tab', 'alerts-tab', 'console-tab', 'reports-tab'] },
    { label: 'Configure', tabs: ['customize-tab', 'proxies-tab'] },
    { label: 'System', tabs: ['operations-tab', 'system-tab'] },
  ];
  const navNames = {
    'deploy-tab': 'Deployments',
    'manual-tab': 'Manual Tasks',
    'monitor-tab': 'Fleet Monitor',
  };
  const nav = document.querySelector('.nav-menu');
  const items = new Map([...nav.querySelectorAll('.nav-item')].map(item => [item.dataset.tab, item]));

  nav.replaceChildren();
  groups.forEach(group => {
    const section = document.createElement('div');
    section.className = 'mission-nav-group';
    const heading = document.createElement('span');
    heading.className = 'nav-label';
    heading.textContent = group.label;
    section.appendChild(heading);
    group.tabs.forEach(tabId => {
      const item = items.get(tabId);
      if (!item) return;
      const label = navNames[tabId] || item.textContent.trim();
      const svg = item.querySelector('svg');
      const icon = document.createElement('span');
      icon.className = 'nav-icon';
      if (svg) icon.appendChild(svg);
      const copy = document.createElement('span');
      copy.className = 'nav-copy';
      copy.textContent = label;
      item.replaceChildren(icon, copy);
      item.title = label;
      section.appendChild(item);
    });
    nav.appendChild(section);
  });

  const themeButton = document.getElementById('theme-toggle');
  const sidebarButton = document.getElementById('sidebar-toggle');
  const mobileButton = document.getElementById('mobile-nav-toggle');
  const scrim = document.getElementById('sidebar-scrim');
  const root = document.documentElement;

  function readPreference(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Optional in locked-down webviews. */ }
  }
  function setTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = selected;
    const next = selected === 'dark' ? 'light' : 'dark';
    themeButton.setAttribute('aria-label', `Switch to ${next} mode`);
    themeButton.title = `Switch to ${next} mode`;
    savePreference('Workspace Controller-mission-theme', selected);
  }
  function setCollapsed(collapsed, persist = true) {
    document.body.classList.toggle('nav-collapsed', collapsed);
    const verb = collapsed ? 'Expand' : 'Collapse';
    sidebarButton.setAttribute('aria-label', `${verb} navigation`);
    sidebarButton.title = `${verb} navigation`;
    sidebarButton.setAttribute('aria-expanded', String(!collapsed));
    if (persist) savePreference('Workspace Controller-mission-nav-collapsed', String(collapsed));
  }
  function setMobileOpen(open) {
    document.body.classList.toggle('mobile-nav-open', open);
    mobileButton.setAttribute('aria-expanded', String(open));
    mobileButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }

  setTheme(readPreference('Workspace Controller-mission-theme') || 'dark');
  setCollapsed(readPreference('Workspace Controller-mission-nav-collapsed') === 'true');
  let operationsMode = false;
  let priorPrimaryCollapsed = false;
  function syncOperationsNavigation() {
    const active = document.body.classList.contains('operations-active');
    if (active === operationsMode) return;
    if (active) {
      priorPrimaryCollapsed = document.body.classList.contains('nav-collapsed');
      operationsMode = true;
      setCollapsed(true, false);
    } else {
      operationsMode = false;
      setCollapsed(priorPrimaryCollapsed, false);
    }
  }
  const operationsObserver = new MutationObserver(syncOperationsNavigation);
  operationsObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncOperationsNavigation();
  themeButton.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
  sidebarButton.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(false);
    else setCollapsed(!document.body.classList.contains('nav-collapsed'), !operationsMode);
  });
  mobileButton.addEventListener('click', () => setMobileOpen(!document.body.classList.contains('mobile-nav-open')));
  scrim.addEventListener('click', () => setMobileOpen(false));
  nav.addEventListener('click', event => {
    if (event.target.closest('.nav-item')) setMobileOpen(false);
  });

  const liveDrawer = document.getElementById('live-session-drawer');
  const dragHandle = liveDrawer?.querySelector('.drawer-heading');
  let dragStart = null;
  const mobileLayout = () => window.matchMedia('(max-width: 760px)').matches;
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(value, upper));
  function placeDrawer(left, top) {
    const width = liveDrawer.offsetWidth;
    const height = liveDrawer.offsetHeight;
    liveDrawer.style.right = 'auto';
    liveDrawer.style.Profiletom = 'auto';
    liveDrawer.style.left = `${clamp(left, 8, Math.max(8, innerWidth - width - 8))}px`;
    liveDrawer.style.top = `${clamp(top, 8, Math.max(8, innerHeight - height - 8))}px`;
  }
  if (dragHandle) {
    dragHandle.addEventListener('pointerdown', event => {
      if (mobileLayout() || event.button !== 0 || event.target.closest('button')) return;
      const rect = liveDrawer.getBoundingClientRect();
      dragStart = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      placeDrawer(rect.left, rect.top);
      dragHandle.classList.add('is-dragging');
      dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    dragHandle.addEventListener('pointermove', event => {
      if (!dragStart) return;
      placeDrawer(dragStart.left + event.clientX - dragStart.x, dragStart.top + event.clientY - dragStart.y);
    });
    const endDrag = () => { dragStart = null; dragHandle.classList.remove('is-dragging'); };
    dragHandle.addEventListener('pointerup', endDrag);
    dragHandle.addEventListener('pointercancel', endDrag);
    dragHandle.addEventListener('keydown', event => {
      if (mobileLayout() || event.target !== dragHandle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const rect = liveDrawer.getBoundingClientRect();
      const step = event.shiftKey ? 48 : 16;
      const x = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const y = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      placeDrawer(rect.left + x, rect.top + y);
      event.preventDefault();
    });
    window.addEventListener('resize', () => {
      if (!mobileLayout() && liveDrawer.style.left && liveDrawer.style.display !== 'none') {
        const rect = liveDrawer.getBoundingClientRect();
        placeDrawer(rect.left, rect.top);
      }
    });
  }

  const details = new Map();
  const popover = document.createElement('aside');
  popover.className = 'mission-info-popover';
  popover.id = 'mission-info-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Details preview');
  popover.setAttribute('aria-modal', 'false');
  popover.hidden = true;
  document.body.appendChild(popover);
  let activeButton = null;
  let closeTimer = null;

  function escapeText(value) {
    const span = document.createElement('span');
    span.textContent = value == null || value === '' ? '—' : String(value);
    return span.innerHTML;
  }
  function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function positionPopover(button) {
    const rect = button.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left - width + rect.width, window.innerWidth - width - 12));
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    const below = rect.Profiletom + 10;
    popover.style.top = `${below + popover.offsetHeight <= window.innerHeight - 12 ? below : Math.max(12, rect.top - popover.offsetHeight - 10)}px`;
  }
  function openInfo(button) {
    const record = details.get(button.dataset.mcInfo);
    if (!record) return;
    clearTimeout(closeTimer);
    if (activeButton && activeButton !== button) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = button;
    button.setAttribute('aria-expanded', 'true');
    popover.innerHTML = `<button class="mission-info-close" type="button" aria-label="Close details">×</button><div class="mission-info-title">${escapeText(record.title)}</div>`
      + (record.subtitle ? `<p>${escapeText(record.subtitle)}</p>` : '')
      + `<dl>${(record.rows || []).map(([label, value]) => `<dt>${escapeText(label)}</dt><dd>${escapeText(value)}</dd>`).join('')}</dl>`
      + (record.note ? `<div class="mission-info-note">${escapeText(record.note)}</div>` : '');
    popover.hidden = false;
    positionPopover(button);
  }
  function closeInfo() {
    clearTimeout(closeTimer);
    popover.hidden = true;
    if (activeButton) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = null;
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeInfo, 180);
  }
  document.addEventListener('pointerover', event => {
    const button = event.target.closest('[data-mc-info]');
    if (button) openInfo(button);
  });
  document.addEventListener('pointerout', event => {
    if (event.target.closest('[data-mc-info]')) scheduleClose();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest('[data-mc-info]');
    if (button) openInfo(button);
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest('[data-mc-info]')) scheduleClose();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.mission-info-close')) { closeInfo(); return; }
    const button = event.target.closest('[data-mc-info]');
    if (button) {
      event.stopPropagation();
      openInfo(button);
    } else if (!event.target.closest('.mission-info-popover')) closeInfo();
  });
  popover.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  popover.addEventListener('pointerleave', scheduleClose);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeInfo(); setMobileOpen(false); }
  });
  window.addEventListener('resize', closeInfo);

  const moreFilters = document.getElementById('report-more-filters');
  const advancedFields = document.getElementById('report-advanced-fields');
  function updateFilterLabel() {
    const count = [...advancedFields.querySelectorAll('input, select')].filter(input => input.value).length;
    const verb = advancedFields.classList.contains('open') ? 'Fewer filters' : 'More filters';
    moreFilters.textContent = count ? `${verb} · ${count} active` : verb;
  }
  moreFilters?.addEventListener('click', () => {
    const expanded = advancedFields.classList.toggle('open');
    moreFilters.setAttribute('aria-expanded', String(expanded));
    updateFilterLabel();
  });
  advancedFields?.addEventListener('input', updateFilterLabel);
  advancedFields?.addEventListener('change', updateFilterLabel);

  // Rows are rendered by app.js after bridge responses arrive. Keep their mobile
  // labels paired with the actual table headers, including later refreshes.
  let labelFrame = 0;
  function labelTableCells() {
    labelFrame = 0;
    document.querySelectorAll('.data-table').forEach(table => {
      const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row => {
        [...row.cells].forEach((cell, index) => {
          if (cell.colSpan === 1) cell.dataset.label = labels[index] || '';
        });
      });
    });
  }
  const labelObserver = new MutationObserver(() => {
    if (!labelFrame) labelFrame = requestAnimationFrame(labelTableCells);
  });
  document.querySelectorAll('.data-table tbody').forEach(body => {
    labelObserver.observe(body, { childList: true, subtree: true });
  });
  labelTableCells();

  // Keep complete identifiers in the data cells; desktop readers can widen a
  // column directly, while compact layouts show the full value in stacked rows.
  let tableFrame = 0;
  function prepareResizableTables() {
    tableFrame = 0;
    if (window.matchMedia('(max-width: 760px)').matches) return;
    document.querySelectorAll('.data-table:not(.mc-resizable), .workspace-table:not(.mc-resizable)').forEach(table => {
      const headers = [...(table.tHead?.rows[0]?.cells || [])];
      if (headers.length < 2 || table.getBoundingClientRect().width < 80 || headers[0].getBoundingClientRect().width < 20) return;
      const widths = headers.map(header => Math.max((header.textContent.trim() || 'Actions') === 'Actions' ? 136 : 80, Math.ceil(header.getBoundingClientRect().width)));
      // Rounding every measured column can leave a narrow, unnecessary
      // scrollbar beneath many tables. Preserve genuine horizontal overflow.
      let excess = widths.reduce((total, width) => total + width, 0) - table.parentElement.clientWidth;
      if (excess > 0 && excess <= 24) {
        for (const index of [...widths.keys()].sort((a, b) => widths[b] - widths[a])) {
          const reduction = Math.min(excess, widths[index] - 80);
          widths[index] -= reduction;
          excess -= reduction;
          if (!excess) break;
        }
      }
      const initialWidths = [...widths];
      const columns = document.createElement('colgroup');
      const columnElements = widths.map(width => {
        const column = document.createElement('col');
        column.style.width = `${width}px`;
        columns.appendChild(column);
        return column;
      });
      table.insertBefore(columns, table.firstChild);
      const applyWidth = (index, requested) => {
        widths[index] = Math.max(80, Math.min(900, Math.round(requested)));
        columnElements[index].style.width = `${widths[index]}px`;
        table.style.setProperty('--mc-table-width', `${widths.reduce((total, width) => total + width, 0)}px`);
      };
      table.style.setProperty('--mc-table-width', `${widths.reduce((total, width) => total + width, 0)}px`);
      headers.forEach((header, index) => {
        const label = header.textContent.trim() || 'Actions';
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'table-resize-handle';
        handle.setAttribute('aria-label', `Resize ${label} column. Drag or use arrow keys.`);
        handle.title = `Drag to resize ${label} column`;
        let start = null;
        handle.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          start = { x: event.clientX, width: widths[index] };
          handle.classList.add('is-resizing');
          handle.setPointerCapture(event.pointerId);
          event.preventDefault();
          event.stopPropagation();
        });
        handle.addEventListener('pointermove', event => {
          if (start) applyWidth(index, start.width + event.clientX - start.x);
        });
        const end = () => { start = null; handle.classList.remove('is-resizing'); };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        handle.addEventListener('keydown', event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          applyWidth(index, widths[index] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 64 : 24));
          event.preventDefault();
        });
        handle.addEventListener('dblclick', () => applyWidth(index, initialWidths[index]));
        header.appendChild(handle);
      });
      table.classList.add('mc-resizable');
    });
  }
  const scheduleTablePreparation = () => {
    if (!tableFrame) tableFrame = requestAnimationFrame(prepareResizableTables);
  };
  const resizeObserver = new MutationObserver(scheduleTablePreparation);
  resizeObserver.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('.tab-pane, .modal-backdrop, .profile-section, .operations-view').forEach(element => {
    resizeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
  });
  window.addEventListener('resize', scheduleTablePreparation);
  scheduleTablePreparation();

  const operationsButtons = [...document.querySelectorAll('[data-operations-view]')];
  const operationsPanels = [...document.querySelectorAll('[data-operations-panel]')];
  const operationsIcons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
    storage: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 11h18M7 15h.01M11 15h.01"/>',
    updates: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
    schedules: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h3m-3 3h5"/>',
    maintenance: '<path d="M14 7a5 5 0 0 0-7 7l-4 4a2 2 0 0 0 3 3l4-4a5 5 0 0 0 7-7l-4 4-3-3 4-4z"/>',
    backups: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
    privacy: '<path d="M4 7h16m-12 0 1 14h6l1-14M9 7V4h6v3m-4 4v6m3-6v6"/>',
  };
  operationsButtons.forEach(button => {
    const label = button.lastElementChild?.textContent.trim() || button.dataset.operationsView;
    button.lastElementChild?.classList.add('operations-subnav-label');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.insertAdjacentHTML('afterbegin', `<svg class="operations-subnav-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${operationsIcons[button.dataset.operationsView]}</svg>`);
  });
  const operationsToggle = document.getElementById('operations-subnav-toggle');
  function setOperationsRailCollapsed(collapsed) {
    document.body.classList.toggle('operations-subnav-collapsed', collapsed);
    const label = collapsed ? 'Expand Operations navigation' : 'Collapse Operations navigation';
    operationsToggle.setAttribute('aria-label', label);
    operationsToggle.setAttribute('aria-expanded', String(!collapsed));
    operationsToggle.title = label;
    savePreference('Workspace Controller-operations-nav-collapsed', String(collapsed));
  }
  setOperationsRailCollapsed(readPreference('Workspace Controller-operations-nav-collapsed') === 'true');
  operationsToggle.addEventListener('click', () => setOperationsRailCollapsed(!document.body.classList.contains('operations-subnav-collapsed')));
  const operationsViewNames = new Set(operationsButtons.map(button => button.dataset.operationsView));
  function setOperationsView(requested) {
    const view = operationsViewNames.has(requested) ? requested : 'overview';
    operationsButtons.forEach(button => {
      const active = button.dataset.operationsView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    operationsPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.operationsPanel === view));
    return view;
  }
  document.querySelector('.operations-subnav')?.addEventListener('click', event => {
    const button = event.target.closest('[data-operations-view]');
    if (!button) return;
    const view = button.dataset.operationsView;
    const nextHash = `#/system/operations/${view}`;
    if (location.hash === nextHash) {
      setOperationsView(view);
      document.querySelector('.content-scroll').scrollTop = 0;
    } else {
      location.hash = nextHash;
    }
  });
  setOperationsView('overview');

  window.MissionControl = {
    setDetails(key, record) { details.set(String(key), record); },
    eyeButton(key, label = 'View details') {
      return `<button class="mission-eye" type="button" data-mc-info="${escapeAttribute(key)}" aria-label="${escapeAttribute(label)}" aria-expanded="false" aria-controls="mission-info-popover" title="${escapeAttribute(label)}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg></button>`;
    },
    closeInfo,
    setMobileOpen,
    setOperationsView,
  };
})();
