import type {PublicClient} from "viem";
import {CHAIN, ENTRY_POINT, ConnectorError, type OperationRecord, type OperationStore, type PreparedSponsoredOperation} from "./contracts.js";
import {operationEvent} from "./kernel.js";
import type {Registries} from "./configuration.js";
import type {PurchaseService} from "./purchases.js";

export class ConnectorReconciler {
  constructor(private store: OperationStore, private registries: Registries, private client: PublicClient, private purchases: PurchaseService) {}
  async reconcile(row: OperationRecord) {
    if (row.kind === "purchase") return this.purchases.reconcile(row);
    if (["completed", "failed", "cancelled", "expired", "authorization_required", "prepared"].includes(row.status)) return row.status;
    const prepared: PreparedSponsoredOperation = JSON.parse(row.payloadJson);
    if (!prepared.userOperationHash) return row.status;
    if (await this.client.getChainId() !== CHAIN) throw new ConnectorError("INVALID", "Operation settlement must be verified on Arbitrum.");
    const bundler = this.registries.bundlers.resolve(prepared.bundler);
    // Retired providers remain resolvable. A lookup outage is not evidence of failure.
    let located = await bundler.locate(prepared.userOperationHash).catch(() => null);
    const head = await this.client.getBlockNumber();
    if (!located?.transactionHash) {
      const from = BigInt(Math.max(prepared.observedBlock, Number(head) - 256));
      const logs = await this.client.getLogs({address: ENTRY_POINT, event: operationEvent[0], args: {userOpHash: prepared.userOperationHash}, fromBlock: from, toBlock: head});
      if (logs[0]?.transactionHash) located = {transactionHash: logs[0].transactionHash};
    }
    if (!located?.transactionHash) return row.status;
    const receipt = await this.client.getTransactionReceipt({hash: located.transactionHash});
    if (head < receipt.blockNumber + 1n) return row.status;
    const account = this.registries.accounts.resolve(prepared.account);
    const settlement = account.verifyReceipt(prepared, receipt);
    if (settlement.state === "pending") return row.status;
    if (prepared.intent.kind === "activation" && settlement.state === "completed") {
      const code = await this.client.getCode({address: prepared.owner, blockNumber: receipt.blockNumber});
      if (code?.toLowerCase() !== `0xef0100${prepared.implementation.slice(2).toLowerCase()}`) throw new ConnectorError("INVALID", "Delegation was not verified.");
    }
    const actualCoverageCostWei = settlement.actualGasCost !== undefined
      ? this.registries.paymasters.resolve(prepared.paymaster).settlementCostWei(settlement.actualGasCost) : undefined;
    if (actualCoverageCostWei !== undefined && (!/^[0-9]+$/.test(actualCoverageCostWei) || BigInt(actualCoverageCostWei) < BigInt(settlement.actualGasCost!))) throw new ConnectorError("INVALID", "Settlement coverage cost was invalid.");
    await this.store.transition(row.subject, row.operationId, ["submitting", "submitted", "uncertain", "confirming", "needs_attention"], {
      status: settlement.state, transactionHash: settlement.transactionHash, actualGasCost: settlement.actualGasCost, actualCoverageCostWei,
      payloadJson: JSON.stringify({...prepared, settlement})});
    return settlement.state;
  }
}
