const $ = (selector) => document.querySelector(selector);
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asList = (value) => Array.isArray(value) ? value : [];
const state = { workspace: null, config: null, preview: null, sequenceReady: false };

async function request(path, options = {}) {
  const response = await window.operatorRequest(path, options);
  if (!response.ok) throw new Error(response.data?.error || `Request failed (${response.status}).`);
  return response.data;
}
function show(target, message, cls = "") { target.replaceChildren(el("p", cls || "section-lead", message)); }
function panel(title, status, detail) {
  const card = el("article", `ops-card ${status === "healthy" || status === "reachable" ? "service-ok" : "service-down"}`);
  card.append(el("h3", "", title), el("p", "mono", String(status).replaceAll("_", " ").toUpperCase()), el("p", "", detail));
  return card;
}

async function loadHealth() {
  const grid = $("#health-grid");
  try {
    const data = await request("/api/operator/health");
    grid.replaceChildren(...asList(data.services).map((service) => panel(service.name, service.state,
      `${service.service} · 127.0.0.1:${service.port}${service.statusCode ? ` · HTTP ${service.statusCode}` : ""}`)));
    grid.append(el("p", "muted", `Read-only checks · ${new Date(data.checkedAt).toLocaleString()}`));
  } catch (error) { show(grid, error.message, "error-text"); }
}

function loadExperimentChoices(workspace) {
  const select = $("#experiment-version");
  const choices = asList(workspace?.teams).flatMap((team) => asList(team.versions).map((version) => ({
    id: version.versionId, label: `${team.name} · ${team.tier} · version ${version.version}`,
  })));
  select.replaceChildren(new Option(choices.length ? "Choose an owned team version" : "Create a team first", ""));
  for (const item of choices) select.add(new Option(item.label, item.id));
}

async function loadWorkspace() {
  const root = $("#workspace-content");
  try {
    const workspace = state.workspace = await request("/api/operator/workspace");
    root.replaceChildren(panel("Dedicated local account", "healthy",
      `${workspace.account?.status ?? "unknown"} · ${workspace.account?.walletless ? "walletless" : "wallet present"} · ${workspace.account?.emergencyStop ? "paused" : "active"}`));
    const sections = [["Agent teams", asList(workspace.teams).map((team) => `${team.name} · ${team.tier} · ${team.lifecycleStatus} · ${team.versions.length} versions`)],
      ["Model configurations", asList(workspace.models).map((item) => `Version ${item.version} · ${item.status} · ${item.routes.length} routes`)],
      ["Automation policies", asList(workspace.policies).map((item) => `Version ${item.version} · ${item.status}`)]];
    for (const [title, values] of sections) {
      const card = el("article", "ops-card"); card.append(el("h3", "", title));
      if (!values.length) card.append(el("p", "", "No entries yet."));
      for (const value of values) card.append(el("p", "", value));
      root.append(card);
    }
    loadExperimentChoices(workspace);
  } catch (error) { show(root, error.message, "error-text"); }
}

async function createTeam(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); const status = $("#team-create-state");
  button.disabled = true; status.textContent = "Creating a paused team in the local operator workspace…";
  try { await request("/api/operator/teams", { method: "POST", body: { name: $("#team-name").value.trim(), tier: $("#team-tier").value } });
    form.reset(); status.textContent = "Team created paused and unfunded."; await loadWorkspace(); }
  catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
}

async function createProgram(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); const status = $("#program-create-state");
  button.disabled = true; status.textContent = "Freezing a new operator-owned version…";
  form.dataset.requestId ||= crypto.randomUUID();
  try {
    const result = await request("/api/operator/programs", { method: "POST", body: { name: $("#program-name").value.trim(), idempotencyKey: form.dataset.requestId } });
    form.reset(); delete form.dataset.requestId;
    status.textContent = `Saved version ${result.version}. No customer assignment changed.`;
    document.querySelector("#refresh-programs")?.click(); await loadWorkspace();
  } catch (error) { status.textContent = `${error.message} Retrying keeps the same request key.`; }
  finally { button.disabled = false; }
}

