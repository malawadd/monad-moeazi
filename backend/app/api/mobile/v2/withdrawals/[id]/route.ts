import {connectorProxy} from "@/lib/mobileConnectorProxy";
export const runtime = "nodejs";
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  const {id} = await context.params;
  return connectorProxy(request, "sponsored-status", {operationId: id});
}
