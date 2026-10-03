const loginShell = document.querySelector("#login-shell");
const consoleShell = document.querySelector("#console-shell");
const loginForm = document.querySelector("#login-form");
const loginState = document.querySelector("#login-state");

async function sessionState() {
  const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
  return response.ok ? response.json() : { authenticated: false };
}

window.operatorRequest = async (path, options = {}) => {
  const method = options.method || "GET";
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
};

async function refreshAuth() {
  try {
    const state = await sessionState();
    loginShell.hidden = state.authenticated === true;
    consoleShell.hidden = !loginShell.hidden;
    if (state.authenticated) window.dispatchEvent(new Event("operator:ready"));
    if (!state.authenticated) document.querySelector("#admin-secret").focus();
  } catch {
    loginShell.hidden = false;
    consoleShell.hidden = true;
    loginState.textContent = "The local console service is unavailable.";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  loginState.textContent = "Checking local operator secret…";
  try {
    const response = await fetch("/api/session/login", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password: document.querySelector("#admin-secret").value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Sign in failed (${response.status}).`);
    location.reload();
  } catch (error) {
    loginState.textContent = error instanceof Error ? error.message : "Sign in failed.";
  } finally { button.disabled = false; }
});

document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/session/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
  location.reload();
});

void refreshAuth();