async function createExperiment(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); const status = $("#experiment-create-state");
  const controllerVersionId = $("#experiment-version").value;
  if (!controllerVersionId) { status.textContent = "Choose an owned team version first."; return; }
  form.dataset.requestId ||= crypto.randomUUID();
  button.disabled = true; status.textContent = "Saving identity-only experiment metadata…";
  try {
    const result = await request("/api/operator/experiments/specs", { method: "POST", body: {
      controllerKind: "customer_team", controllerVersionId, idempotencyKey: form.dataset.requestId,
      specJson: JSON.stringify({ schemaVersion: 1, purpose: "identity", executable: false }),
    } });
    delete form.dataset.requestId;
    status.textContent = `Saved non-executable experiment spec ${result.experimentSpecId}.`;
    await requestOperation("listSpecs");
  } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
}

async function requestOperation(operation, payload) {
  const result = await request("/api/operator", { method: "POST", body: { operation, ...(payload ? { payload } : {}) } });
  return result;
}

async function loadTestCenterHistory(root) {
  const card = el("section", "ops-card"); card.append(el("h3", "", "Fixture run history"));
  const link = el("a", "history-link", "Open Manual sequence to run a reviewed fixture");
  link.href = "#manual-sequence-page"; card.append(link);
  try {
    const data = await request("/api/operator/sequences/sessions?limit=30");
    const runs = asList(data.sessions).flatMap((session) => asList(session.steps)
      .filter((step) => String(step.functionId).startsWith("test-center:POST /internal/test-center/runs"))
      .map((step) => ({ session, step })));
    if (!runs.length) card.append(el("p", "section-lead", "No fixture runs have been recorded."));
    for (const { session, step } of runs) {
      const result = el("pre", "fixture-result", JSON.stringify(step.error ?? step.result ?? {}, null, 2));
      const row = el("article", "fixture-run");
      row.append(el("strong", "", `${step.status} · ${new Date(session.updatedAt).toLocaleString()}`),
        el("small", "muted", `Session ${session.sessionId} · step ${step.ordinal} · ${session.status}`), result);
      card.append(row);
    }
  } catch (error) { card.append(el("p", "error-text", `Run history unavailable: ${error.message}`)); }
  root.append(card);
}

async function loadTestCenter() {
  const root = $("#test-center-panel");
  try {
    const data = await request("/api/operator/test-center/registry");
    const features = asList(data.features);
    root.replaceChildren(panel("Local fixture registry", "healthy", `${features.length} features · ${data.registryVersion || "registry version unavailable"} · no provider calls`));
    for (const feature of features) root.append(panel(feature.label || feature.id,
      feature.enabled === false ? "unavailable" : "reachable", `${feature.id} · ${asList(feature.scenarios).length} scenarios`));
    root.append(el("p", "section-lead", "Fixture runs use a reviewed function, explicit preview, and confirmation. Registry reads never start services or run probes."));
    await loadTestCenterHistory(root);
  } catch (error) {
    const card = panel("Test Center", "optional_unavailable", `${error.message} The optional service never starts automatically.`);
    const enabled = state.config?.registry?.find((item) => item.key === "AGENT_TEST_CENTER_ENABLED")?.configuredValue === "true";
    if (enabled) {
      const start = el("button", "", "Start optional Test Center"); start.type = "button";
      const message = el("span", "", "This starts only the local fixture service; repository and lease gates still apply."); message.setAttribute("role", "status");
      start.addEventListener("click", async () => {
        if (!window.confirm("Start the optional Test Center container on this local Monad stack?")) return;
        start.disabled = true; message.textContent = "Starting the local Test Center…";
        try { await request("/api/operator/test-center/start", { method: "POST", body: { acknowledgement: "START OPTIONAL TEST CENTER" } });
          message.textContent = "Started. Refreshing the registry…"; setTimeout(() => void loadTestCenter(), 800); }
        catch (startError) { message.textContent = startError.message; start.disabled = false; }
      }); card.append(start, message);
    } else card.append(el("p", "", "Test Center is disabled in the reviewed configuration. Enable its local flag through Configuration, then explicitly start the optional service."));
    root.replaceChildren(card);
    await loadTestCenterHistory(root);
  }
}

