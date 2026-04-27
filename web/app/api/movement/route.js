import { NextResponse } from "next/server";

import { recordEvent } from "../../../lib/eventStore";

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

    const result = await recordEvent(payload);
    return NextResponse.json({ ok: true, ...result });
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
