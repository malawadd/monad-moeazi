import test from "node:test";
import assert from "node:assert/strict";
import { getSignInHandoffStatus, shouldStartParticleSignIn } from "../lib/signInFlow";

const readyState = {
  isConnected: true,
  address: "0x1111111111111111111111111111111111111111",
  autoAttemptedAddress: null,
  sessionStatus: "unauthenticated" as const,
  hasSession: false,
  busy: false,
  signing: false,
  completed: false,
};

test("Particle sign-in starts only for a connected unauthenticated wallet", () => {
  assert.equal(shouldStartParticleSignIn(readyState), true);
  assert.equal(shouldStartParticleSignIn({ ...readyState, isConnected: false }), false);
  assert.equal(shouldStartParticleSignIn({ ...readyState, address: null }), false);
  assert.equal(shouldStartParticleSignIn({ ...readyState, sessionStatus: "loading" }), false);
});

test("Particle sign-in does not re-enter after an app session exists", () => {
  assert.equal(shouldStartParticleSignIn({ ...readyState, sessionStatus: "authenticated" }), false);
  assert.equal(shouldStartParticleSignIn({ ...readyState, hasSession: true }), false);
  assert.equal(shouldStartParticleSignIn({ ...readyState, completed: true }), false);
});

test("Particle sign-in does not re-enter while a signature flow is active", () => {
  assert.equal(shouldStartParticleSignIn({ ...readyState, busy: true }), false);
  assert.equal(shouldStartParticleSignIn({ ...readyState, signing: true }), false);
});

test("Particle sign-in auto prompt is one attempt per connected address", () => {
  assert.equal(
    shouldStartParticleSignIn({
      ...readyState,
      autoAttemptedAddress: "0x1111111111111111111111111111111111111111",
    }),
    false,
  );
  assert.equal(
    shouldStartParticleSignIn({
      ...readyState,
      autoAttemptedAddress: "0x2222222222222222222222222222222222222222",
    }),
    true,
  );
});

const handoffReadyState = {
  active: true,
  redirectPath: "/dashboard",
  sessionStatus: "authenticated" as const,
  convexAuthLoading: false,
  convexAuthenticated: true,
  dashboardDataReady: true,
  elapsedMs: 250,
};

test("sign-in handoff waits while the app session is refreshing", () => {
  const status = getSignInHandoffStatus({
    ...handoffReadyState,
    sessionStatus: "loading",
  });

  assert.equal(status.readyToRedirect, false);
  assert.equal(status.detail, "Securing your account session.");
});

test("sign-in handoff waits while Convex auth is connecting", () => {
  const status = getSignInHandoffStatus({
    ...handoffReadyState,
    convexAuthLoading: true,
    convexAuthenticated: false,
  });

  assert.equal(status.readyToRedirect, false);
  assert.equal(status.detail, "Connecting account data.");
});

test("sign-in handoff waits for dashboard data when redirecting to dashboard", () => {
  const status = getSignInHandoffStatus({
    ...handoffReadyState,
    dashboardDataReady: false,
  });

  assert.equal(status.dashboardRequired, true);
  assert.equal(status.readyToRedirect, false);
  assert.equal(status.detail, "Reading dashboard state.");
});

test("sign-in handoff redirects when dashboard state is ready", () => {
  const status = getSignInHandoffStatus(handoffReadyState);

  assert.equal(status.dashboardRequired, true);
  assert.equal(status.readyToRedirect, true);
  assert.equal(status.detail, "Opening dashboard.");
});

test("sign-in handoff does not require dashboard data for another destination", () => {
  const status = getSignInHandoffStatus({
    ...handoffReadyState,
    redirectPath: "/profile/wallet",
    dashboardDataReady: false,
  });

  assert.equal(status.dashboardRequired, false);
  assert.equal(status.readyToRedirect, true);
  assert.equal(status.detail, "Opening your destination.");
});

test("sign-in handoff exposes a soft long-wait fallback", () => {
  const status = getSignInHandoffStatus({
    ...handoffReadyState,
    convexAuthLoading: true,
    convexAuthenticated: false,
    dashboardDataReady: false,
    elapsedMs: 12_000,
  });

  assert.equal(status.readyToRedirect, false);
  assert.equal(status.longWait, true);
  assert.equal(status.title, "Still preparing...");
  assert.equal(status.actionLabel, "Open dashboard");
});
