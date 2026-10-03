import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { grantContextResponse } from "../scoped-grant/_proxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const context = await mobileClient(token).query(mobileApi.getUniswapGrantContext, {});
    return grantContextResponse(context);
  } catch (error) { return mobileError(error); }
}
