import { activateGrant } from "../_proxy";

export const runtime = "nodejs";
export async function POST(request: Request) { return activateGrant(request); }
