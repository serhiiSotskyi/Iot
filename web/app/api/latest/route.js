import { NextResponse } from "next/server";

import { getLatestEvent } from "../../../lib/latestEventStore";

export async function GET() {
  return NextResponse.json({
    ok: true,
    latest: getLatestEvent()
  });
}

