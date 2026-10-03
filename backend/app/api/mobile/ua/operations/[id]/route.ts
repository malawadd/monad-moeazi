import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { token } = await requireMobileBearer(request); const { id } = await context.params;
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(id)) return NextResponse.json({ error: "Operation identifier is invalid." }, { status: 400 });
    const operation = await mobileClient(token).query(mobileApi.getUaOperation, { operationId: id });
    return operation ? NextResponse.json(operation) : NextResponse.json({ error: "Operation not found." }, { status: 404 });
  } catch (error) { return mobileError(error); }
}
