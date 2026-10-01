import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { connectorWorker } from "./mobileConnectorWorker";
import { financeWorker } from "./financeWorker";
import { broadWorkerCredentialMatches, handleSimulationIdentityRequest } from "./simulationHttp";
import { gatewayCredentialRequest } from "./gatewayCredentialHttp";
import { anyApi } from "convex/server";

const http = httpRouter();

for (const operation of ["prepare", "read", "claim", "outcome", "confirm"] as const) {
  http.route({ path: `/managed-spot-funding/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = process.env.MANAGED_SPOT_INGRESS_SECRET;
      if (!secret || secret.length < 32
        || request.headers.get("authorization") !== `Bearer ${secret}`) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      try {
        const payload = await request.json();
        const functionRef = internal.managedSpotFundingOperations[operation];
        const result = operation === "read"
          ? await ctx.runQuery(internal.managedSpotFundingOperations.read, payload)
          : await ctx.runMutation(functionRef as typeof internal.managedSpotFundingOperations.prepare,
            payload);
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Funding operation failed" }, 409);
      }
    }) });
}

for (const operation of ["context", "claim", "outcome", "bind"] as const) {
  http.route({ path: `/managed-spot-vault/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = process.env.MANAGED_SPOT_INGRESS_SECRET;
      if (!secret || secret.length < 32
        || request.headers.get("authorization") !== `Bearer ${secret}`) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      try {
        const payload = await request.json();
        const result = operation === "context"
          ? await ctx.runQuery(internal.managedSpotMandates.getProvisioningContext, payload)
          : operation === "claim"
            ? await ctx.runMutation(internal.managedSpotMandates.claimProvisioning, payload)
            : operation === "outcome"
              ? await ctx.runMutation(internal.managedSpotMandates.recordProvisioningOutcome, payload)
              : await ctx.runMutation(internal.managedSpotMandates.bindDeployedVault, payload);
        return result ? jsonResponse(result) : jsonResponse({ error: "Vault context unavailable" }, 409);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Vault operation failed" }, 409);
      }
    }) });
}

http.route({ path: "/execution-gateway/credential", method: "POST",
  handler: gatewayCredentialRequest });

http.route({ path: "/simulation-worker", method: "POST",
  handler: httpAction(handleSimulationIdentityRequest) });

function getWorkerSecret() {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    throw new Error("WORKER_SHARED_SECRET must be configured before using worker HTTP routes.");
  }
  return secret;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

// Native activation is deliberately separate from /worker. The simulation worker
// credential accepted by that broad legacy ingress cannot issue live authority.
for (const operation of ["context", "receipt"] as const) {
  http.route({ path: `/native-finance-activation/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      try {
        const payload = await request.json();
        const result = operation === "context"
          ? await ctx.runQuery(anyApi.managedProgramActivation.getContext, payload)
          : await ctx.runMutation(anyApi.managedProgramActivation.recordNativeReceipt, payload);
        return result ? jsonResponse(result) : jsonResponse({ error: "Activation context unavailable" }, 409);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    }) });
}

http.route({ path: "/native-vault-finance/context", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      const result = await ctx.runQuery(internal.managedSpotMandates.getFinanceContext, payload);
      return result ? jsonResponse(result) : jsonResponse({ error: "Funded mandate unavailable" }, 409);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-vault-finance/receipt", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      return jsonResponse(await ctx.runMutation(
        internal.managedProgramActivation.recordNativeVaultReceipt, payload));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

for (const operation of ["context", "claim", "outcome"] as const) {
  http.route({ path: `/native-vault-stop/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      try {
        const payload = await request.json();
        const result = operation === "context"
          ? await ctx.runQuery(internal.managedVaultStop.context, payload)
          : operation === "claim"
            ? await ctx.runMutation(internal.managedVaultStop.claim, payload)
            : await ctx.runMutation(internal.managedVaultStop.outcome, payload);
        return result ? jsonResponse(result) : jsonResponse({ error: "Vault stop context unavailable" }, 409);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Vault stop failed" }, 409);
      }
    }) });
}

