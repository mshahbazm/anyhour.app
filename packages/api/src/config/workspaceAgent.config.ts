// Limits for the owner's helper; its model lives in models.config.ts.
export const workspaceAgentConfig = {
  timeoutMs: 120_000,
  maxTurns: 12,
  // How long after sign-up the AI counts as new: its getting-started
  // skill is listed only until then.
  newForDays: 7,
}
