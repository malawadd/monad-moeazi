const liteState = document.querySelector("#lite-state");
const liteValue = document.querySelector("#lite-value");
const liteDetail = document.querySelector("#lite-detail");
const liteButton = document.querySelector("#toggle-lite");
let controls = null;

async function loadLiteMode() {
  liteState.textContent = "Loading…";
  liteButton.disabled = true;
  try {
    controls = await requestOperation("readLiteMode");
    const on = controls.lite_mode === true;
    liteValue.textContent = on ? "ON · reduced agent run" : "OFF · full configured run";
    liteState.textContent = `Version ${controls.version}`;
    liteButton.textContent = on ? "Turn Lite Mode off" : "Turn Lite Mode on";
    liteButton.disabled = !controls.enabled;
    liteButton.setAttribute("aria-pressed", String(!on));
    const limits = controls.limits || {};
    liteDetail.textContent = on
      ? `Lite caps: ${limits.accountRunsPerDay ?? "?"} runs/account/day, ${limits.globalRunsPerDay ?? "?"} platform runs/day, $${limits.providerBudgetUsd ?? "?"} provider budget/day. Manual Guard is ${controls.manual_guard ? "on" : "off"}.`
      : `Full configured agent run. Manual Guard is ${controls.manual_guard ? "on" : "off"}; live trading remains a separate control.`;
  } catch (error) {
    controls = null;
    liteValue.textContent = "Unavailable";
    liteState.textContent = "Unavailable";
    liteDetail.textContent = error instanceof Error ? error.message : "Could not read Lite Mode.";
  }
}

document.querySelector("#refresh-lite").addEventListener("click", () => void loadLiteMode());
liteButton.addEventListener("click", async () => {
  if (!controls) return;
  const next = !controls.lite_mode;
  liteButton.disabled = true;
  liteDetail.textContent = next ? "Enabling Lite Mode…" : "Disabling Lite Mode…";
  try {
    await requestOperation("setLiteMode", { liteMode: next, expectedVersion: controls.version });
    await loadLiteMode();
  } catch (error) {
    liteDetail.textContent = error instanceof Error ? error.message : "Could not change Lite Mode.";
    liteButton.disabled = false;
  }
});

const lookupForm = document.querySelector("#credit-lookup-form");
const grantForm = document.querySelector("#credit-grant-form");
const creditAccount = document.querySelector("#credit-account");
const creditResult = document.querySelector("#credit-result");
const creditAmount = document.querySelector("#credit-amount");
let selectedUser = null;
let pendingGrant = null;

function showAccounts(users) {
  creditAccount.replaceChildren();
  if (!users.length) { creditAccount.textContent = "No account has this email, wallet, or user ID."; return; }
  for (const user of users) {
    const card = document.createElement("div");
    card.className = "credit-candidate";
    const title = document.createElement("strong");
    title.textContent = user.email || user.walletAddress || user.userId;
    const identity = document.createElement("small");
    identity.textContent = `User ID: ${user.userId}${user.walletAddress ? ` · Wallet: ${user.walletAddress}` : " · No wallet linked"}`;
    const balance = document.createElement("span");
    balance.textContent = `${user.balance} total · ${user.reserved} reserved · ${user.available} available credits`;
    card.append(title, identity, balance);
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = selectedUser?.userId === user.userId ? "Selected account" : "Select account";
    select.addEventListener("click", () => {
      selectedUser = user;
      pendingGrant = null;
      creditAmount.value = "";
      grantForm.hidden = false;
      showAccounts(users);
      creditResult.textContent = `Selected ${user.userId}. Confirm the account details above before granting.`;
    });
    card.append(select);
    creditAccount.append(card);
  }
}

