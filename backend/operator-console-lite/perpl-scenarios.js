(() => {
  const root = document.querySelector("#perpl-scenario-list");
  if (!root) return;
  const $ = (selector) => document.querySelector(selector);
  const form = $("#perpl-scenario-form");
  const message = $("#perpl-scenario-message");
  const state = $("#perpl-scenario-state");
  const submit = $("#perpl-scenario-submit");
  const keyInput = $("#perpl-scenario-key");
  const base = "/api/operator/monad/perpl/scenarios";
  const node = (tag, value, className = "") => {
    const element = document.createElement(tag);
    element.textContent = String(value ?? "");
    if (className) element.className = className;
    return element;
  };
  const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const api = async (url, method = "GET", body) => {
    const result = await window.operatorRequest(url, { method, ...(body === undefined ? {} : { body }) });
    const data = object(result.data);
    if (!result.ok) throw new Error(data.message || data.error || `Request failed (${result.status}).`);
    return data;
  };
  function render(scenarios) {
    root.replaceChildren();
    if (!scenarios.length) {
      root.append(node("p", "No Perpl scenarios are recorded for this run.", "empty-state"));
      return;
    }
    for (const scenario of scenarios) {
      const card = node("article", "", "perp-scenario-card");
      const heading = node("div", "", "perp-scenario-heading");
      heading.append(node("strong", `${scenario.status || "unknown"} · ${scenario.stepIndex || 0}/${scenario.total || scenario.actions?.length || 0}`));
      heading.append(node("code", scenario.scenarioId || "Scenario ID unavailable"));
      card.append(heading);
      card.append(node("p", `Run ${scenario.runId || "unknown"} · ${scenario.venueId || "Perpl"}`));
      if (scenario.updatedAt) card.append(node("p", `Updated ${new Date(scenario.updatedAt).toLocaleString()}`));
      if (scenario.errorCode) card.append(node("p", `Blocked: ${scenario.errorCode}`, "perp-scenario-error"));
      if (["running", "queued"].includes(scenario.status) && scenario.scenarioId) {
        const cancel = node("button", "Cancel remaining actions");
        cancel.type = "button";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          try {
            await api(`${base}/${encodeURIComponent(scenario.scenarioId)}/cancel`, "POST", { reason: "operator_cancelled" });
            await refresh();
          } catch (error) { message.textContent = error.message; cancel.disabled = false; }
        });
        card.append(cancel);
      }
      root.append(card);
    }
  }
  async function refresh() {
    state.textContent = "Loading…";
    const runId = $("#perpl-scenario-run").value.trim();
    try {
      const data = await api(`${base}${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
      const rows = Array.isArray(data.scenarios) ? data.scenarios : [];
      render(rows);
      state.textContent = `${rows.length} scenario${rows.length === 1 ? "" : "s"}`;
    } catch (error) {
      root.replaceChildren(node("p", error.message, "perp-scenario-error"));
      state.textContent = "Unavailable";
    }
  }
  keyInput.value = crypto.randomUUID();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const runId = $("#perpl-scenario-run").value.trim();
    const idempotencyKey = keyInput.value.trim();
    const intervalSeconds = Number($("#perpl-scenario-interval").value);
    let actions;
    try { actions = JSON.parse($("#perpl-scenario-actions").value); }
    catch { message.textContent = "Actions must be valid JSON."; return; }
    if (!Array.isArray(actions) || !actions.length || actions.length > 30) {
      message.textContent = "Enter 1–30 Perpl actions."; return;
    }
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 120) {
      message.textContent = "Choose 15–120 seconds between actions."; return;
    }
    if (!window.confirm(`Submit ${actions.length} funded Perpl Testnet action(s) for run ${runId}? The venue may fill at a loss.`)) return;
    submit.disabled = true;
    message.textContent = "Submitting the same idempotent scenario request…";
    try {
      const scenario = await api(base, "POST", { runId, idempotencyKey, actions, intervalSeconds });
      message.textContent = `Scenario ${scenario.scenarioId || "accepted"}: ${scenario.status || "queued"}. Refresh for reconciled outcomes; admission is not a fill.`;
      keyInput.value = crypto.randomUUID();
      await refresh();
    } catch (error) {
      message.textContent = `${error.message} Keep this request key and refresh before retrying; a network error may leave the scenario queued.`;
    } finally { submit.disabled = false; }
  });
  $("#perpl-scenario-refresh").addEventListener("click", () => void refresh());
  window.addEventListener("operator:ready", () => void refresh(), { once: true });
})();
