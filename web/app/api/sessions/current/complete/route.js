import { NextResponse } from "next/server";

import { completeCurrentSession } from "../../../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await completeCurrentSession();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to complete session."
      },
      { status: 500 }
    );
  }
}
