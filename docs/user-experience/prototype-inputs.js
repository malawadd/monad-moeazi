import {esc} from './prototype-helpers.js';

export function amountPresets({id, label, field, value, unit, available, presets, min = 0.01, step = 0.01, hint = ''}) {
  const current = Number(value);
  const knownCap = available !== null && available !== undefined && Number.isFinite(Number(available));
  const cap = knownCap ? Math.max(0, Number(available)) : null;
  const options = presets.filter(item => Number.isFinite(Number(item.value)) && Number(item.value) > 0);
  const matches = options.some(item => Number(item.value) === current);
  const chips = options.map((item, index) => {
    const amount = Number(item.value);
    const disabled = !knownCap || cap < Number(min) || amount < Number(min) || amount > cap + 1e-9;
    const pressed = Number.isFinite(current) && Math.abs(current - amount) < 1e-9;
    return `<button id="${esc(id)}-preset-${index}" type="button" class="amount-chip ${pressed ? 'is-selected' : ''}" data-action="amount-preset" data-field="${esc(field)}" data-value="${amount}" data-available="${knownCap ? esc(cap) : ''}" data-min="${esc(min)}" aria-pressed="${pressed}" ${disabled ? 'disabled aria-disabled="true"' : ''}>${esc(item.label)}</button>`;
  }).join('');
  const inputId = `${id}-custom-input`;
  const shown = Number.isFinite(current) ? current.toLocaleString(undefined, {maximumFractionDigits: 2}) : '—';
  const summary = matches ? 'Enter a custom amount' : `Current: ${shown} ${unit} · edit amount`;
  const hintId = `${id}-hint`;
  return `<section class="amount-choice" aria-label="${esc(label)}">
    <div class="amount-choice-head"><span>${esc(label)}</span><small>Available ${knownCap ? cap.toFixed(2) : '—'} ${esc(unit)}</small></div>
    <div class="amount-chip-row">${chips}</div>
    <details id="${esc(id)}-custom" class="amount-custom" data-preserve-open>
      <summary>${esc(summary)}</summary>
      <div class="amount-custom-field"><label for="${esc(inputId)}">${esc(label)} in ${esc(unit)}</label>
        <input id="${esc(inputId)}" name="${esc(inputId)}" type="number" inputmode="decimal" min="${esc(min)}" ${knownCap ? `max="${esc(cap)}"` : ''} step="${esc(step)}" value="${esc(value)}" data-field="${esc(field)}" ${!knownCap || cap < Number(min) ? `disabled ${hint ? `aria-describedby="${esc(hintId)}"` : ''}` : ''}>
      </div>
    </details>
    ${hint ? `<p id="${esc(hintId)}" class="amount-hint">${esc(hint)}</p>` : ''}
  </section>`;
}

export function leveragePresets(value) {
  return `<div class="leverage-choices" role="group" aria-label="Leverage">
    ${[1, 2, 3].map(item => `<button type="button" class="amount-chip ${Number(value) === item ? 'is-selected' : ''}" data-action="leverage-preset" data-value="${item}" aria-pressed="${Number(value) === item}">${item}×</button>`).join('')}
  </div>`;
}