for (const operation of ["context", "confirm"] as const) {
  http.route({ path: `/native-vault-release/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      try {
        const payload = await request.json();
        const result = operation === "context"
          ? await ctx.runQuery(anyApi.managedVaultRelease.context, payload)
          : await ctx.runMutation(anyApi.managedVaultRelease.confirm, payload);
        return result ? jsonResponse(result) : jsonResponse({ error: "Vault release context unavailable" }, 409);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Vault release failed" }, 409);
      }
    }) });
}

http.route({ path: "/native-finance-trade/confirmed", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      return jsonResponse(await ctx.runMutation(anyApi.managedTradeReceipt.recordConfirmedUniswapBuy,
        payload));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-finance-trade/vault-confirmed", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      return jsonResponse(await ctx.runMutation(
        internal.managedTradeReceipt.recordConfirmedVaultBuy, payload));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-finance-trade/reconcile-context", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      const result = await ctx.runQuery(anyApi.managedTradeRecovery.getReconciliationContext, payload);
      return result ? jsonResponse(result) : jsonResponse({ error: "Historical trade context unavailable" }, 409);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-finance-trade/closed", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      return jsonResponse(await ctx.runMutation(anyApi.managedProgramClosure.recordConfirmedFlat,
        payload));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-finance-trade/close-context", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      const result = await ctx.runQuery(anyApi.managedProgramCloseContext.getCloseContext, payload);
      return result ? jsonResponse(result) : jsonResponse({ error: "Stopped close context unavailable" }, 409);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({ path: "/native-finance-trade/observed-flat", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${getWorkerSecret()}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await request.json();
      return jsonResponse(await ctx.runMutation(anyApi.managedProgramClosure.recordObservedFlat,
        payload));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  }) });

http.route({
  path: "/worker",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("authorization");
      if (!broadWorkerCredentialMatches(authHeader, getWorkerSecret(), process.env.SIMULATION_WORKER_SECRET)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body = (await request.json()) as { command?: string; payload?: Record<string, unknown> };
      const payload = body.payload ?? {};
      const connector = await connectorWorker(ctx, body.command ?? "", payload);
      if (connector.handled) return jsonResponse(connector.result);
      const finance = await financeWorker(ctx, body.command ?? "", payload);
      if (finance.handled) return jsonResponse(finance.result);

      switch (body.command) {
        case "listRunnableAccounts":
          return jsonResponse(
            await ctx.runQuery(internal.worker.listRunnableAccounts, {
              includeReady: payload.includeReady as boolean | undefined,
            }),
          );
        case "acquireExecutionLease":
          return jsonResponse(
            await ctx.runMutation(internal.worker.acquireExecutionLease, {
              strategyAccountId: payload.strategyAccountId as any,
              holderId: payload.holderId as string,
              ttlMs: payload.ttlMs as number | undefined,
            }),
          );
        case "heartbeatExecutionLease":
          return jsonResponse(
            await ctx.runMutation(internal.worker.heartbeatExecutionLease, {
              strategyAccountId: payload.strategyAccountId as any,
              holderId: payload.holderId as string,
              ttlMs: payload.ttlMs as number | undefined,
            }),
          );
        case "releaseExecutionLease":
          return jsonResponse(
            await ctx.runMutation(internal.worker.releaseExecutionLease, {
              strategyAccountId: payload.strategyAccountId as any,
              holderId: payload.holderId as string,
            }),
          );
        case "recordExecution":
          return jsonResponse(await ctx.runMutation(internal.worker.recordExecution, payload as any));
        case "recordSnapshot":
          return jsonResponse(await ctx.runMutation(internal.worker.recordSnapshot, payload as any));
        case "recordAlert":
          return jsonResponse(await ctx.runMutation(internal.worker.recordAlert, payload as any));
        case "recordIncident":
          return jsonResponse(await ctx.runMutation(internal.mutations.recordIncidentEvent, payload as any));
        case "recordDependencySafetyBundle":
          return jsonResponse(await ctx.runMutation(internal.dependencySafety.recordBundle, payload as any));
        case "getDependencySafetyProjection":
          return jsonResponse(await ctx.runQuery(internal.dependencySafety.getAccountProjection, payload as any));
        case "getDependencySafetyScopeProjection":
          return jsonResponse(await ctx.runQuery(internal.dependencySafety.getScopeProjection, payload as any));
        case "projectEvidenceLifecycleDecision":
          return jsonResponse(await ctx.runMutation(internal.evidenceLifecycle.projectDecision, payload as any));
        case "projectEvidenceLifecycleStatus":
          return jsonResponse(await ctx.runMutation(internal.evidenceLifecycle.projectStatus, payload as any));
        case "getEvidenceLifecycleDecision":
          return jsonResponse(await ctx.runQuery(internal.evidenceLifecycle.getDecision, payload as any));
        case "claimNextAnalysisJob":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.claimNextAnalysisJob, payload as any));
        case "claimAnalysisJob":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.claimAnalysisJob, payload as any));
        case "heartbeatAnalysisJob":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.heartbeatAnalysisJob, payload as any));
        case "completeAnalysisJob":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.completeAnalysisJob, payload as any));
        case "failAnalysisJob":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.failAnalysisJob, payload as any));
        case "recordPolicyDraft":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.recordPolicyDraft, payload as any));
        case "recordTradeProposal":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.recordTradeProposal, payload as any));
        case "transitionTradeProposal":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.transitionTradeProposal, payload as any));
        case "getAnalysisJob":
          return jsonResponse(await ctx.runQuery(internal.agentWorker.getAnalysisJob, payload as any));
        case "getAgentScheduleProfile":
          return jsonResponse(await ctx.runQuery(internal.agentRuntime.getScheduleProfile, payload as any));
        case "getAgentExecutionContext":
          return jsonResponse(await ctx.runQuery(internal.agentRuntime.getAgentExecutionContext, payload as any));
        case "getTradeProposalExecutionContext":
          return jsonResponse(await ctx.runQuery(internal.agentRuntime.getTradeProposalExecutionContext, payload as any));
        case "enqueueScheduledAnalysis":
          return jsonResponse(await ctx.runMutation(internal.agentRuntime.enqueueScheduledAnalysis, payload as any));
        case "recordShadowExecution":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.recordShadowExecution, payload as any));
        case "listActivePublicDemand":
          return jsonResponse(await ctx.runQuery(internal.agentWorker.listActivePublicDemand, {}));
        case "grantAgentCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.grantCredits, payload as any));
        case "reserveAgentCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.reserveCredits, payload as any));
        case "settleAgentCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.settleCredits, payload as any));
        case "releaseAgentCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.releaseCredits, payload as any));
        case "getResearchCreditContext":
          return jsonResponse(await ctx.runQuery(internal.agentCredits.researchCreditContext, payload as any));
        case "reserveResearchCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.reserveResearchCredits, payload as any));
        case "settleResearchCredits":
          return jsonResponse(await ctx.runMutation(internal.agentCredits.settleResearchCredits, payload as any));
        case "getProviderOwnerContext":
          return jsonResponse(await ctx.runQuery(internal.agentModels.getProviderOwnerContext, payload as any));
        case "recordProviderConnection":
          return jsonResponse(await ctx.runMutation(internal.agentModels.recordProviderConnection, payload as any));
        case "updateProviderConnection":
          return jsonResponse(await ctx.runMutation(internal.agentModels.updateProviderConnection, payload as any));
        case "getProviderConnectionForWorker":
          return jsonResponse(await ctx.runQuery(internal.agentModels.getProviderConnectionForWorker, payload as any));
        case "getModelRunConfiguration":
          return jsonResponse(await ctx.runQuery(internal.agentModels.getModelRunConfiguration, payload as any));
        case "listEvaluationModelConfigurations":
          return jsonResponse(await ctx.runQuery(internal.agentEvaluations.listModelConfigurations, payload as any));
        case "getEvaluationModelConfiguration":
          return jsonResponse(await ctx.runQuery(internal.agentEvaluations.getModelConfiguration, payload as any));
        case "getOwnedTeamVersion":
          return jsonResponse(await ctx.runQuery(internal.agentTeamWorker.getOwnedVersion, payload as any));
        case "scheduleDueAnalysisJobs":
          return jsonResponse(await ctx.runMutation(internal.agentScheduler.scheduleDueAnalysisJobs, payload as any));
        case "cancelAutomaticAnalysisJobs":
          return jsonResponse(await ctx.runMutation(internal.agentWorker.cancelAutomaticAnalysisJobs, {}));
        case "finalizeVenueSetup":
          return jsonResponse(await ctx.runMutation(internal.venueSetupWorker.finalizeVenueSetup, payload as any));
        case "getHyperliquidBindingContext":
          return jsonResponse(await ctx.runQuery(internal.venueIntegrations.getHyperliquidBindingContext, payload as any));
        case "registerHyperliquidCredentialBinding":
          return jsonResponse(await ctx.runAction(internal.venueSetupWorker.registerHyperliquidCredentialBinding, payload as any));
        case "failVenueSetup":
          return jsonResponse(await ctx.runMutation(internal.venueSetupWorker.failVenueSetup, payload as any));
        case "updateStrategyState":
          return jsonResponse(await ctx.runMutation(internal.mutations.updateStrategyExecutionState, payload as any));
        case "syncVenueState":
          return jsonResponse(await ctx.runMutation(internal.mutations.syncVenueAccountState, payload as any));
        case "markDepositConfirmed":
          return jsonResponse(await ctx.runMutation(internal.worker.markDepositConfirmed, payload as any));
        case "listPendingWithdrawals":
          return jsonResponse(await ctx.runQuery(internal.worker.listPendingWithdrawals, payload as any));
        case "confirmWithdrawalState":
          return jsonResponse(await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: payload.withdrawalId as any,
            nextStatus: payload.nextStatus as any,
            txHash: payload.txHash as string | undefined,
            note: payload.note as string | undefined,
            failureCode: payload.failureCode as string | undefined,
          }));
        case "getMobileWithdrawalForWorker":
          return jsonResponse(await ctx.runQuery(internal.mobileWithdrawalModel.getInternal, payload as any));
        case "updateMobileWithdrawalStatus":
          return jsonResponse(await ctx.runMutation(internal.mobileWithdrawalModel.updateStatus, payload as any));
        case "simulateExecution":
          return jsonResponse(await ctx.runAction(internal.actions.simulateExecution, payload as any));
        case "executeUniPoolSwap":
          return jsonResponse(await ctx.runAction(internal.actions.executeUniPoolSwap, payload as any));
        case "executeUniRebalance":
          return jsonResponse(await ctx.runAction(internal.actions.executeUniRebalance, payload as any));
        case "executeHLApproveAgent":
          return jsonResponse(await ctx.runAction(internal.actions.executeHLApproveAgent, payload as any));
        case "executeHLOrder":
          return jsonResponse(await ctx.runAction(internal.actions.executeHLOrder, payload as any));
        case "rotateHyperliquidAgent":
          return jsonResponse(await ctx.runAction(internal.actions.rotateHyperliquidAgent, payload as any));
        case "runCanaryChecks":
          return jsonResponse(await ctx.runAction(internal.actions.runCanaryChecks, payload as any));
        case "pauseStrategy":
          return jsonResponse(await ctx.runAction(internal.actions.pauseStrategy, payload as any));
        case "startWithdrawal":
          return jsonResponse(await ctx.runAction(internal.actions.startWithdrawal, payload as any));
        default:
          return jsonResponse({ error: `Unknown worker command: ${body.command ?? "undefined"}` }, 400);
      }
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }),
});

export default http;
