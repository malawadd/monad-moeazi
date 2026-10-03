import { platformModels, safeOpenRouterPreferences, type AccessibleModel,
  type ModelProvider, type ModelRoute, type ModelRoutingDocument, type ProviderConnection } from "./modelProviders";

export const routeLabel = (slot: string) => ({ specialist_default: "Specialist default", synthesis: "Final synthesis",
  critic: "Critic", arbiter: "Max arbiter", synthesis_primary: "Primary synthesis",
  synthesis_challenger: "Challenger synthesis", policy_draft: "Policy drafting" }[slot]
  ?? slot.replace(/^role:/, "").replaceAll("_", " "));

export function modelsFor(route: ModelRoute, connections: ProviderConnection[]): AccessibleModel[] {
  if (route.credentialSource === "platform" && route.provider !== "openrouter") return platformModels[route.provider];
  return connections.find((item) => item._id === route.connectionId)?.models ?? [];
}

function priced(route: ModelRoute, model: AccessibleModel | undefined): ModelRoute {
  return { ...route,
    inputPriceMicrousdPerMillion: model
      ? route.provider === "openrouter" ? model.maximumInputPriceMicrousdPerMillion ?? 0 : model.inputPriceMicrousdPerMillion : 0,
    cachedInputPriceMicrousdPerMillion: model?.cachedInputPriceMicrousdPerMillion ?? 0,
    outputPriceMicrousdPerMillion: model
      ? route.provider === "openrouter" ? model.maximumOutputPriceMicrousdPerMillion ?? 0 : model.outputPriceMicrousdPerMillion : 0,
    estimatedInputPriceMicrousdPerMillion: route.provider === "openrouter" ? model?.inputPriceMicrousdPerMillion : undefined,
    estimatedOutputPriceMicrousdPerMillion: route.provider === "openrouter" ? model?.outputPriceMicrousdPerMillion : undefined };
}

export function chooseProviderSource(document: ModelRoutingDocument, provider: ModelProvider,
  source: string, connections: ProviderConnection[]): ModelRoutingDocument {
  const connection = connections.find((item) => item._id === source && item.provider === provider && item.status === "verified");
  if (source !== "platform" && !connection) throw new Error("Choose a verified provider connection.");
  if (source === "platform" && provider === "openrouter") throw new Error("OpenRouter requires your key.");
  return { ...document, routes: document.routes.map((route) => {
    if (route.provider !== provider) return route;
    const updated: ModelRoute = { ...route, credentialSource: connection ? "byok" : "platform",
      connectionId: connection?._id };
    return priced(updated, modelsFor(updated, connections).find((item) => item.id === updated.model));
  }) };
}

export function chooseRouteModel(document: ModelRoutingDocument, slot: string,
  modelId: string, connections: ProviderConnection[]): ModelRoutingDocument {
  return { ...document, routes: document.routes.map((route) => route.slot === slot
    ? priced({ ...route, model: modelId }, modelsFor(route, connections).find((item) => item.id === modelId)) : route) };
}

export function chooseRouteProvider(document: ModelRoutingDocument, slot: string,
  provider: ModelProvider, connections: ProviderConnection[]): ModelRoutingDocument {
  const current = document.routes.find((item) => item.slot === slot);
  if (!current) return document;
  const peer = document.routes.find((item) => item.provider === provider);
  const connection = peer?.credentialSource === "byok"
    ? connections.find((item) => item._id === peer.connectionId && item.status === "verified")
    : provider === "openrouter" ? connections.find((item) => item.provider === provider && item.status === "verified") : undefined;
  if (provider === "openrouter" && !connection) throw new Error("Connect an OpenRouter key first.");
  const candidate: ModelRoute = { ...current, provider, credentialSource: connection ? "byok" : "platform",
    connectionId: connection?._id, openrouter: provider === "openrouter" ? current.openrouter ?? safeOpenRouterPreferences() : undefined };
  const model = modelsFor(candidate, connections)[0];
  return { ...document, routes: document.routes.map((route) => route.slot === slot
    ? priced({ ...candidate, model: model?.id ?? current.model }, model) : route) };
}

export function routeProblems(document: ModelRoutingDocument, connections: ProviderConnection[]) {
  return document.routes.flatMap((route) => {
    const issues: string[] = [];
    const source = route.credentialSource === "byok" ? "your provider account" : "Moeazi credits";
    const connection = connections.find((item) => item._id === route.connectionId);
    if (route.credentialSource === "byok" && (!connection || connection.status !== "verified")) {
      issues.push(`${routeLabel(route.slot)} · ${route.model}: connect or verify the selected ${route.provider} key.`);
    }
    if (route.credentialSource === "byok" && connection
      && !connection.capabilities.compatibleModels?.includes(route.model)) {
      issues.push(`${routeLabel(route.slot)} · ${route.model}: compatibility is untested for your key.`);
    }
    if (route.inputPriceMicrousdPerMillion <= 0 || route.outputPriceMicrousdPerMillion <= 0) {
      issues.push(`${routeLabel(route.slot)} · ${route.model} (${source}): pricing is unknown. Choose a priced model or enter confirmed rates.`);
    }
    return issues;
  });
}
