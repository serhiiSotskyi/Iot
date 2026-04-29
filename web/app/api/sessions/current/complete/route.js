import { NextResponse } from "next/server";

import { requireBearerToken } from "../../../../../lib/bearerAuth";
import { completeCurrentSession } from "../../../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const unauthorized = requireBearerToken(request, "ADMIN_API_TOKEN");
  if (unauthorized) {
    return unauthorized;
  }

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
