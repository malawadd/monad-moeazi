/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountWallets from "../accountWallets.js";
import type * as actions from "../actions.js";
import type * as agentActions from "../agentActions.js";
import type * as agentCredits from "../agentCredits.js";
import type * as agentEvaluations from "../agentEvaluations.js";
import type * as agentModels from "../agentModels.js";
import type * as agentMutations from "../agentMutations.js";
import type * as agentProfiles from "../agentProfiles.js";
import type * as agentQueries from "../agentQueries.js";
import type * as agentRuntime from "../agentRuntime.js";
import type * as agentScheduler from "../agentScheduler.js";
import type * as agentSchema from "../agentSchema.js";
import type * as agentTeamArchive from "../agentTeamArchive.js";
import type * as agentTeamMigration from "../agentTeamMigration.js";
import type * as agentTeamModelDefaults from "../agentTeamModelDefaults.js";
import type * as agentTeamMutations from "../agentTeamMutations.js";
import type * as agentTeamQueries from "../agentTeamQueries.js";
import type * as agentTeamWorker from "../agentTeamWorker.js";
import type * as agentValidators from "../agentValidators.js";
import type * as agentWorker from "../agentWorker.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as dashboardPreferences from "../dashboardPreferences.js";
import type * as dependencySafety from "../dependencySafety.js";
import type * as dependencySafetySchema from "../dependencySafetySchema.js";
import type * as dependencySafetyValidators from "../dependencySafetyValidators.js";
import type * as evidenceLifecycle from "../evidenceLifecycle.js";
import type * as evidenceLifecycleSchema from "../evidenceLifecycleSchema.js";
import type * as financeAuthority from "../financeAuthority.js";
import type * as financeProjection from "../financeProjection.js";
import type * as financeProjectionSchema from "../financeProjectionSchema.js";
import type * as financeWorker from "../financeWorker.js";
import type * as gatewayCredentialAuthority from "../gatewayCredentialAuthority.js";
import type * as gatewayCredentialHttp from "../gatewayCredentialHttp.js";
import type * as helpers_agentPolicy from "../helpers/agentPolicy.js";
import type * as helpers_dependencySafetyVerification from "../helpers/dependencySafetyVerification.js";
import type * as helpers_evidenceLifecycleStatusOrder from "../helpers/evidenceLifecycleStatusOrder.js";
import type * as helpers_executionPolicy from "../helpers/executionPolicy.js";
import type * as helpers_frozenProgramVersion from "../helpers/frozenProgramVersion.js";
import type * as helpers_leases from "../helpers/leases.js";
import type * as helpers_managedAgentRelease from "../helpers/managedAgentRelease.js";
import type * as helpers_mobileConnector from "../helpers/mobileConnector.js";
import type * as helpers_mobileFunding from "../helpers/mobileFunding.js";
import type * as helpers_mobileWithdrawal from "../helpers/mobileWithdrawal.js";
import type * as helpers_modelRouting from "../helpers/modelRouting.js";
import type * as helpers_paymentLinks from "../helpers/paymentLinks.js";
import type * as helpers_programScope from "../helpers/programScope.js";
import type * as helpers_teamArchive from "../helpers/teamArchive.js";
import type * as helpers_teamConfig from "../helpers/teamConfig.js";
import type * as helpers_walletAssets from "../helpers/walletAssets.js";
import type * as helpers_walletCrypto from "../helpers/walletCrypto.js";
import type * as helpers_withdrawals from "../helpers/withdrawals.js";
import type * as http from "../http.js";
import type * as internalSpotProgramBootstrap from "../internalSpotProgramBootstrap.js";
import type * as managedProgramActivation from "../managedProgramActivation.js";
import type * as managedProgramCadence from "../managedProgramCadence.js";
import type * as managedProgramCadenceActions from "../managedProgramCadenceActions.js";
import type * as managedProgramCloseContext from "../managedProgramCloseContext.js";
import type * as managedProgramClosure from "../managedProgramClosure.js";
import type * as managedProgramControl from "../managedProgramControl.js";
import type * as managedProgramRuntime from "../managedProgramRuntime.js";
import type * as managedProposalExecution from "../managedProposalExecution.js";
import type * as managedSpotFundingOperations from "../managedSpotFundingOperations.js";
import type * as managedSpotMandates from "../managedSpotMandates.js";
import type * as managedTradeReceipt from "../managedTradeReceipt.js";
import type * as managedTradeRecovery from "../managedTradeRecovery.js";
import type * as managedVaultRelease from "../managedVaultRelease.js";
import type * as managedVaultStop from "../managedVaultStop.js";
import type * as mobile from "../mobile.js";
import type * as mobileAccount from "../mobileAccount.js";
import type * as mobileActivity from "../mobileActivity.js";
import type * as mobileAuthOnly from "../mobileAuthOnly.js";
import type * as mobileConnectorModel from "../mobileConnectorModel.js";
import type * as mobileConnectorSchema from "../mobileConnectorSchema.js";
import type * as mobileConnectorWorker from "../mobileConnectorWorker.js";
import type * as mobileFunding from "../mobileFunding.js";
import type * as mobileFundingModel from "../mobileFundingModel.js";
import type * as mobileMagicChain from "../mobileMagicChain.js";
import type * as mobileMagicWallet from "../mobileMagicWallet.js";
import type * as mobileSigning from "../mobileSigning.js";
import type * as mobileVenueSetup from "../mobileVenueSetup.js";
import type * as mobileWithdrawalModel from "../mobileWithdrawalModel.js";
import type * as mobileWithdrawals from "../mobileWithdrawals.js";
import type * as model from "../model.js";
import type * as mutations from "../mutations.js";
import type * as operatorCreditControls from "../operatorCreditControls.js";
import type * as operatorLocalBootstrap from "../operatorLocalBootstrap.js";
import type * as operatorProgramCatalog from "../operatorProgramCatalog.js";
import type * as operatorTestCredits from "../operatorTestCredits.js";
import type * as payments from "../payments.js";
import type * as private_ from "../private.js";
import type * as programExperiments from "../programExperiments.js";
import type * as programMigration from "../programMigration.js";
import type * as programOwnership from "../programOwnership.js";
import type * as programSchema from "../programSchema.js";
import type * as publicActions from "../publicActions.js";
import type * as queries from "../queries.js";
import type * as simulationAuthority from "../simulationAuthority.js";
import type * as simulationHttp from "../simulationHttp.js";
import type * as trade from "../trade.js";
import type * as tradeHelpers from "../tradeHelpers.js";
import type * as venueIntegrations from "../venueIntegrations.js";
import type * as venueSetupWorker from "../venueSetupWorker.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  accountWallets: typeof accountWallets;
  actions: typeof actions;
  agentActions: typeof agentActions;
  agentCredits: typeof agentCredits;
  agentEvaluations: typeof agentEvaluations;
  agentModels: typeof agentModels;
  agentMutations: typeof agentMutations;
  agentProfiles: typeof agentProfiles;
  agentQueries: typeof agentQueries;
  agentRuntime: typeof agentRuntime;
  agentScheduler: typeof agentScheduler;
  agentSchema: typeof agentSchema;
  agentTeamArchive: typeof agentTeamArchive;
  agentTeamMigration: typeof agentTeamMigration;
  agentTeamModelDefaults: typeof agentTeamModelDefaults;
  agentTeamMutations: typeof agentTeamMutations;
  agentTeamQueries: typeof agentTeamQueries;
  agentTeamWorker: typeof agentTeamWorker;
  agentValidators: typeof agentValidators;
  agentWorker: typeof agentWorker;
  constants: typeof constants;
  crons: typeof crons;
  dashboardPreferences: typeof dashboardPreferences;
  dependencySafety: typeof dependencySafety;
  dependencySafetySchema: typeof dependencySafetySchema;
  dependencySafetyValidators: typeof dependencySafetyValidators;
  evidenceLifecycle: typeof evidenceLifecycle;
  evidenceLifecycleSchema: typeof evidenceLifecycleSchema;
  financeAuthority: typeof financeAuthority;
  financeProjection: typeof financeProjection;
  financeProjectionSchema: typeof financeProjectionSchema;
  financeWorker: typeof financeWorker;
  gatewayCredentialAuthority: typeof gatewayCredentialAuthority;
  gatewayCredentialHttp: typeof gatewayCredentialHttp;
  "helpers/agentPolicy": typeof helpers_agentPolicy;
  "helpers/dependencySafetyVerification": typeof helpers_dependencySafetyVerification;
  "helpers/evidenceLifecycleStatusOrder": typeof helpers_evidenceLifecycleStatusOrder;
  "helpers/executionPolicy": typeof helpers_executionPolicy;
  "helpers/frozenProgramVersion": typeof helpers_frozenProgramVersion;
  "helpers/leases": typeof helpers_leases;
  "helpers/managedAgentRelease": typeof helpers_managedAgentRelease;
  "helpers/mobileConnector": typeof helpers_mobileConnector;
  "helpers/mobileFunding": typeof helpers_mobileFunding;
  "helpers/mobileWithdrawal": typeof helpers_mobileWithdrawal;
  "helpers/modelRouting": typeof helpers_modelRouting;
  "helpers/paymentLinks": typeof helpers_paymentLinks;
  "helpers/programScope": typeof helpers_programScope;
  "helpers/teamArchive": typeof helpers_teamArchive;
  "helpers/teamConfig": typeof helpers_teamConfig;
  "helpers/walletAssets": typeof helpers_walletAssets;
  "helpers/walletCrypto": typeof helpers_walletCrypto;
  "helpers/withdrawals": typeof helpers_withdrawals;
  http: typeof http;
  internalSpotProgramBootstrap: typeof internalSpotProgramBootstrap;
  managedProgramActivation: typeof managedProgramActivation;
  managedProgramCadence: typeof managedProgramCadence;
  managedProgramCadenceActions: typeof managedProgramCadenceActions;
  managedProgramCloseContext: typeof managedProgramCloseContext;
  managedProgramClosure: typeof managedProgramClosure;
  managedProgramControl: typeof managedProgramControl;
  managedProgramRuntime: typeof managedProgramRuntime;
  managedProposalExecution: typeof managedProposalExecution;
  managedSpotFundingOperations: typeof managedSpotFundingOperations;
  managedSpotMandates: typeof managedSpotMandates;
  managedTradeReceipt: typeof managedTradeReceipt;
  managedTradeRecovery: typeof managedTradeRecovery;
  managedVaultRelease: typeof managedVaultRelease;
  managedVaultStop: typeof managedVaultStop;
  mobile: typeof mobile;
  mobileAccount: typeof mobileAccount;
  mobileActivity: typeof mobileActivity;
  mobileAuthOnly: typeof mobileAuthOnly;
  mobileConnectorModel: typeof mobileConnectorModel;
  mobileConnectorSchema: typeof mobileConnectorSchema;
  mobileConnectorWorker: typeof mobileConnectorWorker;
  mobileFunding: typeof mobileFunding;
  mobileFundingModel: typeof mobileFundingModel;
  mobileMagicChain: typeof mobileMagicChain;
  mobileMagicWallet: typeof mobileMagicWallet;
  mobileSigning: typeof mobileSigning;
  mobileVenueSetup: typeof mobileVenueSetup;
  mobileWithdrawalModel: typeof mobileWithdrawalModel;
  mobileWithdrawals: typeof mobileWithdrawals;
  model: typeof model;
  mutations: typeof mutations;
  operatorCreditControls: typeof operatorCreditControls;
  operatorLocalBootstrap: typeof operatorLocalBootstrap;
  operatorProgramCatalog: typeof operatorProgramCatalog;
  operatorTestCredits: typeof operatorTestCredits;
  payments: typeof payments;
  private: typeof private_;
  programExperiments: typeof programExperiments;
  programMigration: typeof programMigration;
  programOwnership: typeof programOwnership;
  programSchema: typeof programSchema;
  publicActions: typeof publicActions;
  queries: typeof queries;
  simulationAuthority: typeof simulationAuthority;
  simulationHttp: typeof simulationHttp;
  trade: typeof trade;
  tradeHelpers: typeof tradeHelpers;
  venueIntegrations: typeof venueIntegrations;
  venueSetupWorker: typeof venueSetupWorker;
  worker: typeof worker;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
