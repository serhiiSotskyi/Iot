import { NextResponse } from "next/server";

import { SESSION_COOKIE, authConfigured, verifySessionCookie } from "../../../../../lib/auth";
import { requireBearerToken } from "../../../../../lib/bearerAuth";
import { completeCurrentSession } from "../../../../../lib/eventStore";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const cookieValid = await verifySessionCookie(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (!cookieValid) {
    const bearerCheck = requireBearerToken(request, "ADMIN_API_TOKEN");
    if (bearerCheck) return bearerCheck;
    if (authConfigured() && !process.env.ADMIN_API_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }
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
