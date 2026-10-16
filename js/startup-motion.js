/* Prism 23 — the registered loading motion for the UI sandbox. */
(() => {
  'use strict';

  const overlay = document.getElementById('app-startup-motion');
  const app = document.querySelector('.app-container');
  const activationGate = document.getElementById('license-modal');
  if (!overlay || !app) return;

  const rig = overlay.querySelector('.startup-prism-rig');
  const panes = [...overlay.querySelectorAll('.startup-prism-pane')];
  const mark = overlay.querySelector('.startup-prism-mark');
  const composition = overlay.querySelector('.startup-motion-composition');
  const copy = overlay.querySelector('.startup-motion-copy');
  const progressIndicator = overlay.querySelector('.startup-motion-progress');
  const fill = overlay.querySelector('.startup-motion-progress i');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const HOLD_PROGRESS = .72;
  const INTRO_MS = 3300;
  const RELEASE_MS = 1300;

  const clamp = value => Math.max(0, Math.min(1, value));
  const mix = (from, to, progress) => from + (to - from) * progress;
  const smooth = (from, to, value) => {
    const progress = clamp((value - from) / (to - from));
    return progress * progress * (3 - 2 * progress);
  };
  const out = value => 1 - Math.pow(1 - clamp(value), 3);
  const inOut = value => {
    const progress = clamp(value);
    return progress < .5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  };

  let progress = 0;
  let phase = 'idle';
  let introStartedAt = 0;
  let releaseStartedAt = 0;
  let frame = 0;
  let finishRequested = false;
  let loadProgress = 0;
  let resolveCompletion = null;
  let completion = Promise.resolve();

  function render(value) {
    const release = smooth(.77, .92, value);
    const ready = smooth(.79, .98, value);
    const copyIn = smooth(.55, .70, value);
    const copyOut = smooth(.78, .91, value);
    const markIn = smooth(.47, .67, value);
    const progressIn = smooth(.08, .18, value);
    const progressOut = smooth(.80, .93, value);
    const progressLift = smooth(.12, .62, value);
    const progressStartOffset = Math.min(120, Math.max(96, overlay.clientHeight * .14));
    const compositionOpacity = 1 - smooth(.82, .94, value);
    const overlayOpacity = 1 - smooth(.96, 1, value);
    const spreadX = Math.min(overlay.clientWidth * .31, 292);
    const spreadY = Math.min(overlay.clientHeight * .23, 150);
    const origins = [
      { x: -spreadX, y: -spreadY * .72, z: -92, rx: 18, ry: -71, rz: -8, arc: -34 },
      { x: spreadX * .94, y: spreadY * .42, z: -48, rx: -13, ry: 64, rz: 7, arc: 30 },
      { x: spreadX * .06, y: spreadY * 1.08, z: 38, rx: 56, ry: -24, rz: -4, arc: 42 },
    ];

    overlay.style.opacity = String(clamp(overlayOpacity));
    composition.style.opacity = String(clamp(compositionOpacity));
    composition.style.transform = `translate3d(0, ${(-12 * release).toFixed(2)}px, 0)`;
    rig.style.transform = `rotateY(${mix(-3, 0, smooth(.52, .68, value)).toFixed(2)}deg) scale(${mix(.985, 1, out(smooth(.44, .68, value))).toFixed(4)})`;

    panes.forEach((pane, index) => {
      const origin = origins[index];
      const travel = smooth(.025 + index * .012, .58 + index * .014, value);
      const eased = inOut(travel);
      const arc = Math.sin(Math.PI * travel) * origin.arc;
      const x = mix(origin.x, 0, eased);
      const y = mix(origin.y, 0, eased) + arc;
      const z = mix(origin.z, -24 + index * 12, eased);
      const rx = mix(origin.rx, 0, eased);
      const ry = mix(origin.ry, 0, eased);
      const rz = mix(origin.rz, 0, eased);
      pane.style.opacity = String(clamp(smooth(.015 + index * .012, .14 + index * .018, value) * (1 - smooth(.83, .95, value))));
      pane.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${mix(.88 + index * .025, 1, out(travel)).toFixed(4)})`;
    });

    mark.style.opacity = String(clamp(markIn * (1 - smooth(.83, .94, value))));
    mark.style.transform = `translate3d(0, ${mix(9, 0, out(markIn)).toFixed(2)}px, 22px) rotateY(${mix(18, 0, inOut(markIn)).toFixed(2)}deg) scale(${mix(.72, 1, out(markIn)).toFixed(4)})`;
    copy.style.opacity = String(clamp(copyIn * (1 - copyOut)));
    copy.style.transform = `translateY(${mix(13, -4, out(copyIn)).toFixed(2)}px)`;
    progressIndicator.style.opacity = String(clamp(progressIn * (1 - progressOut)));
    progressIndicator.style.transform = `translateY(${mix(progressStartOffset, 0, inOut(progressLift)).toFixed(2)}px)`;
    document.body.style.setProperty('--startup-workspace-opacity', String(mix(.72, 1, ready)));
    document.body.style.setProperty('--startup-workspace-y', `${mix(18, 0, out(ready)).toFixed(2)}px`);
    document.body.style.setProperty('--startup-workspace-scale', mix(.986, 1, out(ready)).toFixed(4));
  }

  function setLoadProgress(value, label) {
    const next = clamp(Number(value));
    if (!Number.isFinite(next) || next < loadProgress) return loadProgress;
    loadProgress = next;
    fill.style.transform = `scaleX(${loadProgress.toFixed(4)})`;
    progressIndicator.setAttribute('aria-valuenow', String(Math.round(loadProgress * 100)));
    if (typeof label === 'string' && label.trim()) {
      progressIndicator.setAttribute('aria-valuetext', label.trim());
    }
    return loadProgress;
  }

  function resetLoadProgress() {
    loadProgress = 0;
    fill.style.transition = 'none';
    fill.style.transform = 'scaleX(0)';
    progressIndicator.setAttribute('aria-valuenow', '0');
    progressIndicator.setAttribute('aria-valuetext', 'Starting Workspace Controller');
    requestAnimationFrame(() => { fill.style.transition = ''; });
  }

  function complete(cancelled = false) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    phase = 'complete';
    if (!cancelled) render(1);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('startup-motion-running');
    document.body.removeAttribute('aria-busy');
    document.body.style.removeProperty('--startup-workspace-opacity');
    document.body.style.removeProperty('--startup-workspace-y');
    document.body.style.removeProperty('--startup-workspace-scale');
    app.inert = false;
    if (activationGate) activationGate.inert = false;
    if (resolveCompletion) resolveCompletion();
    resolveCompletion = null;
    window.dispatchEvent(new CustomEvent('Workspace Controller:startup-motion-complete', { detail: { id: 'prism-23', cancelled } }));
  }

  function startRelease(now) {
    if (phase === 'release') return;
    phase = 'release';
    releaseStartedAt = now;
    frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = 0;
    if (phase === 'intro') {
      progress = HOLD_PROGRESS * clamp((now - introStartedAt) / INTRO_MS);
      render(progress);
      if (progress >= HOLD_PROGRESS) {
        progress = HOLD_PROGRESS;
        render(progress);
        if (finishRequested) startRelease(now);
        return;
      }
      frame = requestAnimationFrame(tick);
      return;
    }
    if (phase === 'release') {
      const releaseProgress = clamp((now - releaseStartedAt) / RELEASE_MS);
      progress = HOLD_PROGRESS + (1 - HOLD_PROGRESS) * releaseProgress;
      render(progress);
      if (releaseProgress >= 1) complete(false);
      else frame = requestAnimationFrame(tick);
    }
  }

  function prepare() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    overlay.hidden = false;
    overlay.removeAttribute('aria-hidden');
    overlay.style.opacity = '1';
    document.body.classList.add('startup-motion-running');
    document.body.setAttribute('aria-busy', 'true');
    app.inert = true;
    if (activationGate) activationGate.inert = true;
    finishRequested = false;
    resetLoadProgress();
    progress = 0;
    phase = 'prepared';
    render(0);
  }

  function begin({ finish = false } = {}) {
    if (frame) cancelAnimationFrame(frame);
    overlay.hidden = false;
    overlay.removeAttribute('aria-hidden');
    overlay.style.opacity = '1';
    document.body.classList.add('startup-motion-running');
    document.body.setAttribute('aria-busy', 'true');
    app.inert = true;
    if (activationGate) activationGate.inert = true;
    finishRequested = finish;
    progress = 0;
    phase = 'intro';
    completion = new Promise(resolve => { resolveCompletion = resolve; });
    render(reduceMotion.matches ? HOLD_PROGRESS : 0);
    if (reduceMotion.matches) {
      progress = HOLD_PROGRESS;
      phase = 'holding';
      if (finishRequested) startRelease(performance.now() - RELEASE_MS + 240);
    } else {
      introStartedAt = performance.now();
      frame = requestAnimationFrame(tick);
    }
    return completion;
  }

  function finish() {
    finishRequested = true;
    setLoadProgress(1, 'Workspace ready');
    if (phase === 'complete') return Promise.resolve();
    if (phase === 'idle' || phase === 'prepared') return begin({ finish: true });
    if (phase === 'holding' || (phase === 'intro' && progress >= HOLD_PROGRESS)) startRelease(performance.now());
    return completion;
  }

  function cancel() {
    if (phase === 'complete') return;
    complete(true);
  }

  function replay() { return begin({ finish: true }); }

  window.WsMotionRegistry = window.WsMotionRegistry || {};
  window.WsMotionRegistry.loading = {
    id: 'prism-23',
    label: 'Prism 23',
    durationMs: INTRO_MS + RELEASE_MS,
    get progress() { return loadProgress; },
    replay,
  };
  window.WsStartupMotion = { id: 'prism-23', start: begin, finish, cancel, replay, setProgress: setLoadProgress };

  prepare();
})();
