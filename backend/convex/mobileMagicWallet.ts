const ADDRESS = /^0x[a-f0-9]{40}$/;

export function hasObservedMagicDelegation(wallet: any) {
  return Boolean(wallet?.walletProvider === "magic" && wallet.accountMode === "eip7702"
    && wallet.ownerVerifiedAt && wallet.eip7702Delegated
    && ADDRESS.test(String(wallet.accountImplementation ?? "").toLowerCase())
    && Number.isSafeInteger(wallet.arbitrumBalanceBlock)
    && Number.isSafeInteger(wallet.arbitrumBalanceObservedAt)
    && wallet.arbitrumBalanceObservedAt > 0);
}

export function selectMobileMagicWallet(
  rows: any[], userId: unknown, strategyAccount: any, signedInOwner?: string,
) {
  const owner = String(signedInOwner ?? "").toLowerCase();
  if (signedInOwner !== undefined && !ADDRESS.test(owner)) return null;
  const matches = rows.filter((row) => row.userId === userId
    && row.walletProvider === "magic"
    && ADDRESS.test(String(row.ownerAddress ?? "").toLowerCase())
    && (!signedInOwner || String(row.ownerAddress).toLowerCase() === owner)
    && (!strategyAccount?.accountWalletId || row._id === strategyAccount.accountWalletId));
  return matches.length === 1 ? matches[0] : null;
}

export async function mobileMagicWallet(
  ctx: any, user: any, strategyAccount: any, signedInOwner?: string,
) {
  const rows = await ctx.db.query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect();
  return selectMobileMagicWallet(rows, user._id, strategyAccount, signedInOwner);
}

export async function mobileMagicAccount(ctx: any, user: any, signedInOwner?: string) {
  const [walletRows, strategies] = await Promise.all([
    ctx.db.query("accountWallets")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
  ]);
  const wallet = selectMobileMagicWallet(walletRows, user._id, null,
    signedInOwner ?? user.walletAddress);
  if (!wallet) return { wallet: null, strategyAccount: null };
  const bound = strategies.filter((row: any) => row.accountWalletId === wallet._id);
  const legacy = bound.length === 0 && strategies.length === 1
    && !strategies[0].accountWalletId ? strategies[0] : null;
  return { wallet, strategyAccount: bound.length === 1 ? bound[0] : legacy };
}
