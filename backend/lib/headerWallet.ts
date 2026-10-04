export type ParticleWalletStatus = "connected" | "connecting" | "reconnecting" | "disconnected";
export type ParticleSessionStatus = "loading" | "authenticated" | "unauthenticated";

export function shouldOpenHeaderWalletPopup(state: {
  hasSession: boolean;
  sessionStatus: ParticleSessionStatus;
}) {
  return state.hasSession && state.sessionStatus !== "loading";
}

export function shouldClearSessionForWalletDisconnect(state: {
  hasSession: boolean;
  hadConnectedWallet: boolean;
  walletStatus: ParticleWalletStatus;
  signOutInFlight: boolean;
}) {
  return Boolean(
    state.hasSession &&
      state.hadConnectedWallet &&
      state.walletStatus === "disconnected" &&
      !state.signOutInFlight,
  );
}
