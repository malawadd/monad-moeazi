import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { arbitrum } from "viem/chains";
import { getUserByAuthSubject } from "./model";
import { mobileMagicAccount } from "./mobileMagicWallet";
import { ARBITRUM_USDC } from "../execution-sidecar/src/mobile/uniswapV3";

const ADDRESS = /^0x[a-f0-9]{40}$/;
const HASH = /^0x[a-f0-9]{64}$/;
const DELEGATION = /^0xef0100([a-f0-9]{40})$/;
type MagicContext = { userId: Id<"users">; walletId: Id<"accountWallets">;
  strategyAccountId: Id<"strategyAccounts">; ownerAddress: string };
type MagicChainResult = { ownerAddress: string; delegationState: "active" | "required";
  delegateAddress: string | null; blockNumber: number; blockHash: string;
  usdcUnits: string; ethWei: string };

export function delegationTarget(code: string | undefined, targetCode: string | undefined) {
  const match = DELEGATION.exec((code ?? "").toLowerCase());
  return match && targetCode && targetCode !== "0x"
    ? `0x${match[1]}` : null;
}

export const context = internalQuery({
  args: { subject: v.string(), ownerAddress: v.string() },
  handler: async (ctx, args) => {
    const ownerAddress = args.ownerAddress.toLowerCase();
    if (!ADDRESS.test(ownerAddress)) return null;
    const user = await getUserByAuthSubject(ctx, args.subject);
    if (!user) return null;
    const selected = await mobileMagicAccount(ctx, user, ownerAddress);
    if (!selected.wallet || !selected.strategyAccount) return null;
    return { userId: user._id, walletId: selected.wallet._id,
      strategyAccountId: selected.strategyAccount._id, ownerAddress };
  },
});

export const record = internalMutation({
  args: { userId: v.id("users"), walletId: v.id("accountWallets"),
    strategyAccountId: v.id("strategyAccounts"), ownerAddress: v.string(),
    blockNumber: v.number(), blockHash: v.string(), code: v.string(),
    delegateAddress: v.optional(v.string()), usdcUnits: v.string(), ethWei: v.string() },
  handler: async (ctx, args) => {
    const [user, wallet, strategy] = await Promise.all([
      ctx.db.get(args.userId), ctx.db.get(args.walletId), ctx.db.get(args.strategyAccountId),
    ]);
    if (!user || !wallet || !strategy || wallet.userId !== user._id
      || strategy.userId !== user._id || strategy.accountWalletId !== wallet._id
      || wallet.walletProvider !== "magic" || wallet.accountMode !== "eip7702"
      || wallet.ownerAddress.toLowerCase() !== args.ownerAddress
      || !ADDRESS.test(args.ownerAddress) || !HASH.test(args.blockHash)
      || !Number.isSafeInteger(args.blockNumber) || args.blockNumber < 0
      || args.blockNumber < (wallet.arbitrumBalanceBlock ?? 0)
      || !/^(?:0|[1-9][0-9]*)$/.test(args.usdcUnits)
      || !/^(?:0|[1-9][0-9]*)$/.test(args.ethWei)) {
      throw new Error("The finalized Magic owner observation cannot update this account.");
    }
    const delegate = args.delegateAddress?.toLowerCase();
    if (delegate && (!ADDRESS.test(delegate)
      || args.code.toLowerCase() !== `0xef0100${delegate.slice(2)}`)) {
      throw new Error("The EIP-7702 delegate does not match the observed code.");
    }
    const now = Date.now();
    await ctx.db.patch(wallet._id, {
      eip7702Delegated: Boolean(delegate),
      arbitrumDelegationStatus: delegate ? "active" : "required",
      accountImplementation: delegate,
      delegatedChainIdsJson: delegate ? "[42161]" : "[]",
      capabilitiesJson: JSON.stringify({ shadow: true, approval: true,
        autopilot: Boolean(delegate), chainId: 42161 }),
      arbitrumUsdcBalanceRaw: args.usdcUnits,
      arbitrumUsdcBalance: formatUnits(BigInt(args.usdcUnits), 6),
      arbitrumEthBalanceRaw: args.ethWei,
      arbitrumEthBalance: formatUnits(BigInt(args.ethWei), 18),
      arbitrumBalanceBlock: args.blockNumber,
      arbitrumBalanceObservedAt: now, lastRefreshedAt: now, updatedAt: now,
    });
    return { ownerAddress: args.ownerAddress,
      delegationState: delegate ? "active" as const : "required" as const,
      delegateAddress: delegate ?? null, blockNumber: args.blockNumber,
      blockHash: args.blockHash, usdcUnits: args.usdcUnits, ethWei: args.ethWei };
  },
});

export const sync = action({ args: {}, handler: async (ctx): Promise<MagicChainResult> => {
  const identity = await ctx.auth.getUserIdentity();
  const ownerAddress = typeof identity?.walletAddress === "string"
    ? identity.walletAddress.toLowerCase() : "";
  if (identity?.authProvider !== "magic" || !ADDRESS.test(ownerAddress)) {
    throw new Error("A signed-in Magic wallet is required for chain verification.");
  }
  const owned: MagicContext | null = await ctx.runQuery(internal.mobileMagicChain.context,
    { subject: identity.subject, ownerAddress });
  if (!owned) throw new Error("The Magic wallet is not bound to this mobile account.");
  const client = createPublicClient({ chain: arbitrum,
    transport: http(process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      { timeout: 12_000 }) });
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || !block.hash || block.number > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("A finalized Arbitrum block is unavailable.");
  }
  const [code, usdcUnits, ethWei] = await Promise.all([
    client.getCode({ address: ownerAddress as `0x${string}`, blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_USDC, abi: erc20Abi,
      functionName: "balanceOf", args: [ownerAddress as `0x${string}`],
      blockNumber: block.number }),
    client.getBalance({ address: ownerAddress as `0x${string}`, blockNumber: block.number }),
  ]);
  const candidate = DELEGATION.exec((code ?? "").toLowerCase());
  const targetCode = candidate ? await client.getCode({
    address: `0x${candidate[1]}`, blockNumber: block.number }) : undefined;
  const delegate = delegationTarget(code, targetCode);
  return await ctx.runMutation(internal.mobileMagicChain.record, {
    ...owned, ownerAddress, blockNumber: Number(block.number),
    blockHash: block.hash.toLowerCase(), code: (code ?? "0x").toLowerCase(),
    delegateAddress: delegate ?? undefined,
    usdcUnits: usdcUnits.toString(), ethWei: ethWei.toString(),
  });
} });
