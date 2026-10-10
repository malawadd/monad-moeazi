import assert from "node:assert/strict";
import test from "node:test";
import {Hono} from "hono";
import {registerMeraAssociationRoutes} from "../api-server/src/well-known.js";

const names = ["MERA_RP_ID", "MERA_ANDROID_SHA256_CERT_FINGERPRINTS", "MERA_IOS_TEAM_ID"] as const;
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));

test("association routes explain missing app signing configuration", async () => {
  delete process.env.MERA_ANDROID_SHA256_CERT_FINGERPRINTS;
  delete process.env.MERA_IOS_TEAM_ID;
  process.env.MERA_RP_ID = "moeazi-monad.kiyan.finance";
  const app = new Hono(); registerMeraAssociationRoutes(app);
  const android = await app.request("/.well-known/assetlinks.json");
  const ios = await app.request("/.well-known/apple-app-site-association");
  assert.equal(android.status, 503);
  assert.match((await android.json() as {error: string}).error, /MERA_ANDROID_SHA256_CERT_FINGERPRINTS/);
  assert.equal(ios.status, 503);
  assert.match((await ios.json() as {error: string}).error, /MERA_IOS_TEAM_ID/);
});

test("association routes publish the Android package and iOS team app", async () => {
  process.env.MERA_RP_ID = "moeazi-monad.kiyan.finance";
  process.env.MERA_ANDROID_SHA256_CERT_FINGERPRINTS = "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
  process.env.MERA_IOS_TEAM_ID = "ABCDEFGHIJ";
  const app = new Hono(); registerMeraAssociationRoutes(app);
  const android = await app.request("/.well-known/assetlinks.json");
  const ios = await app.request("/.well-known/apple-app-site-association");
  assert.equal(android.status, 200);
  const androidStatements = await android.json() as Array<{relation: string[]; target: Record<string, unknown>}>;
  assert.deepEqual(androidStatements, [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {namespace: "web", site: "https://moeazi-monad.kiyan.finance"},
    },
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: "com.moeazi.monad.mobile",
        sha256_cert_fingerprints: ["AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"],
      },
    },
  ]);
  assert.equal(ios.status, 200);
  assert.deepEqual(await ios.json(), {webcredentials: {apps: ["ABCDEFGHIJ.com.moeazi.monad.mobile"]}});
});

test.after(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
