import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    path: "/",
    maxAge: 0
  });
  return response;
}
