import { NextResponse } from "next/server";

import { setLatestEvent } from "../../../lib/latestEventStore";

export async function POST(request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    if (typeof payload.event !== "string" || payload.event.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Payload must include a string event field." },
        { status: 400 }
      );
    }

    const latest = setLatestEvent(payload);
    return NextResponse.json({ ok: true, latest });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid JSON payload."
      },
      { status: 400 }
    );
  }
}

