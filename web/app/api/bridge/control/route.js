import { NextResponse } from "next/server";

import { consumeBridgeControlState } from "../../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await consumeBridgeControlState();
    return NextResponse.json({ ok: true, ...state });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to read bridge control state."
      },
      { status: 500 }
    );
  }
}
