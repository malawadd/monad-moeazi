import {connectorProxy} from "@/lib/mobileConnectorProxy";
export const runtime = "nodejs";
export async function GET(request: Request) { return connectorProxy(request, "gas-readiness"); }
