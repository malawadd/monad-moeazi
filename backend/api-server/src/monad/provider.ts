import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";
import { ASSETS, ERC20_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS,
  WMON_ADDRESS, WMON_DECIMALS } from "./constants.js";
import { rpcUrl, MonadApiError } from "./config.js";

export async function monadProvider() {
  const provider = new JsonRpcProvider(rpcUrl());
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
    await provider.destroy();
    throw new MonadApiError("Configured RPC did not identify as Monad Testnet (10143).", 503, "wrong_chain");
  }
  return provider;
}

export async function requireContractCode(provider: JsonRpcProvider, address: string, label: string) {
  const code = await provider.getCode(address);
  if (!code || code === "0x") throw new MonadApiError(`${label} has no code on Monad Testnet.`, 503, "contract_unavailable");
}

export async function finalizedBlockNumber(provider: JsonRpcProvider): Promise<number> {
  let block: any;
  try { block = await provider.send("eth_getBlockByNumber", ["finalized", false]); }
  catch { throw new MonadApiError("Monad Testnet finalized checkpoint is unavailable.", 503, "finalized_checkpoint_unavailable"); }
  if (!block?.number || !/^0x[0-9a-f]+$/i.test(block.number)) {
    throw new MonadApiError("Monad Testnet RPC did not return a finalized checkpoint.", 503, "finalized_checkpoint_unavailable");
  }
  const number = Number(BigInt(block.number));
  if (!Number.isSafeInteger(number) || number < 0) throw new MonadApiError("Finalized block number is invalid.", 503, "rpc_unavailable");
  return number;
}

export async function readWalletBalances(provider: JsonRpcProvider, ownerAddress: string) {
  const owner = getAddress(ownerAddress);
  const blockNumber = await finalizedBlockNumber(provider);
  const block = await provider.getBlock(blockNumber);
  if (!block) throw new MonadApiError("Could not read a confirmed Monad Testnet block.", 503, "rpc_unavailable");
  await Promise.all([
    requireContractCode(provider, USDC_ADDRESS, "Circle USDC"),
    requireContractCode(provider, WMON_ADDRESS, "WMON"),
  ]);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const wmon = new Contract(WMON_ADDRESS, ERC20_ABI, provider);
  const [native, usdcUnits, wmonUnits, usdcDecimals, wmonDecimals] = await Promise.all([
    provider.getBalance(owner, blockNumber),
    usdc.balanceOf(owner, { blockTag: blockNumber }),
    wmon.balanceOf(owner, { blockTag: blockNumber }),
    usdc.decimals({ blockTag: blockNumber }),
    wmon.decimals({ blockTag: blockNumber }),
  ]);
  if (Number(usdcDecimals) !== USDC_DECIMALS || Number(wmonDecimals) !== WMON_DECIMALS) {
    throw new MonadApiError("Monad Testnet token decimals differ from the reviewed asset configuration.", 503, "asset_config_mismatch");
  }
  const stale = Date.now() - Number(block.timestamp) * 1000 > 60_000;
  return {
    ownerAddress: owner, chainId: MONAD_CHAIN_ID, observedBlock: blockNumber,
    observedAt: new Date(Number(block.timestamp) * 1000).toISOString(), stale,
    balances: [
      { asset: ASSETS.MON.id, tokenAddress: null, amountUnits: native.toString(), decimals: ASSETS.MON.decimals },
      { asset: ASSETS.USDC.id, tokenAddress: USDC_ADDRESS, amountUnits: usdcUnits.toString(), decimals: USDC_DECIMALS },
      { asset: ASSETS.WMON.id, tokenAddress: WMON_ADDRESS, amountUnits: wmonUnits.toString(), decimals: WMON_DECIMALS },
    ],
  };
}

export async function readTokenBalance(provider: JsonRpcProvider, tokenAddress: string, ownerAddress: string,
  blockTag?: number) {
  const token = getAddress(tokenAddress);
  await requireContractCode(provider, token, "Vault asset");
  const contract = new Contract(token, ERC20_ABI, provider);
  const [units, decimals] = await Promise.all([
    contract.balanceOf(getAddress(ownerAddress), blockTag === undefined ? {} : { blockTag }),
    contract.decimals(blockTag === undefined ? {} : { blockTag }),
  ]);
  return { tokenAddress: token, amountUnits: units.toString(), decimals: Number(decimals),
    formatted: formatUnits(units, Number(decimals)) };
}
