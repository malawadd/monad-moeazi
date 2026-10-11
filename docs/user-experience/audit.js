import {routeRows, legacyRows, frictionRows, deepLinkRows} from './audit-data.js';

function cell(value) {
  const td = document.createElement('td');
  td.textContent = value;
  return td;
}

function table(target, headers, rows) {
  const host = document.getElementById(target);
  if (!host) return;
  const element = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach(label => { const th = document.createElement('th'); th.textContent = label; headRow.append(th); });
  head.append(headRow);
  const body = document.createElement('tbody');
  rows.forEach(row => { const tr = document.createElement('tr'); row.forEach(value => tr.append(cell(value))); body.append(tr); });
  element.append(head, body);
  host.replaceChildren(element);
}

export function renderAudit() {
  const rows = routeRows.map(row => [
    row[0], row[1].startsWith('src/') ? row[1] : `src/screens/${row[1]}`, row[2], row[3], row[4], row[5],
  ]);
  const componentCount = new Set(routeRows.map(row => row[1])).size;
  const intro = document.querySelector('#audit .lede');
  if (intro) intro.insertAdjacentHTML('beforeend', ` <b>${routeRows.length} route bindings / ${componentCount} source modules</b> (includes Main shell, signed-out Welcome and the Agent / PerplMarkets aliases).`);
  table('route-table', ['Route','Source','Current behavior','User Mode destination','Developer Mode','Reachability note'], rows);
  table('legacy-table', ['Screen file','Route audit'], legacyRows);
  table('link-table', ['Link family','Current status','User Mode disposition'], deepLinkRows);
  table('friction-table', ['Area','Before · observed in code or capture','After · proposal','Why · evidence and validation'], frictionRows);
}
