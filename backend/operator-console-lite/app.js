const specList = document.querySelector("#spec-list");
const catalogState = document.querySelector("#catalog-state");
const specRows = new Map();
const lanes = {
  A: { run: null, outcome: null, error: "" },
  B: { run: null, outcome: null, error: "" },
};

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringAt(value, key) {
  return typeof record(value)[key] === "string" ? record(value)[key] : "";
}

function make(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function metadataFor(row) {
  try { return record(JSON.parse(stringAt(row, "specJson"))); } catch { return {}; }
}

function field(parent, label, value, mono = false) {
  const wrapper = make("div", "spec-field");
  wrapper.append(make("span", "field-name", label), make("strong", mono ? "mono" : "", value || "Unavailable"));
  parent.append(wrapper);
}

function renderSpecs(rows) {
  specRows.clear();
  specList.replaceChildren();
  for (const value of rows) {
    const row = record(value);
    const id = stringAt(row, "_id") || stringAt(row, "experimentSpecId");
    if (!id) continue;
    specRows.set(id, row);
    const meta = metadataFor(row);
    const article = make("article", "spec-card");
    const heading = make("div", "spec-card-heading");
    heading.append(make("span", "kind-tag", stringAt(row, "controllerKind") === "customer_team" ? "AGENT TEAM" : "MANAGED PROGRAM"));
    heading.append(make("time", "muted", Number.isFinite(row.createdAt) ? new Date(row.createdAt).toLocaleString() : "Date unavailable"));
    article.append(heading, make("h3", "mono", id));
    const grid = make("div", "spec-fields");
    field(grid, "Saved version", stringAt(row, "controllerVersionId"), true);
    field(grid, "Frozen content hash", stringAt(row, "contentHash"), true);
    field(grid, "Spec purpose", stringAt(meta, "purpose"));
    field(grid, "Dataset hash", stringAt(meta, "datasetHash"), true);
    field(grid, "Strategy artifact hash", stringAt(row, "strategyArtifactHash") || stringAt(meta, "strategyArtifactHash") || "Not returned by this API", true);
    field(grid, "Policy hash", stringAt(row, "policyHash") || stringAt(meta, "policyHash") || "Not returned by this API", true);
    field(grid, "Current account assignment", stringAt(row, "currentStrategy") || "Not returned by this API");
    article.append(grid);
    specList.append(article);
  }
  if (!specRows.size) specList.append(make("p", "empty-state", "No owned experiment specs were returned."));
  for (const variant of ["A", "B"]) {
    const select = document.querySelector(`#lane-${variant.toLowerCase()}-spec`);
    const previous = select.value;
    select.replaceChildren(new Option("Select an owned spec", ""));
    for (const [id, row] of specRows) {
      select.add(new Option(`${stringAt(row, "controllerKind") || "experiment"} · ${stringAt(row, "controllerVersionId") || id}`, id));
    }
    if (specRows.has(previous)) select.value = previous;
  }
}

async function requestOperation(operation, payload) {
  const response = await fetch("/api/operator", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ operation, ...(payload ? { payload } : {}) }),
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const message = stringAt(data, "error") || stringAt(data, "detail") || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

async function loadSpecs() {
  catalogState.textContent = "Loading…";
  document.querySelector("#refresh-specs").disabled = true;
  try {
    const response = record(await requestOperation("listSpecs"));
    const rows = Array.isArray(response.specs) ? response.specs : [];
    renderSpecs(rows);
    catalogState.textContent = `${specRows.size} owned spec${specRows.size === 1 ? "" : "s"}`;
  } catch (error) {
    renderSpecs([]);
    for (const variant of ["A", "B"]) { lanes[variant] = { run: null, outcome: null, error: "" }; renderLane(variant); }
    specList.replaceChildren(make("p", "empty-state", error instanceof Error ? error.message : "Owned specs could not be loaded."));
    catalogState.textContent = "Unavailable";
  } finally { document.querySelector("#refresh-specs").disabled = false; }
}

function runInputs(variant) {
  const prefix = `lane-${variant.toLowerCase()}`;
  return {
    experiment_spec_id: document.querySelector(`#${prefix}-spec`).value,
    run_id: document.querySelector(`#${prefix}-run`).value.trim(),
    manifest_hash: document.querySelector(`#${prefix}-manifest`).value.trim(),
  };
}

function renderLane(variant) {
  const prefix = `lane-${variant.toLowerCase()}`;
  const lane = lanes[variant];
  const badge = document.querySelector(`#${prefix}-state`);
  const list = document.querySelector(`#${prefix}-result`);
  const status = lane.error || (lane.run?.verified ? lane.run.status : "Unknown");
  badge.textContent = lane.error ? "Read failed" : lane.run?.verified ? status || "Verified" : "No verified read";
  badge.className = `status-pill ${lane.error ? "error" : lane.run?.verified ? "ok" : ""}`;
  const lineage = record(lane.run?.lineage);
  const details = [
    ["Run status", lane.run?.verified ? lane.run.status || "Unknown" : "Unknown"],
    ["Dataset", stringAt(lineage, "datasetHash") || "Unknown"],
    ["Strategy artifact", stringAt(lineage, "strategyArtifactHash") || "Not returned by this run"],
    ["Policy hash", stringAt(lineage, "policyHash") || "Not returned by this read API"],
  ];
  list.replaceChildren(...details.flatMap(([label, value]) => [make("dt", "", label), make("dd", "mono", value)]));
  if (lane.error) list.append(make("dt", "error-text", "Read error"), make("dd", "error-text", lane.error));
  renderComparison();
}

async function readLane(variant, kind) {
  const input = runInputs(variant);
  if (!input.experiment_spec_id || !input.run_id || !/^[a-f0-9]{64}$/.test(input.manifest_hash)) {
    lanes[variant].error = "Select a spec and enter its run ID plus a 64-character manifest hash.";
    renderLane(variant); return;
  }
  const lane = lanes[variant];
  lane.error = "";
  renderLane(variant);
  const button = document.querySelector(`[data-action="${kind}"][data-variant="${variant}"]`);
  button.disabled = true;
  try {
    if (kind === "status") {
      const response = record(await requestOperation("readRun", input));
      const state = record(response.state);
      const lineage = record(response.lineage);
      const verified = stringAt(state, "run_id") === input.run_id &&
        stringAt(lineage, "manifestHash") === input.manifest_hash && /^[a-f0-9]{64}$/.test(stringAt(lineage, "datasetHash"));
      lane.run = { verified, status: stringAt(state, "status"), lineage };
      if (!verified) lane.error = "The API did not verify this run's manifest lineage.";
    } else {
      const response = record(await requestOperation("readOutcome", input));
      const outcome = record(response.outcome);
      const lineage = record(outcome.lineage);
      const verified = stringAt(outcome, "runId") === input.run_id &&
        stringAt(outcome, "manifestHash") === input.manifest_hash && stringAt(outcome, "status") === "completed_flat";
      lane.outcome = verified ? outcome : null;
      if (!verified) lane.error = "A verified completed outcome is not available for this run.";
      else if (!lane.run?.verified) lane.run = { verified: true, status: stringAt(outcome, "status"), lineage };
    }
  } catch (error) { lane.error = error instanceof Error ? error.message : "Run read failed."; }
  finally { button.disabled = false; renderLane(variant); }
}

function renderComparison() {
  const target = document.querySelector("#comparison");
  target.replaceChildren();
  const a = lanes.A;
  const b = lanes.B;
  const aLineage = record(a.outcome?.lineage || a.run?.lineage);
  const bLineage = record(b.outcome?.lineage || b.run?.lineage);
  const aData = stringAt(aLineage, "datasetHash");
  const bData = stringAt(bLineage, "datasetHash");
  const aScenario = stringAt(aLineage, "scenarioHash");
  const bScenario = stringAt(bLineage, "scenarioHash");
  const comparable = a.run?.verified && b.run?.verified && /^[a-f0-9]{64}$/.test(aData) &&
    aData === bData && /^[a-f0-9]{64}$/.test(aScenario) && aScenario === bScenario;
  const label = !a.run?.verified || !b.run?.verified ? "Comparison unavailable" :
    aData !== bData ? "Different datasets" : !aScenario || !bScenario ? "Scenario comparison unknown" :
      aScenario === bScenario ? "Same dataset and scenario" : "Different scenarios";
  target.append(make("strong", "", label));
  target.append(make("span", "", comparable
    ? "Lineage matches. Native-asset results below remain replay evidence, not a shared return measure."
    : "A comparison requires verified run lineage with matching dataset and scenario hashes."));
  if (comparable && a.outcome && b.outcome) {
    const grid = make("div", "outcome-grid");
    for (const [name, outcome] of [["A", a.outcome], ["B", b.outcome]]) {
      const card = make("article", "outcome-card");
      card.append(make("h3", "", `Experiment ${name} · completed flat`));
      card.append(make("span", "field-name", "Realized P&L by settlement asset"));
      card.append(make("pre", "", JSON.stringify(record(outcome).realizedPnlBySettlementAsset ?? null, null, 2)));
      card.append(make("span", "field-name", "Fees by native asset"));
      card.append(make("pre", "", JSON.stringify(record(outcome).feesByAsset ?? null, null, 2)));
      grid.append(card);
    }
    target.append(grid);
  } else if (comparable) {
    target.append(make("span", "", "Read each completed outcome to view verified native-asset results."));
  }
}

document.querySelector("#refresh-specs").addEventListener("click", () => void loadSpecs());
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
  void readLane(button.dataset.variant, button.dataset.action);
}));
for (const variant of ["A", "B"]) {
  const prefix = `lane-${variant.toLowerCase()}`;
  for (const id of [`${prefix}-spec`, `${prefix}-run`, `${prefix}-manifest`]) {
    const input = document.querySelector(`#${id}`);
    input.addEventListener(id.endsWith("-spec") ? "change" : "input", () => {
      lanes[variant] = { run: null, outcome: null, error: "" };
      renderLane(variant);
    });
  }
}

window.addEventListener("operator:ready", () => void loadSpecs(), { once: true });
