import { NextResponse } from "next/server";

import { recordEvent } from "../../../lib/eventStore";

const MAX_BODY_BYTES = 8 * 1024;
const KNOWN_EVENTS = new Set([
  "setup_status",
  "voice_debug",
  "colour_debug",
  "voice_start",
  "colour_authenticated",
  "movement",
  "init_error",
  "debug",
  "session_complete"
]);

const INGEST_TOKEN = process.env.INGEST_TOKEN || null;
const RATE_LIMIT_PER_MIN = Number(process.env.INGEST_RATE_LIMIT_PER_MIN ?? 0);
const rateBuckets = globalThis.__iotDemoRateBuckets ?? new Map();
if (!globalThis.__iotDemoRateBuckets) {
  globalThis.__iotDemoRateBuckets = rateBuckets;
}

export async function POST(request) {
  try {
    if (INGEST_TOKEN) {
      const header = request.headers.get("authorization") || "";
      const provided = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (provided !== INGEST_TOKEN) {
        return NextResponse.json(
          { ok: false, error: "Unauthorized." },
          { status: 401 }
        );
      }
    }

    if (RATE_LIMIT_PER_MIN > 0 && !allowRequest(request)) {
      return NextResponse.json(
        { ok: false, error: "Rate limit exceeded." },
        { status: 429 }
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Payload too large." },
        { status: 413 }
      );
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON payload." },
        { status: 400 }
      );
    }

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

    if (!KNOWN_EVENTS.has(payload.event)) {
      return NextResponse.json(
        { ok: false, error: `Unknown event type: ${payload.event}` },
        { status: 400 }
      );
    }

    if (payload.event === "movement" && !isValidMovement(payload)) {
      return NextResponse.json(
        { ok: false, error: "Movement payload has invalid numeric fields." },
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

const ACCEL_BOUND_G = 16;
const GYRO_BOUND_DPS = 2000;

function isValidMovement(payload) {
  for (const key of ["ax", "ay", "az"]) {
    if (payload[key] === undefined) continue;
    const v = payload[key];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > ACCEL_BOUND_G) {
      return false;
    }
  }
  for (const key of ["gx", "gy", "gz"]) {
    if (payload[key] === undefined) continue;
    const v = payload[key];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > GYRO_BOUND_DPS) {
      return false;
    }
  }
  if (payload.movementConfidence !== undefined) {
    const c = payload.movementConfidence;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1) {
      return false;
    }
  }
  return true;
}

function allowRequest(request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_MIN;
}
