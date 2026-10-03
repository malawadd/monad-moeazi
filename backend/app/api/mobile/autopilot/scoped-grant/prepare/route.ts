import { prepareGrant } from "../_proxy";

export const runtime = "nodejs";
export async function POST(request: Request) { return prepareGrant(request); }
