export const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const money = value => value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const button = (label, action, variant = '', disabled = false, value = '') =>
  `<button type="button" class="button ${variant}" data-action="${esc(action)}" ${value ? `data-value="${esc(value)}"` : ''} ${disabled ? 'disabled aria-disabled="true"' : ''}>${label}</button>`;
export const link = (label, action, value = '') =>
  `<button type="button" class="button-link" data-action="${esc(action)}" ${value ? `data-value="${esc(value)}"` : ''}>${label}</button>`;
export const tag = (label, color = '') => `<span class="tag ${color}">${esc(label)}</span>`;
export const row = (label, value, className = '') => `<div class="row ${className}"><span>${esc(label)}</span><strong>${value}</strong></div>`;
export const card = (title, body, tint = '') => `<section class="card ${tint}"><h2 class="card-heading">${title}</h2>${body}</section>`;
export const head = (eyebrow, title, copy = '', back = '', className = '') => `<div class="screen-head ${esc(className)}">${back ? `<button type="button" class="inline-link" data-action="back" data-value="${esc(back)}" aria-label="Go back">← Back</button>` : ''}<p class="eyebrow">${esc(eyebrow)}</p><h1 class="screen-title">${title}</h1>${copy ? `<p class="screen-copy">${copy}</p>` : ''}</div>`;
export const field = (label, id, value, type = 'text', more = '') => `<div class="field"><label for="${esc(id)}">${esc(label)}</label><input id="${esc(id)}" name="${esc(id)}" type="${esc(type)}" value="${esc(value)}" ${more}></div>`;
export const explainer = (title, copy, action = '', actionLabel = '') => `<section class="card tint-sky"><h2 class="card-heading">${esc(title)}</h2><p class="card-copy">${copy}</p>${action ? button(actionLabel, action, 'secondary') : ''}</section>`;
export const empty = (icon, title, copy) => `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><h2 class="card-heading">${esc(title)}</h2><p class="card-copy">${esc(copy)}</p></div>`;
export const layout = content => `<div class="screen">${content}</div>`;
export const demoNote = text => `<p class="helper-text">${esc(text)}</p>`;
export const option = (label, value, current) => `<button class="segment" type="button" data-action="segment" data-value="${esc(value)}" aria-pressed="${current === value}">${esc(label)}</button>`;
