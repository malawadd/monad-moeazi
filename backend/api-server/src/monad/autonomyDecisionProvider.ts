import { Contract } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { AUTONOMY_POOL_ABI } from "./autonomyChain.js";
import { AUTONOMY_RULE_VERSION, decideAutonomy, priceUsdcPerTokenWad, type Decision, type PriceSample } from "./autonomyDecision.js";
import { USDC_ADDRESS } from "./constants.js";
import { retryMissingRevertData } from "./autonomyRpcRead.js";

const PROBE_USDC = 100_000n;

export type ExecutableObservation = PriceSample & {
  tokenAddress: string; poolAddress: string; quoteInputUsdcUnits: string;
  quoteOutputTokenUnits: string; finalized: true; availableUsdcUnits: string; positionAmountUnits: string;
};
export type DecisionInput = {
  histories: PriceSample[][]; now: number; openPosition?: {
    tokenIndex: number; entryAt: number; peakPriceUsdcPerTokenWad: string;
  } | null;
};
export interface AutonomyDecisionProvider {
  readonly id: string;
  readonly version: string;
  sample(input: { provider: JsonRpcProvider; deployment: any; availableUsdc: bigint;
    positionAmount: bigint; observedAt: number; blockNumber: number }): Promise<ExecutableObservation[]>;
  decide(input: DecisionInput): Decision;
}

export const ruleDecisionProvider: AutonomyDecisionProvider = {
  id: "finalized-executable-momentum",
  version: AUTONOMY_RULE_VERSION,
  async sample(input) {
    return await Promise.all(input.deployment.pools.map(async (poolAddress: string, tokenIndex: number) => {
      const [tokenAmount, available] = await retryMissingRevertData(() =>
        new Contract(poolAddress, AUTONOMY_POOL_ABI, input.provider)
          .quoteExactInput(USDC_ADDRESS, input.deployment.tokens[tokenIndex], PROBE_USDC,
            { blockTag: input.blockNumber }));
      const amount = available ? BigInt(tokenAmount) : 0n;
      return { tokenIndex, tokenAddress: input.deployment.tokens[tokenIndex], poolAddress,
        priceUsdcPerTokenWad: amount > 0n ? priceUsdcPerTokenWad(PROBE_USDC, amount) : "0",
        quoteInputUsdcUnits: PROBE_USDC.toString(), quoteOutputTokenUnits: amount.toString(),
        observedAt: input.observedAt, blockNumber: input.blockNumber, finalized: true as const,
        availableUsdcUnits: input.availableUsdc.toString(), positionAmountUnits: input.positionAmount.toString() };
    }));
  },
  decide: decideAutonomy,
};
