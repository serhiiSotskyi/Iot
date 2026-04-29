import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export function requireBearerToken(request, ...envNames) {
  const expectedTokens = envNames
    .map((envName) => process.env[envName])
    .filter((token) => typeof token === "string" && token.length > 0);

  if (expectedTokens.length === 0) {
    return null;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (expectedTokens.some((expectedToken) => tokensMatch(token, expectedToken))) {
    return null;
  }

  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function tokensMatch(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
