import { NextResponse } from "next/server";
import { getParticleJwks } from "@/lib/particleSession";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getParticleJwks(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    },
  });
}
