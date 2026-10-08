(function () {
  'use strict';

  const key = 'moeazi.monad.system-design.theme';
  const choices = new Set(['current', 'paper-pop', 'sky-grid', 'lilac-audit']);
  const root = document.documentElement;
  let selected = 'paper-pop';

  try {
    const saved = window.localStorage.getItem(key);
    if (choices.has(saved)) selected = saved;
  } catch (_) {
    // file:// storage can be unavailable; the selector still works in memory.
  }

  // This parser-blocking head script sets the theme before any stylesheet paints.
  root.dataset.theme = selected;

  function applyTheme(value) {
    if (!choices.has(value)) return;
    selected = value;
    root.dataset.theme = selected;
    try {
      window.localStorage.setItem(key, selected);
    } catch (_) {
      // Keep the current selection for this page session if storage is blocked.
    }
    const status = document.getElementById('theme-status');
    if (status) status.textContent = 'Theme set to ' + value.replace('-', ' ') + '.';
  }

  window.MoeaziDesignTheme = { applyTheme, current: () => selected };

  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById('theme-select');
    if (!picker) return;
    picker.value = selected;
    picker.addEventListener('change', () => applyTheme(picker.value));
  });
})();
