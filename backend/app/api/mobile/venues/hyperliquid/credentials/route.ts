import { mobileHyperliquidBinding } from "@/lib/mobileHyperliquidBinding";

export const runtime = "nodejs";
export const POST = (request: Request) => mobileHyperliquidBinding(request, "credentials");
