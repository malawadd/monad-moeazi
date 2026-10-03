export async function dispatchMobileWithdrawalReconciliation(operationId: string) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) return false;
  const baseUrl = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
  try {
    const response = await fetch(`${baseUrl}/v1/mobile-withdrawals/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ operation_id: operationId }),
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch { return false; }
}
