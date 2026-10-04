type SignMessageClient = {
  signMessage?: (args: { account?: `0x${string}`; message: { raw: `0x${string}` } }) => Promise<string>;
};

type PersonalSignProvider = {
  request: (args: { method: "personal_sign"; params: unknown[] }) => Promise<string>;
};

export type RootHashSigningInput = {
  account?: string | null;
  rootHash: string;
  walletClient?: unknown;
  personalSignProvider?: PersonalSignProvider | null;
};

function asHex(value: string) {
  if (!value.startsWith("0x")) {
    throw new Error("Universal Account transaction root hash is not a hex value.");
  }
  return value as `0x${string}`;
}

export async function signUniversalAccountRootHash({
  account,
  rootHash,
  walletClient,
  personalSignProvider,
}: RootHashSigningInput) {
  const client = walletClient as SignMessageClient | null | undefined;
  if (typeof client?.signMessage === "function") {
    return await client.signMessage({
      account: account ? (account as `0x${string}`) : undefined,
      message: { raw: asHex(rootHash) },
    });
  }

  if (personalSignProvider && account) {
    return await personalSignProvider.request({
      method: "personal_sign",
      params: [rootHash, account],
    });
  }

  throw new Error("No wallet available for signing.");
}
