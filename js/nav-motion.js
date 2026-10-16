/* Keep the active marker in one layer so it can travel between controls. */
(() => {
  const selectors = [
    ['.workspace-tabs:not(.account-workspace-nav)', 'a[aria-current="page"]', 'line'],
    ['.pod-workspace-nav', 'button.active', 'line'],
    ['.nav-menu', '.nav-item.active', 'pill'],
    ['.operations-subnav', '.operations-subnav-item.active', 'pill'],
    ['#customize-tab .config-subnav-shell > .workspace-tabs', 'a[aria-current="page"]', 'pill'],
  ];
  const tracked = new Map();
  let pending = false;

  function update(nav, options) {
    const selected = nav.querySelector(options.selected);
    if (!selected || !nav.isConnected || !nav.getClientRects().length || !selected.getClientRects().length) {
      nav.classList.remove('nav-motion-ready');
      return;
    }
    const rail = nav.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (!rail.width || !rail.height || !item.width || !item.height) return;
    const x = item.left - rail.left + nav.scrollLeft - nav.clientLeft;
    const y = item.top - rail.top + nav.scrollTop - nav.clientTop;
    const next = [x, y, item.width, item.height];
    if (!options.last || next.some((value, index) => Math.abs(value - options.last[index]) > .5)) {
      options.marker.style.transform = `translate3d(${x}px, ${options.kind === 'pill' ? y : y + item.height - 2}px, 0)`;
      options.marker.style.width = `${item.width}px`;
      options.marker.style.height = options.kind === 'pill' ? `${item.height}px` : '2px';
      options.last = next;
    }
    options.marker.classList.toggle('nav-motion-danger', options.kind === 'pill' && selected.classList.contains('operations-subnav-danger'));
    if (!nav.classList.contains('nav-motion-ready')) {
      requestAnimationFrame(() => {
        if (nav.isConnected && nav.getClientRects().length) nav.classList.add('nav-motion-ready');
      });
    }
  }

  function refresh() {
    pending = false;
    selectors.forEach(([selector, selected, kind]) => {
      document.querySelectorAll(selector).forEach(nav => {
        // The customization rail also has workspace-tabs; it needs a pill, not a line.
        if (kind === 'line' && nav.closest('.config-subnav-shell')) return;
        if (!tracked.has(nav)) {
          const marker = document.createElement('span');
          marker.className = `nav-motion-marker nav-motion-${kind}`;
          marker.setAttribute('aria-hidden', 'true');
          nav.appendChild(marker);
          tracked.set(nav, { selected, kind, marker, last: null });
        }
        update(nav, tracked.get(nav));
      });
    });
    for (const [nav] of tracked) if (!nav.isConnected) tracked.delete(nav);
  }

  function queue() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(refresh);
  }

  // Active classes and aria-current are set by the existing route handlers.
  new MutationObserver(queue).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-current', 'hidden'],
  });
  window.addEventListener('resize', queue, { passive: true });
  window.addEventListener('hashchange', queue);
  queue();
})();
