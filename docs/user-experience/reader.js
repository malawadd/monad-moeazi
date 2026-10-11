const allowed = new Set(['README.md','route-audit.md','research-notes.md','screen-specs.md',
  'implementation-backlog.md','study-plan.md','findings.md','validation.md','evidence/README.md',
  'contemporary-patterns.md','interaction-coverage.md','marketplace-revision.md']);
const documentName = new URLSearchParams(location.search).get('doc') || '';
const host = document.getElementById('document');

function escapeHtml(value) {
  return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function safeLink(href) {
  if (/^https?:\/\//i.test(href)) return {href, external:true};
  const root = new URL('./', location.href);
  const resolved = new URL(href, new URL(documentName, location.href));
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname)) return {href:'#'};
  const relative = resolved.pathname.slice(root.pathname.length);
  if (relative.endsWith('.md') && allowed.has(relative)) {
    return {href:`reader.html?doc=${encodeURIComponent(relative)}${resolved.hash}`};
  }
  return {href:resolved.href};
}

function inlineMarkdown(source) {
  let value = escapeHtml(source);
  const held = [];
  const hold = html => { const marker = `\u0000${held.length}\u0000`; held.push(html); return marker; };
  value = value.replace(/`([^`]+)`/g, (_, text) => hold(`<code>${text}</code>`));
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, rawHref) => {
    const link = safeLink(rawHref);
    const target = link.external ? ' target="_blank" rel="noreferrer"' : '';
    return hold(`<a href="${escapeHtml(link.href)}"${target}>${label}</a>`);
  });
  value = value.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  value = value.replace(/\*(.+?)\*/g,'<em>$1</em>');
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)]);
}

function cells(line) {
  return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(item => item.trim());
}

function headingId(source) {
  return source.toLocaleLowerCase().replace(/<[^>]+>/g,'').replace(/`([^`]+)`/g,'$1')
    .replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
}

function blockStart(line) {
  return /^(#{1,4}\s|\s*[-*]\s|\s*\d+[.)]\s|>\s?|```|\|.*\|$|---+$)/.test(line);
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r','').split('\n');
  const fragment = document.createDocumentFragment();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      const pre = document.createElement('pre'); const node = document.createElement('code');
      node.textContent = code.join('\n'); pre.append(node); fragment.append(pre); continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { const h = document.createElement(`h${heading[1].length}`); h.id = headingId(heading[2]); h.innerHTML = inlineMarkdown(heading[2]); fragment.append(h); i++; continue; }
    if (/^\|.*\|$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) rows.push(cells(lines[i++]));
      const table = document.createElement('table'); const head = document.createElement('thead'); const body = document.createElement('tbody');
      rows.forEach((row,index) => {
        if (row.every(item => /^:?-{2,}:?$/.test(item))) return;
        const tr = document.createElement('tr');
        row.forEach(text => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.innerHTML = inlineMarkdown(text); tr.append(cell); });
        (index === 0 ? head : body).append(tr);
      });
      table.append(head,body); const wrap = document.createElement('div'); wrap.className = 'table-wrap'; wrap.append(table); fragment.append(wrap); continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line); const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        const itemLines = [lines[i++].replace(/^\s*(?:[-*]|\d+[.)])\s+/,'')];
        while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) itemLines.push(lines[i++].trim());
        const item = itemLines.join(' ').replace(/^\[ \]\s*/,'□ ').replace(/^\[x\]\s*/i,'☑ ');
        const li = document.createElement('li'); li.innerHTML = inlineMarkdown(item); list.append(li);
      }
      fragment.append(list); continue;
    }
    if (/^>\s?/.test(line)) { const quote = document.createElement('blockquote'); quote.textContent = line.replace(/^>\s?/,''); fragment.append(quote); i++; continue; }
    if (/^---+$/.test(line)) { fragment.append(document.createElement('hr')); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) paragraph.push(lines[i++]);
    const p = document.createElement('p'); p.innerHTML = inlineMarkdown(paragraph.join(' ')); fragment.append(p);
  }
  return fragment;
}

if (!allowed.has(documentName)) {
  host.textContent = 'This note is not in the local research index.';
} else {
  fetch(documentName).then(response => {
    if (!response.ok) throw new Error('The note could not be loaded.');
    return response.text();
  }).then(markdown => {
    host.replaceChildren(renderMarkdown(markdown));
    const heading = host.querySelector('h1');
    if (heading) document.title = `${heading.textContent} · Moeazi UX Field Notes`;
    if (location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView());
  }).catch(error => { host.textContent = error.message; });
}
