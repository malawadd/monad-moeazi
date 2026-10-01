import { requireViewerStrategy } from "../model";

export type ProgramActorScope = "operator" | "research" | "release";

const ENV: Record<ProgramActorScope, string> = {
  operator: "PROGRAM_OPERATOR_SUBJECTS",
  research: "PROGRAM_RESEARCH_SUBJECTS",
  release: "PROGRAM_RELEASE_SUBJECTS",
};

export function hasProgramActorScope(subject: string, scope: ProgramActorScope) {
  const keys = scope === "research" ? [ENV.research, ENV.operator] : [ENV[scope]];
  return keys.some((key) => (process.env[key] ?? "").split(",")
    .some((item) => item.trim() === subject));
}

export async function requireProgramActor(ctx: any, scope: ProgramActorScope) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  if (!hasProgramActorScope(identity.subject, scope)) {
    throw new Error(`${scope} access is not configured for this identity.`);
  }
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) throw new Error("A strategy account is required.");
  return { subject: identity.subject, user: state.user, account: state.strategyAccount };
}
