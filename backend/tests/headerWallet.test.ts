import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldClearSessionForWalletDisconnect,
  shouldOpenHeaderWalletPopup,
} from "../lib/headerWallet";

test("header wallet popup opens when a Moeazi session exists", () => {
  assert.equal(
    shouldOpenHeaderWalletPopup({ hasSession: true, sessionStatus: "authenticated" }),
    true,
  );
  assert.equal(
    shouldOpenHeaderWalletPopup({ hasSession: true, sessionStatus: "unauthenticated" }),
    true,
  );
});

test("header wallet popup does not open while session state is loading or missing", () => {
  assert.equal(
    shouldOpenHeaderWalletPopup({ hasSession: true, sessionStatus: "loading" }),
    false,
  );
  assert.equal(
    shouldOpenHeaderWalletPopup({ hasSession: false, sessionStatus: "authenticated" }),
    false,
  );
});

test("wallet disconnect clears app session only after a known connected wallet", () => {
  assert.equal(
    shouldClearSessionForWalletDisconnect({
      hasSession: true,
      hadConnectedWallet: true,
      walletStatus: "disconnected",
      signOutInFlight: false,
    }),
    true,
  );
});

test("initial or in-flight wallet states do not clear app session", () => {
  const base = {
    hasSession: true,
    hadConnectedWallet: false,
    signOutInFlight: false,
  };

  assert.equal(
    shouldClearSessionForWalletDisconnect({ ...base, walletStatus: "disconnected" }),
    false,
  );
  assert.equal(
    shouldClearSessionForWalletDisconnect({ ...base, hadConnectedWallet: true, walletStatus: "reconnecting" }),
    false,
  );
  assert.equal(
    shouldClearSessionForWalletDisconnect({
      ...base,
      hadConnectedWallet: true,
      walletStatus: "disconnected",
      signOutInFlight: true,
    }),
    false,
  );
});
