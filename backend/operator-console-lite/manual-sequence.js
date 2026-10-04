(function () {
  const esc = (value) => String(value ?? "");
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, disabled = false) => {
    const node = el("button", "ms-button", text);
    node.type = "button"; node.dataset.action = action; node.disabled = disabled;
    return node;
  };

  window.initManualSequence = function ({ root, request }) {
    if (!root || typeof request !== "function") return;
    const state = { catalog: [], steps: [], preview: null, session: null, poll: 0 };
    root.innerHTML = '<div class="ms-toolbar"><button class="ms-button" data-action="refresh" type="button">Refresh catalog</button><span class="ms-status" aria-live="polite">Loading reviewed function catalog…</span></div><div class="ms-catalog" aria-label="Discovered backend functions"></div><section class="ms-builder"><div class="ms-heading"><h3>Ordered calls</h3><span class="ms-count">0 / 20 steps</span></div><div class="ms-steps"></div><label class="ms-switch"><input type="checkbox" class="ms-continue"> Continue after a definite failure</label><div class="ms-toolbar"><button class="ms-button" data-action="add" type="button">Add function</button><button class="ms-button ms-primary" data-action="preview" type="button">Preview sequence</button><span class="ms-message" role="status" aria-live="polite"></span></div></section><section class="ms-preview" hidden></section><section class="ms-session" hidden></section><section class="ms-history"><div class="ms-heading"><h3>Previous sessions</h3><button class="ms-button" data-action="history" type="button">Reload</button></div><div class="ms-history-list"></div></section>';
    const status = root.querySelector(".ms-status");
    const stepsNode = root.querySelector(".ms-steps");
    const previewNode = root.querySelector(".ms-preview");
    const sessionNode = root.querySelector(".ms-session");
    const message = root.querySelector(".ms-message");

    const change = () => { state.preview = null; previewNode.hidden = true; message.textContent = "Edits cleared the previous preview. Preview again before executing."; };
    const descriptor = (id) => state.catalog.find((item) => item.id === id);
    const renderCatalog = () => {
      const list = root.querySelector(".ms-catalog"); list.replaceChildren();
      for (const item of state.catalog) {
        const card = el("details", "ms-function" + (item.runnable ? " is-ready" : " is-blocked"));
        const summary = el("summary");
        summary.append(el("strong", "", item.title || item.id), el("span", "ms-tag", item.reviewed && item.runnable ? "REVIEWED" : "DISCOVERED · BLOCKED"));
        card.append(summary, el("code", "", item.id), el("p", "", item.effectDescription || "Effects unreviewed."));
        const meta = el("p", "ms-meta", `${item.source} · ${item.kind} · ${item.safety} · ${item.cost?.description || "Cost unreviewed."}`);
        card.append(meta, el("p", "ms-authority", `Required authority · ${item.requiredAuthority || "Unreviewed; execution disabled."}`));
        for (const effect of item.possibleEffects || []) card.append(el("p", "ms-effect", "• " + effect));
        if (!item.runnable) card.append(el("p", "ms-block-reason", item.blockedReason || "No reviewed schema and safety descriptor."));
        else { const schema = el("pre", "ms-schema", JSON.stringify(item.argumentSchema, null, 2)); card.append(el("span", "ms-label", "Reviewed argument schema"), schema); }
        list.append(card);
      }
      if (!state.catalog.length) list.append(el("p", "ms-empty", "No function inventory is available."));
    };
    const renderSteps = () => {
      stepsNode.replaceChildren();
      root.querySelector(".ms-count").textContent = `${state.steps.length} / 20 steps`;
      state.steps.forEach((step, index) => {
        const card = el("article", "ms-step");
        const head = el("div", "ms-step-head");
        head.append(el("strong", "", `STEP ${String(index + 1).padStart(2, "0")}`));
        const actions = el("div", "ms-actions");
        actions.append(button("↑", "up", index === 0), button("↓", "down", index === state.steps.length - 1), button("Remove", "remove"));
        head.append(actions); card.append(head);
        const select = el("select", "ms-select"); select.setAttribute("aria-label", `Function for step ${index + 1}`);
        select.add(new Option("Choose a discovered function", ""));
        for (const item of state.catalog) {
          const option = new Option(`${item.title || item.id} · ${item.source}`, item.id);
          option.disabled = !item.reviewed || !item.runnable; select.add(option);
        }
        select.value = step.functionId || "";
        select.addEventListener("change", () => { step.functionId = select.value; step.identityMode = ""; change(); renderSteps(); });
        card.append(el("label", "ms-label", "Function"), select);
        const selected = descriptor(step.functionId);
        if (selected) {
          card.append(el("p", selected.runnable ? "ms-effect" : "ms-block-reason", selected.runnable ? selected.effectDescription : selected.blockedReason));
          const identity = el("select", "ms-select"); identity.setAttribute("aria-label", `Identity for step ${index + 1}`);
          for (const mode of selected.identityModes || []) identity.add(new Option(mode === "operator" ? "Operator · fixed local identity" : "Fixture · isolated Test Center only", mode));
          if (!selected.identityModes?.length) identity.add(new Option("No permitted identity", ""));
          if (!(selected.identityModes || []).includes(step.identityMode)) step.identityMode = selected.identityModes?.[0] || "";
          identity.value = step.identityMode; identity.addEventListener("change", () => { step.identityMode = identity.value; change(); });
          card.append(el("label", "ms-label", "Identity mode"), identity);
        }
        const args = el("textarea", "ms-json"); args.spellcheck = false; args.value = step.rawArgs;
        args.setAttribute("aria-label", `Raw JSON arguments for step ${index + 1}`); args.addEventListener("input", () => { step.rawArgs = args.value; change(); });
        card.append(el("label", "ms-label", "Raw JSON arguments"), args);
        if (selected?.idempotencyArgument) {
          const key = el("input", "ms-key"); key.value = step.idempotencyKey || ""; key.maxLength = 128;
          key.placeholder = "Optional caller-supplied idempotency key";
          key.addEventListener("input", () => { step.idempotencyKey = key.value; change(); });
          card.append(el("label", "ms-label", "Idempotency key · forwarded once"), key);
        }
        stepsNode.append(card);
        actions.addEventListener("click", (event) => {
          const action = event.target.closest("button")?.dataset.action;
          if (action === "remove") state.steps.splice(index, 1);
          if (action === "up" && index > 0) [state.steps[index - 1], state.steps[index]] = [state.steps[index], state.steps[index - 1]];
          if (action === "down" && index < state.steps.length - 1) [state.steps[index + 1], state.steps[index]] = [state.steps[index], state.steps[index + 1]];
          if (action) { change(); renderSteps(); }
        });
      });
      root.querySelector('[data-action="add"]').disabled = state.steps.length >= 20 || !state.catalog.some((item) => item.runnable);
    };
    const loadCatalog = async () => {
      status.textContent = "Refreshing local source and service inventory…";
      try {
        const data = await request("/api/operator/sequences/catalog", { method: "GET" });
        const nextCatalog = Array.isArray(data.functions) ? data.functions : [];
        const signature = (items) => JSON.stringify(items);
        if (state.catalog.length && signature(state.catalog) !== signature(nextCatalog)) change();
        state.catalog = nextCatalog;
        renderCatalog(); renderSteps();
        status.textContent = `${state.catalog.length} functions discovered · ${state.catalog.filter((item) => item.reviewed && item.runnable).length} reviewed and runnable`;
      } catch (error) { status.textContent = error.message || "Function catalog unavailable."; }
    };
    const renderPreview = (preview) => {
      previewNode.replaceChildren(); previewNode.hidden = false;
      previewNode.append(el("p", "ms-kicker", "EXACT ORDER · NOTHING HAS RUN"), el("h3", "", "Sequence preview"));
      previewNode.append(el("p", "ms-hash", `Confirmation hash · ${preview.hash}`), el("p", "ms-meta", `Catalog ${preview.catalogVersion} · Expires ${new Date(preview.expiresAt).toLocaleString()} · Continue after definite failure: ${preview.continueAfterFailure ? "Yes" : "No"}`));
      for (const step of preview.steps || []) {
        const card = el("article", "ms-preview-step");
        const call = step.function;
        const target = call.target?.module ? `${call.target.module}.${call.target.name}` : `${call.target?.method} ${call.target?.path}`;
        card.append(el("h4", "", `${step.ordinal}. ${call.title} · ${target}`));
        card.append(el("p", "ms-meta", `Identity: ${step.identityMode === "operator" ? "moeazi:operator:local" : "moeazi:fixture:manual-sequence"} · Safety: ${call.safety} · Gate: ${step.gateStatus} · Cost: ${call.cost?.description || "Unknown"}`));
        card.append(el("p", "", call.effectDescription));
        for (const effect of call.possibleEffects || []) card.append(el("p", "ms-effect", "• " + effect));
        card.append(el("p", "ms-authority", `Required authority · ${call.requiredAuthority || "Unreviewed; execution disabled."}`));
        card.append(el("pre", "ms-schema", JSON.stringify(step.args, null, 2)));
        card.append(el("p", "ms-meta", `Idempotency: ${step.idempotencyKey ? "caller key included in the reviewed argument and forwarded for one attempt" : "none supplied"}`));
        previewNode.append(card);
      }
      const confirm = el("label", "ms-confirm");
      const checked = document.createElement("input"); checked.type = "checkbox"; checked.dataset.confirm = "true";
      confirm.append(checked, document.createTextNode(" I reviewed this exact ordered sequence and confirm execution."));
      previewNode.append(confirm);
      if (preview.requiresAcknowledgement) {
        const ack = el("label", "ms-confirm ms-danger"); const box = document.createElement("input"); box.type = "checkbox"; box.dataset.ack = "true";
        ack.append(box, document.createTextNode(" I explicitly acknowledge paid, funded, or live effects listed above.")); previewNode.append(ack);
      }
      const controls = el("div", "ms-toolbar"); controls.append(button("Confirm and run sequence", "execute")); previewNode.append(controls);
    };
    const showSession = (session) => {
      window.clearTimeout(state.poll);
      state.session = session; sessionNode.replaceChildren(); sessionNode.hidden = false;
      sessionNode.append(el("p", "ms-kicker", "ORDERED RESULTS"), el("h3", "", `Session ${session.sessionId}`), el("p", "ms-meta", `Status · ${session.status} · ${new Date(session.updatedAt).toLocaleString()}`));
      for (const step of session.steps || []) {
        const row = el("article", "ms-result"); row.append(el("div", "ms-step-head", `Step ${step.ordinal} · ${step.functionId}`), el("span", `ms-outcome ${step.status}`, step.status));
        if (step.error) row.append(el("p", "ms-block-reason", step.error.message || JSON.stringify(step.error)));
        if (step.result !== undefined && step.result !== null) row.append(el("pre", "ms-schema", JSON.stringify(step.result, null, 2)));
        sessionNode.append(row);
      }
      sessionNode.append(button("Export redacted session JSON", "export"));
      if (session.status === "running") state.poll = window.setTimeout(async () => {
        try { showSession(await request(`/api/operator/sequences/sessions/${encodeURIComponent(session.sessionId)}`, { method: "GET" })); }
        catch (error) { sessionNode.append(el("p", "ms-block-reason", error.message || "Could not refresh the running session.")); }
      }, 900);
    };
    const loadHistory = async () => {
      const list = root.querySelector(".ms-history-list"); list.replaceChildren();
      try {
        const data = await request("/api/operator/sequences/sessions?limit=30", { method: "GET" });
        for (const session of data.sessions || []) {
          const row = el("div", "ms-history-row"); row.append(el("span", "", `${session.status} · ${new Date(session.updatedAt).toLocaleString()}`), button(`Open ${session.sessionId.slice(0, 8)}`, "open-session"));
          row.querySelector("button").dataset.sessionId = session.sessionId; list.append(row);
        }
        if (!list.childElementCount) list.append(el("p", "ms-empty", "No persisted sequence sessions yet."));
      } catch (error) { list.append(el("p", "ms-block-reason", error.message || "Session history is unavailable.")); }
    };
    root.addEventListener("click", async (event) => {
      const target = event.target.closest("button"); if (!target) return;
      const action = target.dataset.action;
      if (action === "refresh") return void loadCatalog();
      if (action === "history") return void loadHistory();
      if (action === "add") { state.steps.push({ functionId: "", identityMode: "operator", rawArgs: "{}", idempotencyKey: "" }); change(); renderSteps(); return; }
      if (action === "preview") {
        message.textContent = "Validating locally; no function is invoked during preview…";
        try {
          const steps = state.steps.map((step, index) => {
            let args; try { args = JSON.parse(step.rawArgs); } catch { throw new Error(`Step ${index + 1}: arguments are not valid JSON.`); }
            if (!step.functionId) throw new Error(`Step ${index + 1}: choose a function.`);
            return { functionId: step.functionId, args, identityMode: step.identityMode, ...(step.idempotencyKey ? { idempotencyKey: step.idempotencyKey } : {}) };
          });
          state.preview = await request("/api/operator/sequences/preview", { method: "POST", body: { steps, continueAfterFailure: root.querySelector(".ms-continue").checked } });
          renderPreview(state.preview); message.textContent = "Preview ready. Review every argument and possible effect.";
        } catch (error) { state.preview = null; previewNode.hidden = true; message.textContent = error.message || "Preview failed."; }
      }
      if (action === "execute") {
        const confirmed = previewNode.querySelector("[data-confirm]")?.checked;
        const acknowledged = previewNode.querySelector("[data-ack]")?.checked === true;
        if (!confirmed || (state.preview.requiresAcknowledgement && !acknowledged)) { message.textContent = "Confirm the exact preview and any required high-impact acknowledgement."; return; }
        target.disabled = true;
        try {
          const result = await request("/api/operator/sequences/execute", { method: "POST", body: { previewId: state.preview.previewId, hash: state.preview.hash, acknowledgeHighImpact: acknowledged } });
          state.preview = null; showSession(await request(`/api/operator/sequences/sessions/${encodeURIComponent(result.sessionId)}`, { method: "GET" }));
          message.textContent = "Execution started once; mutations are not retried."; await loadHistory();
        } catch (error) { message.textContent = error.message || "Sequence execution failed."; target.disabled = false; }
      }
      if (action === "open-session") {
        try { showSession(await request(`/api/operator/sequences/sessions/${encodeURIComponent(target.dataset.sessionId)}`, { method: "GET" })); }
        catch (error) { message.textContent = error.message || "Could not reopen session."; }
      }
      if (action === "export" && state.session) {
        try {
          const data = await request(`/api/operator/sequences/sessions/${encodeURIComponent(state.session.sessionId)}/export`, { method: "GET" });
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `manual-sequence-${state.session.sessionId}.json`; link.click(); URL.revokeObjectURL(link.href);
        } catch (error) { message.textContent = error.message || "Could not export session."; }
      }
    });
    root.querySelector(".ms-continue").addEventListener("change", change);
    void Promise.all([loadCatalog(), loadHistory()]);
  };
})();
