(function () {
  'use strict';
  const research = window.MOEAZI_RESEARCH;
  const root = document.getElementById('research-explorer');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sourceLinks = sources => (sources || []).map(source => '<a href="' + esc(source[1]) + '">' + esc(source[0]) + ' ↗</a>').join('');
  const block = (label, value) => '<div class="research-field"><dt>' + esc(label) + '</dt><dd>' + esc(value || 'Evidence not recorded') + '</dd></div>';

  function graphMarkup(graph) {
    if (!graph) return '<p class="evidence-gap">Graph evidence not recorded yet.</p>';
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const nodeByRef = new Map(nodes.flatMap(node => [[node.id, node], [node.label, node]]));
    const findNode = ref => nodeByRef.get(ref);
    const componentCard = (node, index) => '<article class="graph-node"><span class="graph-step">NODE ' + String(index + 1).padStart(2, '0') + '</span><strong>' + esc(node.label) + '</strong><p>' + esc(node.detail) + '</p><div class="research-sources">' + sourceLinks(node.sources) + '</div></article>';
    const paths = edges.map(edge => ({ from: findNode(edge.from), to: findNode(edge.to), label: edge.label }));
    const invalid = paths.some(edge => !edge.from || !edge.to);
    return '<figure class="research-graph ' + (graph.title.includes('Moeazi') ? 'graph-proposed' : 'graph-upstream') + '"><figcaption><strong>' + esc(graph.title) + '</strong><span>' + esc(graph.summary) + '</span></figcaption>' +
      '<div class="graph-diagram" role="group" aria-label="Directed component graph; each row is a source-linked relationship">' + paths.map((edge, index) => edge.from && edge.to ? '<div class="graph-path">' + componentCard(edge.from, nodes.indexOf(edge.from)) + '<div class="graph-link"><span aria-hidden="true">→</span><strong>' + esc(edge.label) + '</strong></div>' + componentCard(edge.to, nodes.indexOf(edge.to)) + '</div>' : '').join('') + '</div>' +
      (invalid ? '<p class="evidence-gap">Graph validation failed: an edge endpoint does not match a source node.</p>' : '') +
      '<p class="graph-note">' + (graph.title.includes('Moeazi') ? 'Proposed Moeazi bridge; dashed arrows mark work to build.' : 'Upstream structure summarized from the pinned source revision; solid arrows represent inspected component relationships.') + '</p></figure>';
  }

  function renderMethod() {
    return '<section class="research-method" aria-labelledby="research-method-title"><div class="eyebrow">RESEARCH METHOD</div><h2 id="research-method-title">How the comparison was made</h2><p>Each candidate was inspected at a pinned upstream commit. The comparison evaluates repository fit and operational cost; it does not claim trading performance. Recommendation and runner-up are architectural judgments that can change after a reproducible pilot.</p><div class="method-grid"><article><h3>Same six criteria</h3><p>Data correctness and replay, integration effort, operating footprint, relevant capability, maintenance evidence, and license.</p></article><article><h3>Evidence boundaries</h3><p>Upstream benchmark claims remain attributed to upstream. Moeazi has no independent trading result for these tools or models.</p></article><article><h3>Selection rule</h3><p>Choose a capability that can be evaluated offline and kept advisory. Existing policy, mandate, owner approval, and signing paths keep control.</p></article></div><div class="notice research-caveat"><span class="notice-mark" aria-hidden="true">i</span><p><strong>Research artifact only.</strong> No candidate is installed or connected to a live decision path by this explorer. Jev is a hosted product reference, not an open-source candidate.</p></div></section>';
  }

  function renderNodeGraph(system) {
    const byId = new Map(system.nodes.map(node => [node.id, node]));
    const card = node => '<article class="architecture-node"><strong>' + esc(node.label) + '</strong><p>' + esc(node.detail) + '</p><div class="research-sources">' + sourceLinks(node.sources) + '</div></article>';
    const paths = system.edges.map(([fromId, toId, label]) => {
      const from = byId.get(fromId), to = byId.get(toId);
      if (!from || !to) throw new Error('Invalid proposed architecture edge: ' + fromId + ' → ' + toId);
      return '<div class="architecture-path">' + card(from) + '<div class="architecture-link"><span aria-hidden="true">→</span><strong>' + esc(label) + '</strong></div>' + card(to) + '</div>';
    }).join('');
    return '<section class="combined-architecture" aria-labelledby="combined-title"><div class="eyebrow">PROPOSED ARCHITECTURE</div><h2 id="combined-title">Research to a guarded decision</h2><p>' + esc(system.note) + '</p><div class="architecture-diagram" role="group" aria-label="Proposed directed data and authority handoffs">' + paths + '</div><p class="order-boundary"><strong>Signal ≠ order.</strong> Advisory output carries a score, evidence, and expiry. Only existing validated venue code can form a bounded request; the model never receives signing keys.</p></section>';
  }

  function renderWalkthroughs(system) {
    return '<section class="walkthroughs" aria-labelledby="walkthrough-title"><div class="eyebrow">CONTROL PATHS</div><h2 id="walkthrough-title">Scenario walkthroughs</h2><div class="walkthrough-grid">' + system.walkthroughs.map(item => '<details class="walkthrough"><summary>' + esc(item.title) + '</summary><p>' + esc(item.summary) + '</p><ol>' + item.steps.map(step => '<li>' + esc(step) + '</li>').join('') + '</ol></details>').join('') + '</div></section>';
  }

  function renderMatrix(group) {
    const criterionNames = group.criteria || [];
    return '<div class="table-wrap research-table-wrap" tabindex="0" aria-label="Scrollable ' + esc(group.title) + ' comparison table"><table class="research-matrix"><caption>' + esc(group.title) + ' · equal criteria applied to all five candidates</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Role / rank</th>' + criterionNames.map(item => '<th scope="col">' + esc(item) + '</th>').join('') + '</tr></thead><tbody>' + group.options.map(option => '<tr><th scope="row"><a href="#' + esc(group.id + '-' + option.id) + '">' + esc(option.name) + '</a></th><td><span class="rank-chip rank-' + esc(option.rank) + '">' + esc(option.rankLabel) + '</span><br>' + esc(option.role) + '</td>' + criterionNames.map(item => '<td>' + esc((option.matrix || {})[item] || 'Evidence pending') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  function renderOption(group, option) {
    const graphDetails = option.graphs ? '<details class="graph-details"><summary>Inspect source-linked graphs</summary><div class="graph-pair">' + graphMarkup(option.graphs.internal) + graphMarkup(option.graphs.moeazi) + '</div></details>' : '';
    const sources = (option.sources || []).map(source => '<li><a href="' + esc(source[1]) + '">' + esc(source[0]) + ' ↗</a></li>').join('');
    return '<article class="candidate-card rank-card-' + esc(option.rank) + '" id="' + esc(group.id + '-' + option.id) + '"><div class="candidate-top"><div><span class="rank-chip rank-' + esc(option.rank) + '">' + esc(option.rankLabel) + '</span><h4>' + esc(option.name) + '</h4><p class="candidate-role">' + esc(option.role) + '</p></div><a class="repo-link" href="' + esc(option.repoUrl) + '">' + (option.local ? 'Local source' : 'Pinned source') + ' ↗</a></div>' +
      '<p class="why-included"><strong>Why it entered the comparison:</strong> ' + esc(option.whyIncluded) + '</p>' +
      '<dl class="candidate-facts">' + block('Architecture / actual role', option.architecture) + block('Dependencies', option.dependencies) + block('Operating cost', option.operatingCost) + block('Fit with Moeazi', option.fit) + block('Select / reject rationale', option.verdict) + block('Maintenance evidence', option.maintenance) + '</dl>' +
      '<div class="revision-line"><strong>Inspected commit:</strong> <code>' + esc(option.revision) + '</code><span> · </span><strong>License:</strong> ' + esc(option.license) + '</div>' +
      (sources ? '<ul class="research-sources candidate-sources" aria-label="Evidence sources">' + sources + '</ul>' : '') +
      (option.evidenceGap ? '<p class="evidence-gap"><strong>Evidence gap:</strong> ' + esc(option.evidenceGap) + '</p>' : '') + graphDetails + '</article>';
  }

  function renderGroup(group) {
    const winner = group.options.find(option => option.rank === 'recommended');
    const runner = group.options.find(option => option.rank === 'runner-up');
    return '<section class="research-group" id="group-' + esc(group.id) + '" aria-labelledby="group-title-' + esc(group.id) + '"><header class="research-group-head"><div class="eyebrow">CAPABILITY ' + esc(group.number) + ' / 05</div><h2 id="group-title-' + esc(group.id) + '">' + esc(group.title) + '</h2><p>' + esc(group.question) + '</p></header><div class="decision-summary"><div><span class="rank-chip rank-recommended">Recommended</span><h3>' + esc(winner.name) + '</h3><p>' + esc(group.recommendation) + '</p></div><div><span class="rank-chip rank-runner-up">Runner-up</span><h3>' + esc(runner.name) + '</h3><p>' + esc(group.runnerUpReason) + '</p></div></div>' +
      '<p class="why-moeazi"><strong>Why this choice for Moeazi:</strong> ' + esc(group.whyMoeazi) + '</p><p class="change-condition"><strong>What would change the recommendation:</strong> ' + esc(group.changeCondition) + '</p>' + (group.reference ? '<aside class="research-reference"><strong>' + esc(group.reference.title) + '</strong><p>' + esc(group.reference.detail) + '</p><div class="research-sources">' + sourceLinks(group.reference.sources) + '</div></aside>' : '') + renderMatrix(group) +
      '<div class="candidate-list"><h3>Five researched options</h3>' + group.options.map(option => renderOption(group, option)).join('') + '</div></section>';
  }

  function render() {
    root.innerHTML = renderMethod() + renderNodeGraph(research.system) + renderWalkthroughs(research.system) + '<nav class="research-index" aria-label="Research capability comparisons"><div class="eyebrow">COMPARE FIVE OPTIONS PER CAPABILITY</div><div class="research-index-links">' + research.groups.map(group => '<a href="#group-' + esc(group.id) + '">' + esc(group.number) + ' · ' + esc(group.shortTitle) + '</a>').join('') + '</div></nav>' + research.groups.map(renderGroup).join('');
  }

  render();
})();
