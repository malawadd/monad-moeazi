(() => {
  const root = document.querySelector("#perp-scenario-list");
  if (!root) return;
  const form = document.querySelector("#perp-scenario-form");
  const message = document.querySelector("#perp-scenario-message");
  const state = document.querySelector("#perp-scenario-state");
  const $ = (selector) => document.querySelector(selector);
  const node = (tag, text, cls = "") => {
    const value = document.createElement(tag);
    value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const api = async (path, method = "GET", body) => {
    const response = await window.operatorRequest(path, { method, ...(body === undefined ? {} : { body }) });
    const data = record(response.data);
    if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status}).`);
    return data;
  };
  function render(rows) {
    root.replaceChildren();
    if (!rows.length) { root.append(node("p", "No perp operator scenarios are recorded.", "empty-state")); return; }
    for (const scenario of rows) {
      const card = node("article", "", "perp-scenario-card");
      const header = node("div", "", "perp-scenario-heading");
      header.append(node("strong", `${scenario.status || "unknown"} · ${scenario.stepIndex || 0}/${scenario.stepsTotal || 0}`));
      header.append(node("code", scenario.scenarioId || "Scenario ID unavailable"));
      card.append(header);
      card.append(node("p", `Run ${scenario.runId} · onchain run ${scenario.runStatus || "unknown"} · vault ${scenario.vaultAddress || "unavailable"}`));
      if (scenario.expiresAt) card.append(node("p", `Run expiry ${new Date(scenario.expiresAt * 1000).toLocaleString()}`));
      if (scenario.currentStep) card.append(node("pre", JSON.stringify(scenario.currentStep, null, 2)));
      if (scenario.errorCode) card.append(node("p", `Blocked: ${scenario.errorCode}`, "perp-scenario-error"));
      if (scenario.status === "running") {
        const cancel = node("button", "Cancel script"); cancel.type = "button";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          try { await api(`/api/operator/monad/perp/scenarios/${encodeURIComponent(scenario.scenarioId)}/cancel`, "POST", {}); await refresh(); }
          catch (error) { message.textContent = error.message; cancel.disabled = false; }
        });
        card.append(cancel);
      }
      root.append(card);
    }
  }
  async function refresh() {
    state.textContent = "Loading…";
    const runId = $("#perp-scenario-run").value.trim();
    try {
      const data = await api(`/api/operator/monad/perp/scenarios${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
      const rows = Array.isArray(data.scenarios) ? data.scenarios : [];
      render(rows);
      state.textContent = `${rows.length} scenario${rows.length === 1 ? "" : "s"}`;
    } catch (error) { root.replaceChildren(node("p", error.message, "perp-scenario-error")); state.textContent = "Unavailable"; }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#perp-scenario-submit");
    const runId = $("#perp-scenario-run").value.trim();
    const idempotencyKey = $("#perp-scenario-key").value.trim() || crypto.randomUUID();
    let script;
    try { script = JSON.parse($("#perp-scenario-script").value); }
    catch { message.textContent = "Scenario must be valid JSON."; return; }
    button.disabled = true; $("#perp-scenario-key").value = idempotencyKey;
    message.textContent = "Starting the bridge-authorized operator script…";
    try {
      const scenario = await api("/api/operator/monad/perp/scenarios", "POST", { runId, idempotencyKey, script });
      message.textContent = `Scenario ${scenario.status} · step ${scenario.stepIndex}/${scenario.stepsTotal}. Refresh to see each receipt and run status.`;
      $("#perp-scenario-key").value = crypto.randomUUID();
      await refresh();
    } catch (error) { message.textContent = `${error.message} Retrying with the same request key is safe.`; }
    finally { button.disabled = false; }
  });
  $("#perp-scenario-refresh").addEventListener("click", () => void refresh());
  window.addEventListener("operator:ready", () => void refresh(), { once: true });
})();
