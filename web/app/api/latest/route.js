import { NextResponse } from "next/server";

import { getLatestEvent } from "../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    latest: await getLatestEvent()
  });
}
