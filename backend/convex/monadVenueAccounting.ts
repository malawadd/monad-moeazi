export function sumPerplOptimizerFundingUnits(cycles: any[], fallbackUnits = "0") {
  if (!cycles.length) return fallbackUnits;
  return cycles.reduce((sum, item) => {
    const cycle = typeof item.cycleJson === "string" ? JSON.parse(item.cycleJson) : item;
    return sum + BigInt(String(cycle?.fundingUnits ?? "0"));
  }, 0n).toString();
}