document.querySelector("#credit-identifier").addEventListener("input", () => {
  selectedUser = null; pendingGrant = null; grantForm.hidden = true;
  creditAccount.textContent = "Search again after changing the identifier.";
});

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = lookupForm.querySelector("button");
  button.disabled = true;
  selectedUser = null;
  pendingGrant = null;
  grantForm.hidden = true;
  creditResult.textContent = "Looking up account…";
  try {
    const result = await requestOperation("lookupTestCredits", {
      action: "lookup", identifier: document.querySelector("#credit-identifier").value.trim(),
    });
    const matches = Array.isArray(result?.matches) ? result.matches : [];
    showAccounts(matches);
    creditResult.textContent = result?.truncated
      ? "The account scan reached its limit. Search by wallet or user ID to select the intended account."
      : `${matches.length} account${matches.length === 1 ? "" : "s"} found. Choose by wallet, user ID, and balance.`;
  } catch (error) {
    showAccounts([]);
    creditResult.textContent = error instanceof Error ? error.message : "Account lookup failed.";
  } finally { button.disabled = false; }
});

grantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedUser) return;
  const amount = Number(creditAmount.value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    creditResult.textContent = "Enter a positive whole-number credit amount."; return;
  }
  const key = `${selectedUser.userId}:${amount}`;
  if (!pendingGrant || pendingGrant.key !== key) pendingGrant = { key, requestId: crypto.randomUUID() };
  const button = document.querySelector("#grant-credits");
  button.disabled = true;
  creditResult.textContent = "Recording grant in Convex…";
  try {
    const result = await requestOperation("grantTestCredits", {
      action: "grant", userId: selectedUser.userId, expectedEmail: selectedUser.email,
      amount, requestId: pendingGrant.requestId,
    });
    pendingGrant = null;
    selectedUser = { ...selectedUser, balance: result.balance,
      available: result.balance - selectedUser.reserved };
    showAccounts([selectedUser]);
    creditResult.textContent = `${result.duplicate ? "Already recorded" : "Granted"} ${amount} app credits. Ledger reference: ${result.reference}.`;
    creditAmount.value = "";
  } catch (error) {
    creditResult.textContent = `${error instanceof Error ? error.message : "Grant failed."} Retry keeps the same request ID.`;
  } finally { button.disabled = false; }
});

window.addEventListener("operator:ready", () => { void loadLiteMode(); }, { once: true });

const chargingValue = document.querySelector("#charging-value");
const chargingDetail = document.querySelector("#charging-detail");
const chargingButton = document.querySelector("#toggle-charging");
let creditControl = null;

async function loadCreditCharging() {
  chargingButton.disabled = true;
  try {
    creditControl = await requestOperation("readCreditCharging", { action: "controlRead" });
    const enabled = creditControl.chargingEnabled === true;
    chargingValue.textContent = enabled ? "App-credit charging ON" : "App-credit charging PAUSED";
    chargingButton.textContent = enabled ? "Pause charging for tests" : "Resume charging";
    chargingButton.disabled = !creditControl.enabled;
    chargingDetail.textContent = enabled
      ? "New analysis reservations will charge app credits after validated outputs."
      : "New analysis reservations will release all held app credits at completion. Existing reservations keep the setting from when they started; provider costs still accrue. An available credit balance is still required to start.";
  } catch (error) {
    creditControl = null;
    chargingValue.textContent = "Charging status unavailable";
    chargingDetail.textContent = error instanceof Error ? error.message : "Could not read credit charging.";
  }
}

chargingButton.addEventListener("click", async () => {
  if (!creditControl) return;
  chargingButton.disabled = true;
  try {
    await requestOperation("setCreditCharging", { action: "controlSet",
      chargingEnabled: !creditControl.chargingEnabled, expectedVersion: creditControl.version });
    await loadCreditCharging();
  } catch (error) {
    chargingDetail.textContent = error instanceof Error ? error.message : "Could not change credit charging.";
    chargingButton.disabled = false;
  }
});

window.addEventListener("operator:ready", () => void loadCreditCharging(), { once: true });
