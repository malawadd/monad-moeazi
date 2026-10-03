const programList = document.querySelector("#program-list");
const programState = document.querySelector("#program-state");
const providersList = document.querySelector("#providers-list");
const providersState = document.querySelector("#providers-state");
let platformCatalog = null;
let platformAvailability = {};

async function loadPlatformProviders() {
  const refresh = document.querySelector("#refresh-providers");
  refresh.disabled = true;
  providersState.textContent = "Loading…";
  try {
    const response = record(await requestOperation("platformProviders"));
    const providers = record(response.providers);
    platformAvailability = providers;
    platformCatalog = record(response.models);
    providersList.replaceChildren();
    for (const provider of ["deepseek", "openai", "openrouter"]) {
      const state = record(providers[provider]);
      const card = make("article", "spec-card");
      card.append(make("span", "kind-tag", provider.toUpperCase()),
        make("h3", "", state.credentialLoaded ? "Credential loaded in agent runtime"
          : "No Moeazi-owned credential loaded"));
      card.append(make("p", "section-lead", provider === "openrouter"
        ? stringAt(state, "reason") || "Add a key to enable OpenRouter models for mobile roles."
        : "Presence does not verify account balance, model access, or a successful call."));
      const form = make("form", "provider-key-form");
      const label = make("label", "", `Add or replace ${provider} key`);
      const input = make("input", "");
      input.type = "password";
      input.autocomplete = "new-password";
      input.minLength = 12;
      input.maxLength = 512;
      input.required = true;
      label.append(input);
      const button = make("button", "", "Save key and reload agents");
      button.type = "submit";
      const message = make("span", "", "Key stays on this machine; agents restart briefly.");
      message.setAttribute("role", "status");
      form.append(label, button, message);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        message.textContent = "Saving key and reloading agents…";
        try {
          const saved = await window.operatorRequest("/api/operator/providers/key", {
            method: "POST", body: { provider, apiKey: input.value },
          });
          if (!saved.ok) throw new Error(saved.data?.error || `Key save failed (${saved.status}).`);
          input.value = "";
          message.textContent = "Saved and agents reloaded.";
          await loadPlatformProviders();
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "Could not save key.";
        } finally { button.disabled = false; }
      });
      card.append(form);
      providersList.append(card);
    }
    providersState.textContent = "Runtime configuration · unverified with providers";
    void loadPrograms();
  } catch (error) {
    platformCatalog = null;
    platformAvailability = {};
    providersList.replaceChildren(make("p", "empty-state",
      error instanceof Error ? error.message : "Agent runtime status is unavailable."));
    providersState.textContent = "Unavailable";
  } finally { refresh.disabled = false; }
}

function mobileModelEditor(version) {
  const routes = Array.isArray(record(version.model).routes) ? version.model.routes : [];
  if (!routes.length || !platformCatalog) return make("p", "section-lead",
    "Model editing is available when agent runtime status loads.");
  const form = make("form", "model-editor");
  form.id = "mobile-model-editor";
  form.append(make("h4", "", "Prepare the next mobile agent release"),
    make("p", "section-lead", "Select every role. Saving freezes a model candidate; customer capital authority stays unchanged."));
  const rows = make("div", "model-route-rows");
  for (const routeValue of routes) {
    const route = record(routeValue);
    const row = make("div", "model-route-row");
    row.dataset.slot = stringAt(route, "slot");
    const label = make("strong", "mono", stringAt(route, "slot"));
    const provider = make("select", "route-provider");
    for (const name of ["deepseek", "openai", "openrouter"]) {
      const option = new Option(name, name);
      option.disabled = !record(platformAvailability[name]).credentialLoaded;
      provider.add(option);
    }
    provider.value = stringAt(route, "provider");
    const model = make("select", "route-model");
    const routerModel = make("input", "route-router-model");
    routerModel.type = "text";
    routerModel.placeholder = "author/model";
    routerModel.maxLength = 128;
    routerModel.value = stringAt(route, "provider") === "openrouter" ? stringAt(route, "model") : "";
    function fillModels() {
      const router = provider.value === "openrouter";
      model.hidden = router;
      routerModel.hidden = !router;
      const previous = model.value || stringAt(route, "model");
      model.replaceChildren();
      for (const name of platformCatalog[provider.value] || []) model.add(new Option(name, name));
      if ([...model.options].some((item) => item.value === previous)) model.value = previous;
    }
    provider.addEventListener("change", fillModels);
    fillModels();
    row.append(label, provider, model, routerModel);
    rows.append(row);
  }
  form.append(rows);
  const submit = make("button", "", "Save candidate version");
  submit.type = "submit";
  const message = make("span", "", "No customer signature or vault change");
  message.setAttribute("role", "status");
  const actions = make("div", "actions");
  actions.append(submit, message);
  form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const choices = [...rows.children].map((row) => ({ slot: row.dataset.slot,
      provider: row.querySelector(".route-provider").value,
      model: row.querySelector(".route-provider").value === "openrouter"
        ? row.querySelector(".route-router-model").value.trim()
        : row.querySelector(".route-model").value }));
    submit.disabled = true;
    message.textContent = "Saving candidate…";
    try {
      const result = record(await requestOperation("createMobileModelCandidate", {
        baseVersionId: stringAt(version, "programVersionId"), choices,
      }));
      message.textContent = result.duplicate ? "No changes; current version retained."
        : `Candidate version ${result.version} saved. Customer assignments remain unchanged.`;
      if (!result.duplicate) await loadPrograms();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not save candidate.";
    } finally { submit.disabled = false; }
  });
  return form;
}

