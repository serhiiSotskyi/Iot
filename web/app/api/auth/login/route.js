import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  authConfigured,
  issueSessionCookie,
  passwordMatches
} from "../../../../lib/auth";
import { allowRequest } from "../../../../lib/rateLimit";

const LOGIN_LIMIT_PER_MIN = 8;

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!allowRequest(request, LOGIN_LIMIT_PER_MIN, "login")) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a minute and try again." },
      { status: 429 }
    );
  }

  if (!authConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Login is not enabled on this deployment. Set DASHBOARD_PASSWORD and SESSION_SECRET."
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const password = body?.password;
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Password required." },
      { status: 400 }
    );
  }

  if (!passwordMatches(password)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect password." },
      { status: 401 }
    );
  }

  const cookie = await issueSessionCookie();
  if (!cookie) {
    return NextResponse.json(
      { ok: false, error: "Server cannot issue a session cookie." },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    path: "/",
    maxAge: cookie.maxAge
  });
  return response;
}
