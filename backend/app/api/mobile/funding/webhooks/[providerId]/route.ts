import {NextResponse} from "next/server";
import {connectorProxy} from "@/lib/mobileConnectorProxy";
export const runtime = "nodejs";
export async function POST(request: Request, context: {params: Promise<{providerId: string}>}) {
  const {providerId} = await context.params;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(providerId)) return NextResponse.json({error: "Provider not recognized."}, {status: 404});
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (!reader) return NextResponse.json({error: "Missing event."}, {status: 400});
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.length; if (size > 65_536) {await reader.cancel(); return NextResponse.json({error: "Event too large."}, {status: 413});}
    chunks.push(value);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const headers = Object.fromEntries(["authorization", "moonpay-signature-v2"].map(name => [name, request.headers.get(name) ?? ""]));
  return connectorProxy(request, "webhook", {providerId, rawBody, headers}, true);
}
