const manualPerpl = {
  status: document.querySelector("#manual-perpl-state"),
  gate: document.querySelector("#manual-perpl-gate-status"),
  readiness: document.querySelector("#manual-perpl-readiness"),
  audit: document.querySelector("#manual-perpl-audit"),
};
const manualNode = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = String(value);
  return node;
};
const manualStatusCard = (title, status, detail) => {
  const card = manualNode("article", `ops-card ${status ? "service-ok" : "service-down"}`);
  card.append(manualNode("h3", "", title), manualNode("p", "mono", status ? "READY" : "BLOCKED"), manualNode("p", "", detail));
  return card;
};

async function manualPerplRequest(path, options = {}) {
  const response = await window.operatorRequest(path, options);
  if (!response.ok) throw new Error(response.data?.error || `Request failed (${response.status}).`);
  return response.data;
}

function renderManualPerpl(data) {
  const gate = data.gate || {};
  const ready = data.readiness || {};
  manualPerpl.status.textContent = gate.effectiveEnabled ? "Gate enabled" : "Gate disabled";
  manualPerpl.status.className = `status-pill ${gate.effectiveEnabled ? "ok" : "error"}`;
  manualPerpl.gate.replaceChildren(
    manualStatusCard("Configured gate", gate.configuredEnabled === true, gate.configuredEnabled ? "Configured on in this API process." : "Configured off in this API process."),
    manualStatusCard("Effective manual gate", gate.effectiveEnabled === true,
      gate.source === "persistent_local_state" ? "Loaded from persistent local gate state." : "Using the configured environment value until changed."),
  );
  if (gate.error) manualPerpl.gate.append(manualNode("p", "error-text", gate.error));
  const rpc = ready.rpc || {};
  const factory = ready.factory || {};
  const exchange = ready.exchange || {};
  const rows = [
    manualStatusCard("Monad Testnet RPC", rpc.ready === true,
      rpc.error || `Chain ${rpc.chainId ?? "unknown"} · latest block ${rpc.latestBlock ?? "unknown"} · finalized ${rpc.finalizedBlock ?? "unknown"}`),
    manualStatusCard("Manual account factory", factory.ready === true,
      factory.error || factory.address || "Factory address unavailable."),
    manualStatusCard("Perpl Testnet exchange", exchange.ready === true,
      exchange.error || `Chain ${exchange.chainId ?? "unknown"} · ${exchange.openMarketCount ?? 0}/${exchange.marketCount ?? 0} open markets · exchange ${exchange.exchangeAddress ?? "unknown"} · AUSD ${exchange.collateralAddress ?? "unknown"}`),
    manualStatusCard("Manual account preparation", ready.accountPreparationReady === true,
      (ready.accountPreparationBlockers || []).join(" ") || "Account changes are available when each owner acts in the app."),
    manualStatusCard("Perpl order preparation", ready.orderPreparationReady === true,
      (ready.orderPreparationBlockers || []).join(" ") || "Orders are available when each owner acts in the app."),
    manualStatusCard("Account transaction broadcast", ready.accountBroadcastReady === true,
      (ready.accountBroadcastBlockers || []).join(" ") || "The API still verifies the exact owner-signed account transaction."),
    manualStatusCard("Perpl order broadcast", ready.orderBroadcastReady === true,
      (ready.orderBroadcastBlockers || []).join(" ") || "The API still verifies the exact owner-signed order transaction."),
    manualStatusCard("Perpl autonomy gate · separate", ready.perplAutonomyGate === true,
      "This independent autonomy gate does not control manual Perpl accounts or orders."),
  ];
  manualPerpl.readiness.replaceChildren(...rows);
  const entries = Array.isArray(gate.audit) ? [...gate.audit].reverse() : [];
  const history = manualNode("article", "ops-card");
  history.append(manualNode("h3", "", "Recent manual gate changes"));
  if (!entries.length) history.append(manualNode("p", "", "No console gate changes recorded yet."));
  for (const entry of entries) {
    const timestamp = entry.changedAt ? new Date(entry.changedAt).toLocaleString() : "Time unavailable";
    history.append(manualNode("p", "", `${timestamp} · ${entry.from ? "Enabled" : "Disabled"} → ${entry.to ? "Enabled" : "Disabled"} · ${entry.actor || "local operator"}`));
  }
  manualPerpl.audit.replaceChildren(history);
  document.querySelector("#manual-perpl-enable").disabled = gate.effectiveEnabled === true || Boolean(gate.error);
  document.querySelector("#manual-perpl-disable").disabled = gate.effectiveEnabled !== true || Boolean(gate.error);
}

async function loadManualPerplGate() {
  manualPerpl.status.textContent = "Checking readiness…";
  document.querySelector("#manual-perpl-refresh").disabled = true;
  try { renderManualPerpl(await manualPerplRequest("/api/operator/manual-perpl")); }
  catch (error) {
    manualPerpl.status.textContent = "Unavailable";
    manualPerpl.status.className = "status-pill error";
    for (const key of ["gate", "readiness", "audit"]) manualPerpl[key].replaceChildren(manualNode("p", "error-text", error.message));
  } finally { document.querySelector("#manual-perpl-refresh").disabled = false; }
}

async function setManualPerplGate(enabled) {
  const button = document.querySelector(enabled ? "#manual-perpl-enable" : "#manual-perpl-disable");
  const verb = enabled ? "Enable" : "Disable";
  if (!window.confirm(`${verb} the global Manual Perpl Testnet gate? Every user transaction still requires that user's fresh Mera signature and exact review.`)) return;
  button.disabled = true;
  manualPerpl.status.textContent = `${verb} request saving…`;
  try {
    await manualPerplRequest("/api/operator/manual-perpl/gate", { method: "POST", body: { enabled } });
    await loadManualPerplGate();
  } catch (error) {
    manualPerpl.status.textContent = error.message;
    button.disabled = false;
  }
}

function initializeManualPerplGate() {
  document.querySelector("#manual-perpl-refresh").addEventListener("click", () => void loadManualPerplGate());
  document.querySelector("#manual-perpl-enable").addEventListener("click", () => void setManualPerplGate(true));
  document.querySelector("#manual-perpl-disable").addEventListener("click", () => void setManualPerplGate(false));
  void loadManualPerplGate();
}
window.addEventListener("operator:ready", initializeManualPerplGate, { once: true });
