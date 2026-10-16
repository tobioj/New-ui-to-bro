// brand.js — single source of product naming and namespaced keys.
// Every storage key, custom event, and window global lives here so a rename is one file.
(() => {
  'use strict';

  const BRAND = {
    // Product identity
    product: 'Workspace Controller',
    shortName: 'Workspace',
    controller: 'Desktop Controller',

    // Storage namespaces
    storagePrefix: 'wc-',
    storage: {
      theme: 'wc-theme',
      navCollapsed: 'wc-nav-collapsed',
      operationsNavCollapsed: 'wc-operations-nav-collapsed',
      configNavCollapsed: 'wc-config-nav-collapsed',
      sandboxBulkProfiles: 'wc-sandbox-bulk-profiles',
      sandboxAuthoredPersonas: 'wc-sandbox-authored-personas',
      sandboxPlaybook: 'wc-sandbox-playbook',
      sandboxBehavior: 'wc-sandbox-behavior',
      sandboxRamp: 'wc-sandbox-ramp',
      sandboxRhythm: 'wc-sandbox-rhythm',
      sandboxTargetGate: 'wc-sandbox-target-gate',
      sandboxResources: 'wc-sandbox-resources',
      sandboxSpend: 'wc-sandbox-spend',
      sandboxSchedules: 'wc-sandbox-schedules-v1',
      sandboxWindowVisibility: 'wc-sandbox-window-visibility-v1',
    },

    // Custom event names
    events: {
      startupMotionComplete: 'wc:startup-motion-complete',
    },

    // Window globals installed by this app
    globals: {
      startupMotion: 'WsStartupMotion',
      motionRegistry: 'WsMotionRegistry',
    },

    // File-naming vocabulary for exports and archives
    files: {
      workspaceArchive: 'workspace',
      profileArchive: 'profiles',
      runReport: 'run-report',
      workspaceExtension: 'workspace',
      profileExtension: 'profiles',
      updateExtension: 'update',
    },
  };

  // Expose on the window without clobbering a host-provided copy.
  window.APP_BRAND = window.APP_BRAND || BRAND;

  // Convenience accessors for modules that only need one value.
  window.brandKey = name => BRAND.storage[name] || (BRAND.storagePrefix + name);
  window.brandEvent = name => BRAND.events[name] || name;
  window.brandGlobal = name => BRAND.globals[name] || name;
})();
