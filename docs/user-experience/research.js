import {sources, patterns, decisions} from './research-data.js';

function addText(parent, tag, value, className = '') {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function sourceHref(path) {
  return /^(https?:|mailto:)/.test(path) ? path : path;
}

export function renderResearch() {
  const sourceHost = document.getElementById('source-list');
  sources.forEach(source => {
    const card = document.createElement('article'); card.className = 'source-card';
    addText(card, 'span', source.id + ' · ' + source.kind, 'tag');
    addText(card, 'h3', source.title);
    addText(card, 'p', source.detail);
    const link = addText(card, 'a', source.url.startsWith('http') ? 'Open source ↗' : 'Open local evidence ↗');
    link.href = sourceHref(source.url);
    if (source.url.startsWith('http')) { link.target = '_blank'; link.rel = 'noreferrer'; }
    sourceHost.append(card);
  });
  const patternHost = document.getElementById('pattern-list');
  patterns.forEach(pattern => {
    const card = document.createElement('article'); card.className = 'pattern-card';
    addText(card, 'span', pattern.id + ' · ' + pattern.evidence, 'tag');
    addText(card, 'h3', pattern.title);
    addText(card, 'p', 'Observed: ' + pattern.observation);
    addText(card, 'p', 'Moeazi application: ' + pattern.application);
    addText(card, 'p', 'Hypothesis: ' + pattern.hypothesis);
    patternHost.append(card);
  });
  const decisionHost = document.getElementById('decision-list');
  decisions.forEach(decision => {
    const card = document.createElement('article'); card.className = 'decision-card';
    addText(card, 'span', decision.id + ' · EVIDENCE → LESSON → APPLICATION', 'decision-id');
    addText(card, 'h3', decision.title);
    const list = document.createElement('dl');
    [['Evidence',decision.evidence],['Lesson',decision.lesson],['Application',decision.application],['Tradeoff',decision.tradeoff],['Validation',decision.test]].forEach(([label,value]) => {
      addText(list, 'dt', label); addText(list, 'dd', value);
    });
    card.append(list); decisionHost.append(card);
  });
}
