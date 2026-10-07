function margin(json: string | null | undefined) {
  if (!json) return 0n;
  try {
    const value = JSON.parse(json);
    return BigInt(value?.marginUsdc ?? "0");
  } catch { return 0n; }
}

export function economicActivePnl(input: {
  startingUnits: string; availableUnits: string;
  positionJson: string | null | undefined; pendingOrderJson: string | null | undefined;
}) {
  return (BigInt(input.availableUnits) + margin(input.positionJson)
    + margin(input.pendingOrderJson) - BigInt(input.startingUnits)).toString();
}

export function economicTerminalPnl(startingUnits: string, returnedUnits: string) {
  return (BigInt(returnedUnits) - BigInt(startingUnits)).toString();
}

export function finalizedReturnUnits(event: { type?: string; status?: string; payload?: any; payloadJson?: string } | null | undefined) {
  if (!event || event.type !== "perp_settlement_returned" || event.status !== "finalized") return null;
  try {
    const payload = event.payload ?? JSON.parse(event.payloadJson ?? "{}");
    const value = String(payload.amountUsdc ?? "");
    return /^\d+$/.test(value) ? value : null;
  } catch { return null; }
}
