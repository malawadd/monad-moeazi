(function () {
  'use strict';
  const data = window.SYSTEM_DESIGN;
  const byId = id => document.getElementById(id);
  const escapeHtml = value =>
    String(value).replace(
      /[&<>"']/g,
      char =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[char]),
    );
  const component = id => data.components.find(item => item.id === id);
  const layer = id => data.layers.find(item => item.id === id);
  let enabledLayers = new Set(data.layers.map(item => item.id));
  let activeFlow = null;
  let stepIndex = 0;

  function statusMarkup(status) {
    const info = data.statuses[status];
    return '<span class="status-mark status-' + escapeHtml(status) + '" title="' + escapeHtml(info.note) + '">' + escapeHtml(info.label) + '</span>';
  }

  function renderLayerFilters() {
    byId('layer-filters').innerHTML = data.layers.map(item => '<label class="layer-option"><input type="checkbox" value="' + item.id + '" checked><span>' + escapeHtml(item.name.replace(/^\d+ · /, '')) + '</span></label>').join('');
    byId('layer-filters').addEventListener('change', event => {
      if (!event.target.matches('input[type=checkbox]')) return;
      if (event.target.checked) enabledLayers.add(event.target.value);
      else enabledLayers.delete(event.target.value);
      renderMap();
    });
  }

  function renderMap() {
    byId('layers').innerHTML = data.layers
      .map(group => {
        const cards = data.components
          .filter(item => item.layer === group.id)
          .map(item => '<button class="component-card" type="button" data-component="' + item.id + '" aria-pressed="false" aria-label="Inspect ' + escapeHtml(item.name) + ', status ' + escapeHtml(data.statuses[item.status].label) + '"><span class="component-title">' + escapeHtml(item.name) + '</span><span class="component-kind">' + escapeHtml(item.kind) + '</span>' + statusMarkup(item.status) + '</button>')
          .join('');
        return '<section class="layer-row" data-layer="' + group.id + '" aria-label="' + escapeHtml(group.name) + '"><div class="layer-heading"><strong>' + escapeHtml(group.name) + '</strong><span>' + escapeHtml(group.hint) + '</span></div><div class="component-list">' + cards + '</div></section>';
      })
      .join('');
    byId('connections').innerHTML = data.edges
      .map(edge => {
        const from = component(edge.from);
        const to = component(edge.to);
        return '<button type="button" class="edge-card" data-edge="' + edge.id + '" aria-label="Inspect connection: ' + escapeHtml(from.name) + ' to ' + escapeHtml(to.name) + ', ' + escapeHtml(edge.label) + '"><span class="edge-from">' + escapeHtml(from.name) + '</span><span class="edge-arrow" aria-hidden="true">→</span><span class="edge-to">' + escapeHtml(to.name) + '</span><span class="edge-label">' + escapeHtml(edge.label) + ' · ' + escapeHtml(data.statuses[edge.status].label) + '</span></button>';
      })
      .join('');
    updateLayerVisibility();
    applySearch();
    updateFlow();
  }

  function updateLayerVisibility() {
    document.querySelectorAll('.layer-row').forEach(row => {
      row.hidden = !enabledLayers.has(row.dataset.layer);
    });
    document.querySelectorAll('.edge-card').forEach(button => {
      const edge = data.edges.find(item => item.id === button.dataset.edge);
      button.hidden = !enabledLayers.has(component(edge.from).layer) || !enabledLayers.has(component(edge.to).layer);
    });
    document.querySelectorAll('#layer-filters input').forEach(input => {
      input.checked = enabledLayers.has(input.value);
    });
  }

  function onMapClick(event) {
    const card = event.target.closest('[data-component]');
    const edge = event.target.closest('[data-edge]');
    if (card) showComponent(card.dataset.component);
    if (edge) showEdge(edge.dataset.edge);
  }

  function sourceLinks(sources) {
    if (!sources || !sources.length) return '';
    return '<div class="source-links">' + sources.map(item => '<a href="' + escapeHtml(item[1]) + '">' + escapeHtml(item[0]) + ' ↗</a>').join('') + '</div>';
  }

  function showComponent(id) {
    const item = component(id);
    document.querySelectorAll('.component-card').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.component === id));
    });
    byId('detail-content').innerHTML = '<div class="detail-meta">' + statusMarkup(item.status) + '<span class="tech-tag">' + escapeHtml(layer(item.layer).name.replace(/^\d+ · /, '')) + '</span></div><h3 id="detail-title">' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.detail) + '</p><div class="tech-tags">' + item.tech.map(tag => '<span class="tech-tag">' + escapeHtml(tag) + '</span>').join('') + '</div>' + sourceLinks(item.sources);
  }

  function showEdge(id) {
    const item = data.edges.find(edge => edge.id === id);
    const from = component(item.from);
    const to = component(item.to);
    document.querySelectorAll('.component-card').forEach(button => button.setAttribute('aria-pressed', 'false'));
    byId('detail-content').innerHTML = '<div class="detail-meta">' + statusMarkup(item.status) + '</div><h3 id="detail-title">' + escapeHtml(from.name) + ' <span aria-hidden="true">→</span> ' + escapeHtml(to.name) + '</h3><p>' + escapeHtml(item.detail) + '</p><div class="tech-tags"><span class="tech-tag">' + escapeHtml(item.label) + '</span></div>' + sourceLinks(from.sources.concat(to.sources).slice(0, 3));
  }

  function renderFlows() {
    byId('flow-select').insertAdjacentHTML('beforeend', data.flows.map(flow => '<option value="' + flow.id + '">' + escapeHtml(flow.title) + '</option>').join(''));
    byId('flow-select').addEventListener('change', event => {
      activeFlow = data.flows.find(item => item.id === event.target.value) || null;
      stepIndex = 0;
      byId('flow-panel').hidden = !activeFlow;
      updateFlow();
    });
    byId('step-prev').addEventListener('click', () => moveStep(-1));
    byId('step-next').addEventListener('click', () => moveStep(1));
  }

  function moveStep(delta) {
    if (!activeFlow) return;
    stepIndex = Math.max(0, Math.min(activeFlow.steps.length - 1, stepIndex + delta));
    updateFlow();
  }

  function updateFlow() {
    document.querySelectorAll('.component-card').forEach(button => button.classList.remove('flow-node', 'current-node'));
    document.querySelectorAll('.edge-card').forEach(button => button.classList.remove('edge-active'));
    if (!activeFlow) return;
    const step = activeFlow.steps[stepIndex];
    byId('flow-title').textContent = activeFlow.title;
    byId('flow-summary').textContent = activeFlow.summary;
    byId('step-number').textContent = 'STEP ' + String(stepIndex + 1).padStart(2, '0') + ' / ' + String(activeFlow.steps.length).padStart(2, '0');
    byId('step-name').textContent = step.name;
    byId('step-description').textContent = step.description;
    byId('step-prev').disabled = stepIndex === 0;
    byId('step-next').disabled = stepIndex === activeFlow.steps.length - 1;
    activeFlow.steps.forEach(flowStep =>
      flowStep.nodes.forEach(id => {
        const button = document.querySelector('[data-component="' + id + '"]');
        if (button) button.classList.add('flow-node');
      }),
    );
    step.nodes.forEach(id => {
      const button = document.querySelector('[data-component="' + id + '"]');
      if (button) button.classList.add('current-node');
    });
    step.edges.forEach(id => {
      const button = document.querySelector('[data-edge="' + id + '"]');
      if (button) button.classList.add('edge-active');
    });
    byId('step-list').innerHTML = activeFlow.steps.map((item, index) => '<button class="step-dot" type="button" data-step="' + index + '" aria-current="' + (index === stepIndex ? 'step' : 'false') + '">' + String(index + 1).padStart(2, '0') + ' · ' + escapeHtml(item.name) + '</button>').join('');
    byId('step-list').onclick = event => {
      const button = event.target.closest('[data-step]');
      if (button) {
        stepIndex = Number(button.dataset.step);
        updateFlow();
      }
    };
  }

  function applySearch() {
    const query = byId('search').value.trim().toLowerCase();
    let matches = 0;
    document.querySelectorAll('.component-card').forEach(button => {
      const item = component(button.dataset.component);
      const haystack = [item.name, item.kind, item.summary, item.detail, item.tech.join(' '), layer(item.layer).name].join(' ').toLowerCase();
      const match = !query || haystack.includes(query);
      button.classList.toggle('search-muted', !match);
      if (match && enabledLayers.has(item.layer)) matches += 1;
    });
    byId('search-feedback').textContent = query ? matches + ' matching component' + (matches === 1 ? '' : 's') + ' · unmatched nodes dimmed' : 'Showing all components';
  }

  function renderLegend() {
    byId('legend-items').innerHTML = Object.entries(data.statuses)
      .map(([key, value]) => '<span class="legend-item">' + statusMarkup(key) + '</span>')
      .join('');
  }

  function renderMobile() {
    byId('mobile-structure').innerHTML = data.mobile.map(item => '<article class="mobile-card"><div class="eyebrow">' + escapeHtml(item.type) + '</div><h3>' + escapeHtml(item.name) + '</h3><span class="card-type">' + data.statuses[item.status].label + '</span><ul>' + item.items.map(line => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul><a href="' + escapeHtml(item.href) + '">Open ' + escapeHtml(item.source) + ' ↗</a></article>').join('');
  }

  function renderInventory() {
    byId('inventory').innerHTML = data.inventory.map(group => '<section class="inventory-group"><h3>' + escapeHtml(group.title) + '</h3><ul>' + group.items.map(item => '<li><strong>' + escapeHtml(item[0]) + '</strong>' + escapeHtml(item[1]) + '</li>').join('') + '</ul></section>').join('');
    byId('port-rows').innerHTML = data.ports.map(row => '<tr><td>' + escapeHtml(row[0]) + '</td><td><code>' + escapeHtml(row[1]) + '</code></td><td><code>' + escapeHtml(row[2]) + '</code></td><td>' + escapeHtml(row[3]) + '</td></tr>').join('');
    byId('ml-points').innerHTML = data.mlPoints.map(point => '<article class="ml-point"><h4>' + escapeHtml(point.name) + ' · Proposed</h4><p>' + escapeHtml(point.detail) + '</p><a href="' + escapeHtml(point.href) + '">Source: ' + escapeHtml(point.source) + ' ↗</a></article>').join('');
  }

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll('[role=tab]'));
    tabs.forEach((tab, index) => tab.addEventListener('click', () => activateTab(tab)));
    document.querySelector('[role=tablist]').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      activateTab(tabs[next]);
    });
  }

  function activateTab(tab) {
    document.querySelectorAll('[role=tab]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
    document.querySelectorAll('[role=tabpanel]').forEach(panel => {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    });
  }

  renderLayerFilters();
  renderMap();
  byId('layers').addEventListener('click', onMapClick);
  byId('connections').addEventListener('click', onMapClick);
  renderFlows();
  renderLegend();
  renderMobile();
  renderInventory();
  setupTabs();
  byId('search').addEventListener('input', applySearch);
  byId('zoom').addEventListener('input', event => {
    const value = Number(event.target.value);
    byId('map-inner').style.zoom = String(value);
    byId('zoom-value').value = Math.round(value * 100) + '%';
  });
  byId('reset').addEventListener('click', () => {
    byId('search').value = '';
    byId('zoom').value = '1';
    byId('map-inner').style.zoom = '1';
    byId('zoom-value').value = '100%';
    enabledLayers = new Set(data.layers.map(item => item.id));
    activeFlow = null;
    stepIndex = 0;
    byId('flow-select').value = '';
    byId('flow-panel').hidden = true;
    document.querySelectorAll('[data-component]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    byId('detail-content').innerHTML = '<h3 id="detail-title">Start with a component</h3><p>Choose any map node to see its role, status, key connections, and source files.</p>';
    updateLayerVisibility();
    applySearch();
    updateFlow();
  });
})();
