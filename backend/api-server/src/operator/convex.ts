import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { importPKCS8, SignJWT } from "jose";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { localMonadServiceUrl } from "./local-service.js";

let signer: ReturnType<typeof importPKCS8> | undefined;
let bootstrap: Promise<void> | null = null;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is unavailable for the local operator API.`);
  return value;
}

async function signedOperatorToken() {
  const keyText = required("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM").replace(/\\n/g, "\n").trim();
  signer ??= importPKCS8(keyText, "RS256");
  return new SignJWT({ authProvider: "local_operator" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.PARTICLE_CONVEX_JWT_KID || "moeazi-monad-local" })
    .setIssuer(required("PARTICLE_CONVEX_JWT_ISSUER"))
    .setAudience("convex")
    .setSubject(LOCAL_OPERATOR_SUBJECT)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await signer);
}

function localConvexUrl() {
  const value = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL;
  if (!value) throw new Error("Local Convex URL is unavailable.");
  return localMonadServiceUrl(value, 3310, "Local Convex");
}

export async function operatorConvex() {
  const client = new ConvexHttpClient(localConvexUrl());
  client.setAuth(await signedOperatorToken());
  if (!bootstrap) {
    bootstrap = client.mutation(anyApi.operatorLocalBootstrap.ensureLocalOperator, {})
      .then(() => undefined).catch((error) => { bootstrap = null; throw error; });
  }
  await bootstrap;
  return client;
}

export async function operatorReadOnlyConvex() {
  const client = new ConvexHttpClient(localConvexUrl());
  client.setAuth(await signedOperatorToken());
  return client;
}
