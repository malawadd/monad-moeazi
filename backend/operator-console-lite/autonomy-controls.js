(() => {
  const base = "/api/operator/monad/autonomy";
  const poolRoot = document.querySelector("#autonomy-pools");
  if (!poolRoot) return;
  const poolState = document.querySelector("#autonomy-pool-state");
  const observation = document.querySelector("#autonomy-observation");
  const moveForm = document.querySelector("#autonomy-price-form");
  const scenarioForm = document.querySelector("#autonomy-scenario-form");
  const moveResult = document.querySelector("#autonomy-price-result");
  const scenarioResult = document.querySelector("#autonomy-scenario-result");
  const movePendingKey = "moeazi.monad.autonomy.pendingMove.v1";
  const scenarioPendingKey = "moeazi.monad.autonomy.pendingScenario.v1";
  let pools = [];
  let poolsFresh = false;
  let scenarioTimer = 0;
  let started = false;
  let moveInFlight = false;
  let scenarioInFlight = false;
  const $ = (selector) => document.querySelector(selector);
  const node = (tag, content = "", className = "") => {
    const el = document.createElement(tag);
    el.textContent = content;
    if (className) el.className = className;
    return el;
  };
  const rec = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const int = (value) => { try { return BigInt(value); } catch { return null; } };
  const fmtUnits = (value, scale, digits = 6) => {
    const raw = int(value);
    if (raw === null) return "Unavailable";
    const divisor = 10n ** BigInt(scale);
    const whole = raw / divisor;
    const fraction = String(raw % divisor).padStart(scale, "0").slice(0, digits).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : String(whole);
  };
  const wad = (value) => fmtUnits(value, 18, 8);
  const usdc = (value) => `${fmtUnits(value, 6, 6)} USDC`;
  const api = async (path, method = "GET", body) => {
    const result = await window.operatorRequest(path, { method, ...(body === undefined ? {} : { body }) });
    const data = rec(result.data);
    if (!result.ok) {
      const error = new Error(text(data.message) || text(data.error) || `Request failed (${result.status}).`);
      error.status = result.status;
      error.code = text(data.code);
      throw error;
    }
    return data;
  };
  const apiError = (error) => `${error instanceof Error ? error.message : "Request failed."}${text(error?.code) ? ` · ${error.code}` : ""}`;
  const safeRead = (key) => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } };
  const safeWrite = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Status remains in this page. */ } };
  const safeClear = (key) => { try { sessionStorage.removeItem(key); } catch { /* No action. */ } };
  const selectedPool = (selector) => pools.find((pool) => Number(pool.tokenIndex) === Number($(selector).value));
  function updateSubmitGates() {
    const unresolved = moveInFlight || scenarioInFlight || Boolean(safeRead(movePendingKey)) || Boolean(safeRead(scenarioPendingKey));
    $("#autonomy-price-submit").disabled = !poolsFresh || !pools.length || unresolved;
    $("#autonomy-scenario-submit").disabled = !poolsFresh || !pools.length || unresolved;
  }

  function renderPools(data) {
    pools = Array.isArray(data.pools) ? data.pools.map(rec) : [];
    poolRoot.replaceChildren();
    if (!pools.length) poolRoot.append(node("p", "No approved pool observations were returned.", "empty-state"));
    for (const pool of pools) {
      const card = node("article", "", "autonomy-pool");
      card.append(node("h3", `${text(pool.tokenSymbol) || `Token ${pool.tokenIndex}`} / USDC`));
      const details = document.createElement("dl");
      const rows = [
        ["Executable price", `${wad(pool.priceUsdcPerTokenWad)} USDC / token`],
        ["Pool USDC", usdc(pool.reserveUsdcUnits)], ["Pool token units", text(pool.reserveTokenUnits) || "Unavailable"],
        ["Operator USDC", usdc(pool.operatorUsdcUnits)], ["Operator token units", text(pool.operatorTokenUnits) || "Unavailable"],
        ["Token address", text(pool.tokenAddress) || "Unavailable"], ["Pool address", text(pool.poolAddress) || "Unavailable"],
      ];
      for (const [label, value] of rows) details.append(node("dt", label), node("dd", value));
      card.append(details);
      poolRoot.append(card);
    }
    for (const selector of ["#autonomy-price-token", "#autonomy-scenario-token"]) {
      const select = $(selector);
      const previous = select.value;
      select.replaceChildren(new Option("Select approved pool", ""));
      for (const pool of pools) select.add(new Option(`${text(pool.tokenSymbol) || `Token ${pool.tokenIndex}`} · #${pool.tokenIndex}`, text(pool.tokenIndex)));
      if (pools.some((pool) => String(pool.tokenIndex) === previous)) select.value = previous;
      select.disabled = !pools.length;
      if (!select.value && pools.length) select.value = String(pools[0].tokenIndex);
    }
    poolsFresh = true;
    observation.textContent = `Finalized observation · block ${text(data.observedBlock) || "unknown"} · ${text(data.observedAt) || "time unavailable"}`;
    poolState.textContent = `${pools.length} pools observed`;
    updateSubmitGates();
    updateMoveHint(); updateScenarioHint();
  }
  async function refreshPools() {
    poolState.textContent = "Loading…";
    poolsFresh = false;
    updateSubmitGates();
    $("#autonomy-refresh-pools").disabled = true;
    try { renderPools(await api(`${base}/pools`)); }
    catch (error) { poolState.textContent = "Unavailable"; observation.textContent = apiError(error); updateSubmitGates(); }
    finally { $("#autonomy-refresh-pools").disabled = false; }
  }
  function updateMoveHint() {
    const up = $("#autonomy-price-direction").value === "up";
    const input = $("#autonomy-price-amount");
    input.min = up ? "100000" : "1000000000000000";
    input.max = up ? "10000000" : "1000000000000000000000000";
    input.placeholder = up ? "100000–10000000 USDC base units" : "1000000000000000–1000000000000000000000000 token units";
    $("#autonomy-price-hint").textContent = up
      ? "Up spends 0.1–10 USDC (6 decimals). Inventory and output liquidity are checked before submission."
      : "Down sells 0.001–1,000 token units (raw base units). Inventory and output liquidity are checked before submission.";
  }
  function updateScenarioHint() {
    const direction = $("#autonomy-scenario-direction").value;
    const flat = direction === "flat";
    const falling = direction === "falling";
    const steps = $("#autonomy-scenario-steps");
    steps.max = flat ? "10" : "20";
    $("#autonomy-step-limit").textContent = flat ? "1–10 rounds (2 swaps each)" : "1–20 swaps";
    if (Number(steps.value) > Number(steps.max)) steps.value = steps.max;
    const amount = $("#autonomy-scenario-amount");
    amount.min = falling ? "1000000000000000" : "100000";
    amount.max = falling ? "1000000000000000000000000" : "10000000";
    amount.placeholder = falling ? "0.001–1,000 tokens in raw units" : "0.1–10 USDC base units";
    $("#autonomy-scenario-hint").textContent = falling
      ? "Falling sells 0.001–1,000 token units per swap. Total inventory is checked by the backend."
      : flat ? "Flat alternates funded buy/sell swaps per round. Enter 0.1–10 USDC base units per round."
        : "Rising spends 0.1–10 USDC base units per swap. Total inventory is checked by the backend.";
  }
  function preflight(pool, direction, amountValue, multiplier = 1) {
    const amount = int(amountValue);
    if (!pool || amount === null || amount <= 0n) return "Select a pool and enter a positive whole number of base units.";
    const up = direction === "up" || direction === "rising" || direction === "flat";
    const min = up ? 100000n : 1000000000000000n;
    const max = up ? 10000000n : 1000000000000000000000000n;
    if (amount < min || amount > max) return up ? "USDC amount must be 0.1–10 USDC in base units." : "Token amount must be 0.001–1,000 tokens in raw base units.";
    const inventory = int(up ? pool.operatorUsdcUnits : pool.operatorTokenUnits);
    if (inventory === null || inventory < amount * BigInt(multiplier)) return "Current operator inventory is below the amount required. Refresh pool state before retrying.";
    const outputReserve = int(up ? pool.reserveTokenUnits : pool.reserveUsdcUnits);
    if (outputReserve === null || outputReserve <= 0n) return "The pool has no output reserve for this move.";
    return "";
  }
  function renderMove(data) {
    const status = text(data.status) || "unknown";
    moveResult.replaceChildren(node("strong", `Price move · ${status.toUpperCase()}`));
    if (status !== "finalized" || !text(data.transactionHash) || !text(data.blockNumber)) {
      moveResult.append(node("span", status === "blocked" ? text(data.message) || text(data.error) || "Backend blocked this move; no fill was recorded." : "No finalized receipt returned. The console will reconcile by idempotency key; no fill is shown."));
      return false;
    }
    moveResult.append(node("span", `Finalized block ${text(data.blockNumber)} · ${text(data.direction)} · ${text(data.tokenIndex)}`));
    const lines = [
      `Tx ${text(data.transactionHash)}`,
      `Input ${text(data.inputAmountUnits)} ${text(data.inputAsset)} base units → output ${text(data.outputAmountUnits)} ${text(data.outputAsset)} base units`,
      `Pool price ${wad(data.priceBeforeWad)} → ${wad(data.priceAfterWad)} USDC / token`,
    ];
    for (const line of lines) moveResult.append(node("code", line));
    if (data.pool && typeof data.pool === "object") renderPools({ pools: pools.map((pool) => Number(pool.tokenIndex) === Number(data.tokenIndex) ? data.pool : pool), observedBlock: data.observedBlock, observedAt: data.observedAt });
    return true;
  }
  async function reconcileMove() {
    const pending = safeRead(movePendingKey);
    if (!pending?.idempotencyKey) return;
    try {
      const response = await api(`${base}/price-move/${encodeURIComponent(pending.idempotencyKey)}`);
      const data = rec(response.move || response);
      if (renderMove(data) || data.status === "blocked") safeClear(movePendingKey);
      else offerRetry(moveResult, "Retry same idempotent move", () => submitMove(pending, true));
    } catch (error) { offerRetry(moveResult, `Move not reconciled · ${apiError(error)}`, () => submitMove(pending, true)); }
  }
  function offerRetry(target, label, action) {
    const button = node("button", label);
    button.type = "button";
    button.addEventListener("click", action, { once: true });
    target.append(button);
  }
  async function submitMove(payload, retry = false) {
    if (!retry && !window.confirm(`Submit a funded Monad Testnet ${payload.direction} swap for token index ${payload.tokenIndex}? Amount: ${payload.amountUnits} base units. This can move the pool price and lose test inventory.`)) return;
    $("#autonomy-price-submit").disabled = true;
    moveInFlight = true;
    moveResult.textContent = "Submitting funded testnet swap…";
    safeWrite(movePendingKey, payload);
    try {
      const data = await api(`${base}/price-move`, "POST", payload);
      if (renderMove(data) || data.status === "blocked") safeClear(movePendingKey);
      else offerRetry(moveResult, "Retry same idempotent move", () => submitMove(payload, true));
    } catch (error) {
      const isUncertain = !error.status || error.status >= 500;
      moveResult.replaceChildren(node("strong", isUncertain ? "Move outcome uncertain" : "Move blocked"), node("span", apiError(error)));
      if (isUncertain) offerRetry(moveResult, "Retry same idempotent move", () => submitMove(payload, true));
      else safeClear(movePendingKey);
    } finally { moveInFlight = false; updateSubmitGates(); }
  }
  function renderScenario(data) {
    scenarioResult.replaceChildren(node("strong", `Scenario · ${text(data.status).toUpperCase() || "UNKNOWN"}`));
    const total = text(data.stepsTotal) || text(data.steps);
    scenarioResult.append(node("span", `${text(data.stepsCompleted) || "0"} / ${total || "?"} swaps complete · ${text(data.direction)} · token ${text(data.tokenIndex)}`));
    if (text(data.nextTickAt)) scenarioResult.append(node("code", `Next swap: ${text(data.nextTickAt)}`));
    const events = Array.isArray(data.events) ? data.events : [];
    const receipts = document.createElement("ol"); receipts.className = "autonomy-receipts";
    for (const eventValue of events) {
      const event = rec(eventValue);
      const li = document.createElement("li");
      const finalized = text(event.status) === "finalized" && text(event.transactionHash) && text(event.blockNumber);
      li.append(node("strong", `${text(event.type) || "Swap"} · ${text(event.status) || "status unavailable"}`));
      li.append(node("span", finalized ? `Finalized block ${text(event.blockNumber)} · ${text(event.timestamp)}` : "No finalized receipt; no fill shown."));
      if (finalized) li.append(node("code", `Tx ${text(event.transactionHash)} · input ${text(event.inputAmountUnits)} units → output ${text(event.outputAmountUnits)} units · price ${wad(event.priceBeforeWad)} → ${wad(event.priceAfterWad)}`));
      receipts.append(li);
    }
    if (events.length) scenarioResult.append(receipts);
    if (data.status === "blocked") scenarioResult.append(node("span", text(data.message) || text(data.error) || "Backend blocked the remaining scenario swaps.", "autonomy-error"));
    const isTerminal = data.status === "completed" || data.status === "blocked";
    if (isTerminal) { safeClear(scenarioPendingKey); scenarioInFlight = false; }
    updateSubmitGates();
    return !isTerminal;
  }
  function scheduleScenarioPoll(id) {
    clearTimeout(scenarioTimer);
    scenarioTimer = window.setTimeout(async () => {
      try {
        const data = await api(`${base}/scenarios/${encodeURIComponent(id)}`);
        if (renderScenario(data)) scheduleScenarioPoll(id);
      } catch (error) {
        scenarioResult.append(node("span", `Status read failed; retrying safely · ${apiError(error)}`, "autonomy-error"));
        scheduleScenarioPoll(id);
      }
    }, 5000);
  }
  async function reconcileScenario() {
    const pending = safeRead(scenarioPendingKey);
    if (!pending?.idempotencyKey) return;
    try {
      const data = await api(`${base}/scenarios/by-key/${encodeURIComponent(pending.idempotencyKey)}`);
      const scenario = rec(data.scenario || data);
      if (!text(scenario.scenarioId)) throw new Error("Scenario key has no recorded scenario yet.");
      safeWrite(scenarioPendingKey, { ...pending, scenarioId: text(scenario.scenarioId) });
      if (renderScenario(scenario)) scheduleScenarioPoll(text(scenario.scenarioId));
    } catch (error) {
      scenarioResult.replaceChildren(node("strong", "Scenario outcome uncertain"), node("span", apiError(error)));
      offerRetry(scenarioResult, "Retry same idempotent scenario", () => submitScenario(pending, true));
      $("#autonomy-scenario-submit").disabled = true;
    }
  }
  async function submitScenario(payload, retry = false) {
    if (!retry && !window.confirm(`Start ${payload.direction} testnet scenario for token index ${payload.tokenIndex}: ${payload.steps} step(s), ${payload.intervalSeconds}s apart, ${payload.swapAmountUnits} raw input units per step. This submits funded swaps and can lose test inventory.`)) return;
    $("#autonomy-scenario-submit").disabled = true;
    scenarioInFlight = true;
    scenarioResult.textContent = "Starting testnet scenario…";
    safeWrite(scenarioPendingKey, payload);
    try {
      const data = await api(`${base}/scenarios`, "POST", payload);
      if (!text(data.scenarioId)) throw new Error("Scenario response did not include a scenario ID.");
      scenarioInFlight = false;
      safeWrite(scenarioPendingKey, { ...payload, scenarioId: text(data.scenarioId) });
      if (renderScenario(data)) scheduleScenarioPoll(text(data.scenarioId));
    } catch (error) {
      scenarioInFlight = false;
      const isUncertain = !error.status || error.status >= 500;
      scenarioResult.replaceChildren(node("strong", isUncertain ? "Scenario outcome uncertain" : "Scenario blocked"), node("span", apiError(error)));
      if (isUncertain) offerRetry(scenarioResult, "Retry same idempotent scenario", () => submitScenario(payload, true));
      else safeClear(scenarioPendingKey);
      updateSubmitGates();
    }
  }
  moveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const direction = $("#autonomy-price-direction").value;
    const pool = selectedPool("#autonomy-price-token");
    const amountUnits = $("#autonomy-price-amount").value.trim();
    const error = preflight(pool, direction, amountUnits);
    if (error) { moveResult.textContent = error; return; }
    void submitMove({ tokenIndex: Number(pool.tokenIndex), direction, amountUnits, idempotencyKey: crypto.randomUUID() });
  });
  scenarioForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const direction = $("#autonomy-scenario-direction").value;
    const pool = selectedPool("#autonomy-scenario-token");
    const steps = Number($("#autonomy-scenario-steps").value);
    const intervalSeconds = Number($("#autonomy-scenario-interval").value);
    const swapAmountUnits = $("#autonomy-scenario-amount").value.trim();
    const maxSteps = direction === "flat" ? 10 : 20;
    if (!pool || !Number.isInteger(steps) || steps < 1 || steps > maxSteps || !Number.isInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 120) {
      scenarioResult.textContent = `Steps must be 1–${maxSteps}; interval must be 15–120 seconds.`; return;
    }
    const error = preflight(pool, direction, swapAmountUnits, steps);
    if (error) { scenarioResult.textContent = error; return; }
    void submitScenario({ tokenIndex: Number(pool.tokenIndex), direction, steps, intervalSeconds, swapAmountUnits, idempotencyKey: crypto.randomUUID() });
  });
  $("#autonomy-price-direction").addEventListener("change", updateMoveHint);
  $("#autonomy-scenario-direction").addEventListener("change", updateScenarioHint);
  $("#autonomy-refresh-pools").addEventListener("click", () => void refreshPools());
  window.addEventListener("operator:ready", () => {
    if (started) return;
    started = true;
    updateMoveHint(); updateScenarioHint();
    void refreshPools(); void reconcileMove(); void reconcileScenario();
  });
})();
