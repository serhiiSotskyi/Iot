import { NextResponse } from "next/server";

import { listSessions } from "../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    sessions: await listSessions()
  });
}
