type RecordWithTeam = { teamId?: string; status: string; mode?: string };

export function teamArchiveBlockers(team: { _id: string; paused: boolean; lifecycleStatus?: string }, input: {
  deployments: RecordWithTeam[]; jobs: RecordWithTeam[]; proposals: RecordWithTeam[];
  approvals: RecordWithTeam[]; shadows: RecordWithTeam[]; reservations: RecordWithTeam[];
}): string[] {
  const issues: string[] = [];
  if (!team.paused) issues.push("Pause the team before deleting it.");
  if (input.deployments.some((row) => row.status !== "paused"))
    issues.push("Pause every market deployment first.");
  if (team.lifecycleStatus !== "draft" && input.deployments.some((row) => row.mode === "approval_required" || row.mode === "autopilot"))
    issues.push("A funded deployment has existed for this team. Position and obligation reconciliation is required before deletion; this check is not available yet.");
  if (input.jobs.some((row) => row.teamId === team._id && ["queued", "claimed", "running"].includes(row.status)))
    issues.push("Wait for active analysis work to finish or cancel it.");
  if (input.proposals.some((row) => row.teamId === team._id && ["pending_approval", "approved", "executing"].includes(row.status)))
    issues.push("Resolve the team's pending or executing proposal first.");
  if (input.approvals.some((row) => row.teamId === team._id && row.status === "pending"))
    issues.push("Resolve the team's pending approval first.");
  if (input.shadows.some((row) => row.teamId === team._id && row.status === "open"))
    issues.push("Close or expire the team's open Shadow position first.");
  if (input.reservations.some((row) => row.teamId === team._id && row.status === "active"))
    issues.push("Finish or cancel the team's research and wait for its reserved credits to settle.");
  return issues;
}
