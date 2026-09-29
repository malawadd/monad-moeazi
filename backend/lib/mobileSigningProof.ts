import { getBytes, verifyMessage, verifyTypedData } from "ethers";

export const SIGNING_PROOF_CHAIN_ID = 42161 as const;
export const SIGNING_PROOF_PURPOSE = "MOEAZI_MOBILE_SIGNING_PROOF_ONLY" as const;

export type SigningProofTypedData = {
  domain: { name: string; version: string; chainId: number };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    SigningProof: Array<{ name: string; type: string }>;
  };
  primaryType: "SigningProof";
  message: { owner: string; proofId: string; rootHash: string; purpose: string; expiresAt: number };
};

export function buildSigningProof(input: { owner: string; proofId: string; rootHash: string; expiresAt: number }) {
  const typedData: SigningProofTypedData = {
    domain: { name: "Moeazi Mobile Signing Proof", version: "1", chainId: SIGNING_PROOF_CHAIN_ID },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      SigningProof: [
        { name: "owner", type: "address" }, { name: "proofId", type: "string" },
        { name: "rootHash", type: "bytes32" }, { name: "purpose", type: "string" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    primaryType: "SigningProof",
    message: { owner: input.owner, proofId: input.proofId, rootHash: input.rootHash, purpose: SIGNING_PROOF_PURPOSE, expiresAt: input.expiresAt },
  };
  return { typedData, rootHash: input.rootHash };
}

export function verifySigningProof(input: {
  owner: string; typedData: SigningProofTypedData; rootHash: string;
  typedDataSignature: string; rootHashSignature: string;
}) {
  const expected = input.owner.toLowerCase();
  const messageTypes = { SigningProof: input.typedData.types.SigningProof };
  const typedOwner = verifyTypedData(input.typedData.domain, messageTypes, input.typedData.message, input.typedDataSignature).toLowerCase();
  const rootOwner = verifyMessage(getBytes(input.rootHash), input.rootHashSignature).toLowerCase();
  if (typedOwner !== expected) {
    throw new Error("Magic typed-data proof does not match the authenticated owner.");
  }
  if (rootOwner !== expected) {
    throw new Error("Magic root-hash proof does not match the authenticated owner.");
  }
  return expected;
}