function renderVersion(versionValue) {
  const version = record(versionValue);
  const section = make("section", "program-version");
  section.append(make("h4", "", `Frozen version ${version.version ?? "unknown"}`));
  const grid = make("div", "spec-fields");
  field(grid, "Strategy artifact", stringAt(version, "strategyArtifactHash"), true);
  field(grid, "Policy", JSON.stringify(record(version.policy)), true);
  field(grid, "Agent team", JSON.stringify(record(version.team)), true);
  section.append(grid);
  const routes = Array.isArray(record(version.model).routes) ? version.model.routes : [];
  const modelHeading = make("p", "field-name", "Frozen agent routes");
  section.append(modelHeading);
  const routeGrid = make("div", "spec-fields");
  for (const routeValue of routes) {
    const route = record(routeValue);
    field(routeGrid, stringAt(route, "slot"),
      `${stringAt(route, "provider")} · ${stringAt(route, "model")} · ${stringAt(route, "credentialSource")}`);
  }
  section.append(routes.length ? routeGrid : make("p", "empty-state", "No model routes returned."));
  return section;
}

async function loadPrograms() {
  const refresh = document.querySelector("#refresh-programs");
  refresh.disabled = true;
  programState.textContent = "Loading…";
  try {
    const response = record(await requestOperation("listPrograms"));
    const programs = Array.isArray(response.programs) ? response.programs : [];
    programList.replaceChildren();
    for (const programValue of programs) {
      const program = record(programValue);
      const card = make("article", "spec-card");
      card.append(make("span", "kind-tag",
        stringAt(program, "ownership") === "moeazi_mobile" ? "MOEAZI MOBILE" : "OPERATOR PROGRAM"),
        make("h3", "", stringAt(program, "name") || stringAt(program, "programId")));
      const versions = Array.isArray(program.versions) ? program.versions : [];
      for (const version of versions) {
        const section = renderVersion(version);
        const released = stringAt(program, "releasedVersionId") === stringAt(version, "programVersionId");
        if (released) {
          section.prepend(make("span", "kind-tag", "CURRENT AGENT RELEASE"));
        } else if (stringAt(program, "ownership") === "moeazi_mobile") {
          const actions = make("div", "actions");
          const button = make("button", "", "Release models for new analyses");
          button.type = "button";
          const message = make("span", "", "Existing mandates and vaults stay pinned. New analysis jobs use this release; already queued jobs keep theirs. OpenRouter checks are paid only when clicked (listed-price estimate ≤ $0.02)." );
          message.setAttribute("role", "status");
          button.addEventListener("click", async () => {
            button.disabled = true;
            message.textContent = "Checking runtime keys and releasing…";
            try {
              await requestOperation("releaseMobileVersion", {
                programVersionId: stringAt(version, "programVersionId"),
              });
              await loadPrograms();
            } catch (error) {
              message.textContent = error instanceof Error ? error.message : "Release failed.";
              button.disabled = false;
            }
          });
          actions.append(button, message);
          section.append(actions);
        }
        card.append(section);
      }
      if (stringAt(program, "ownership") === "moeazi_mobile" && versions.length) {
        card.append(mobileModelEditor(record(versions[0])));
      }
      if (!versions.length) card.append(make("p", "empty-state", "No frozen version yet."));
      programList.append(card);
    }
    if (!programs.length) programList.append(make("p", "empty-state", "No managed programs were returned."));
    programState.textContent = `${programs.length} program${programs.length === 1 ? "" : "s"}${response.truncated ? " · first 50 owned" : ""}`;
  } catch (error) {
    programList.replaceChildren(make("p", "empty-state",
      error instanceof Error ? error.message : "Program catalog unavailable."));
    programState.textContent = "Unavailable";
  } finally { refresh.disabled = false; }
}

document.querySelector("#refresh-providers").addEventListener("click", () => void loadPlatformProviders());
document.querySelector("#refresh-programs").addEventListener("click", () => void loadPrograms());
window.addEventListener("operator:ready", () => void loadPlatformProviders(), { once: true });