function renderConfig(data) {
  state.config = data; const root = $("#config-panel"); const form = el("form", ""); const rows = el("div", "config-list");
  for (const item of asList(data.registry)) {
    const row = el("label", "config-row"); row.dataset.key = item.key; row.dataset.current = item.currentValue ?? item.configuredValue;
    const details = el("span", ""); details.append(el("strong", "", `${item.label} · ${item.key}`),
      el("small", "muted", `Configured ${item.configuredValue} · Effective ${item.effectiveValue ?? "unavailable / not introspected"} · ${item.runtimeStatus}`));
    let input;
    if (item.kind === "boolean") { input = el("select", ""); input.add(new Option("On", "true")); input.add(new Option("Off", "false")); }
    else if (item.kind === "choice") { input = el("select", ""); for (const choice of item.choices || []) input.add(new Option(choice, choice)); }
    else { input = el("input", ""); input.type = item.kind === "number" ? "number" : "text"; input.min = item.minimum ?? 0; input.max = item.maximum ?? 100000; input.step = "any"; }
    input.name = item.key; input.value = item.currentValue ?? item.configuredValue; input.disabled = item.editable === false;
    row.append(details, input, el("span", "", item.editable === false ? "Read only" : item.impact));
    row.append(el("p", "", `Depends on: ${item.dependsOn?.join(" · ") || "none"}. Restart: ${item.services?.join(", ") || "none"}.${item.safetyGate ? ` Gate: ${item.safetyGate}` : ""}`));
    rows.append(row);
  }
  form.append(rows);
  const actions = el("div", "config-actions"); const preview = el("button", "", "Preview changes"); preview.type = "submit";
  const result = el("div", "config-preview"); result.setAttribute("aria-live", "polite"); actions.append(preview); form.append(actions, result);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); state.preview = null; const updates = {};
    for (const input of rows.querySelectorAll("input,select")) {
      if (!input.disabled && input.value !== input.closest(".config-row").dataset.current) updates[input.name] = input.value;
    }
    if (!Object.keys(updates).length) { show(result, "No switch values changed."); return; }
    preview.disabled = true; show(result, "Running configuration preflight…");
    try {
      const outcome = state.preview = await request("/api/operator/config/preview", { method: "POST", body: updates });
      const summary = el("div", "config-summary");
      for (const change of outcome.changes || []) summary.append(el("p", "", `${change.key}: ${change.from} → ${change.to}`));
      for (const effect of outcome.effects || []) summary.append(el("p", "", effect));
      for (const error of outcome.errors || []) summary.append(el("p", "error-text", error));
      result.replaceChildren(summary);
      if (!outcome.errors?.length) {
        if (outcome.requiresAcknowledgement) {
          const ack = el("input", ""); ack.placeholder = "Type APPLY REVIEWED CONFIGURATION"; ack.setAttribute("aria-label", "Configuration acknowledgement"); result.append(ack); state.preview.ack = ack;
        }
        const apply = el("button", "", "Apply reviewed changes"); apply.type = "button";
        apply.addEventListener("click", async () => {
          apply.disabled = true;
          try {
            const applied = await request("/api/operator/config/apply", { method: "POST", body: { previewId: outcome.previewId, hash: outcome.hash,
              ...(state.preview.ack ? { acknowledgement: state.preview.ack.value } : {}) } });
            result.append(el("p", "", `Applied configuration. Recreated: ${applied.restarted?.join(", ") || "none"}. Pending stopped services: ${applied.pending?.join(", ") || "none"}.`));
            state.preview = null; await loadConfig();
          } catch (error) { result.append(el("p", "error-text", error.message)); apply.disabled = false; }
        }); result.append(apply);
      }
    } catch (error) { show(result, error.message, "error-text"); }
    finally { preview.disabled = false; }
  });
  root.replaceChildren(form);
}

async function loadConfig() { try { renderConfig(await request("/api/operator/config")); } catch (error) { show($("#config-panel"), error.message, "error-text"); } }

function initialize() {
  void loadHealth(); void loadWorkspace(); void loadTestCenter(); void loadConfig();
  $("#team-create-form").addEventListener("submit", createTeam);
  $("#program-create-form").addEventListener("submit", createProgram);
  $("#experiment-create-form").addEventListener("submit", createExperiment);
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.refresh === "health") void loadHealth();
    if (button.dataset.refresh === "workspace") void loadWorkspace();
    if (button.dataset.refresh === "testing") void loadTestCenter();
    if (button.dataset.refresh === "config") void loadConfig();
  }));
  if (!state.sequenceReady && window.initManualSequence) {
    state.sequenceReady = true;
    window.initManualSequence({ root: $("#manual-sequence-root"), request: (path, options) => request(path, options) });
  }
}
window.addEventListener("operator:ready", initialize, { once: true });
