import {connectorProxy} from "@/lib/mobileConnectorProxy";
export const runtime = "nodejs";
export async function POST(request: Request) { return connectorProxy(request, "purchase-create"); }
export async function GET(request: Request) { return connectorProxy(request, "pending"); }
