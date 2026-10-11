export function loadPreviewPreferences(panel) {
  let large = false; let reduced = false;
  try { large = localStorage.getItem('moeazi.monad.prototype.large-text.v1') === 'on'; reduced = localStorage.getItem('moeazi.monad.prototype.reduced-motion.v1') === 'on'; } catch { /* Keep defaults. */ }
  apply(panel, 'large-text', large);
  apply(panel, 'reduced-motion', reduced);
}
export function togglePreviewPreference(panel, name, target) {
  const active = !document.documentElement.classList.contains(name);
  apply(panel, name, active);
  try { localStorage.setItem(`moeazi.monad.prototype.${name}.v1`, active ? 'on' : 'off'); } catch { /* Keep the current session choice. */ }
  update(name, active, target);
}
function apply(panel, name, active) {
  document.documentElement.classList.toggle(name, active);
  const target = panel.querySelector(`[data-action="${name}"]`);
  if (target) update(name, active, target);
}
function update(name, active, target) {
  target.setAttribute(name === 'large-text' ? 'aria-pressed' : 'aria-checked', String(active));
  target.textContent = name === 'large-text' ? `Large text preview · ${active ? 'on' : 'off'}` : `Reduce motion · ${active ? 'on' : 'off'}`;
}
