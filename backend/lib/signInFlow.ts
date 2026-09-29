export type ParticleSessionStatus = "loading" | "authenticated" | "unauthenticated";

const LONG_HANDOFF_WAIT_MS = 11_000;

type ParticleSignInGateState = {
  isConnected: boolean;
  address?: string | null;
  autoAttemptedAddress?: string | null;
  sessionStatus: ParticleSessionStatus;
  hasSession: boolean;
  busy: boolean;
  signing: boolean;
  completed: boolean;
};

export function shouldStartParticleSignIn(state: ParticleSignInGateState) {
  const address = state.address?.toLowerCase() ?? null;
  const attemptedAddress = state.autoAttemptedAddress?.toLowerCase() ?? null;

  return Boolean(
    state.isConnected &&
      address &&
      attemptedAddress !== address &&
      state.sessionStatus === "unauthenticated" &&
      !state.hasSession &&
      !state.busy &&
      !state.signing &&
      !state.completed,
  );
}

export type SignInHandoffInput = {
  active: boolean;
  redirectPath: string;
  sessionStatus: ParticleSessionStatus;
  convexAuthLoading: boolean;
  convexAuthenticated: boolean;
  dashboardDataReady: boolean;
  elapsedMs: number;
};

export type SignInHandoffStatus = {
  title: string;
  message: string;
  detail: string;
  readyToRedirect: boolean;
  dashboardRequired: boolean;
  longWait: boolean;
  actionLabel: string;
};

function pathOnly(value: string) {
  const path = value.split(/[?#]/, 1)[0];
  return path || "/";
}

export function isDashboardRedirectPath(value: string) {
  return pathOnly(value) === "/dashboard";
}

export function getSignInHandoffStatus(input: SignInHandoffInput): SignInHandoffStatus {
  const dashboardRequired = isDashboardRedirectPath(input.redirectPath);
  const sessionReady = input.sessionStatus === "authenticated";
  const convexReady = input.convexAuthenticated && !input.convexAuthLoading;
  const dashboardReady = !dashboardRequired || input.dashboardDataReady;
  const readyToRedirect = Boolean(input.active && sessionReady && convexReady && dashboardReady);
  const longWait = Boolean(input.active && !readyToRedirect && input.elapsedMs >= LONG_HANDOFF_WAIT_MS);

  if (!input.active) {
    return {
      title: "Sign-in complete",
      message: "Preparing your dashboard...",
      detail: "Waiting for sign-in to finish.",
      readyToRedirect: false,
      dashboardRequired,
      longWait: false,
      actionLabel: dashboardRequired ? "Open dashboard" : "Continue",
    };
  }

  if (!sessionReady) {
    return {
      title: longWait ? "Still preparing..." : "Sign-in complete",
      message: "Preparing your dashboard...",
      detail: "Securing your account session.",
      readyToRedirect,
      dashboardRequired,
      longWait,
      actionLabel: dashboardRequired ? "Open dashboard" : "Continue",
    };
  }

  if (!convexReady) {
    return {
      title: longWait ? "Still preparing..." : "Sign-in complete",
      message: "Preparing your dashboard...",
      detail: "Connecting account data.",
      readyToRedirect,
      dashboardRequired,
      longWait,
      actionLabel: dashboardRequired ? "Open dashboard" : "Continue",
    };
  }

  if (!dashboardReady) {
    return {
      title: longWait ? "Still preparing..." : "Sign-in complete",
      message: "Preparing your dashboard...",
      detail: "Reading dashboard state.",
      readyToRedirect,
      dashboardRequired,
      longWait,
      actionLabel: "Open dashboard",
    };
  }

  return {
    title: "Sign-in complete",
    message: dashboardRequired ? "Preparing your dashboard..." : "Preparing your account...",
    detail: dashboardRequired ? "Opening dashboard." : "Opening your destination.",
    readyToRedirect,
    dashboardRequired,
    longWait,
    actionLabel: dashboardRequired ? "Open dashboard" : "Continue",
  };
}
