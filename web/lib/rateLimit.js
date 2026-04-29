const buckets = globalThis.__iotDemoRateBuckets ?? new Map();
if (!globalThis.__iotDemoRateBuckets) {
  globalThis.__iotDemoRateBuckets = buckets;
}

const WINDOW_MS = 60_000;

function clientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function allowRequest(request, limitPerMinute, scope = "default") {
  if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
    return true;
  }

  const key = `${scope}:${clientIp(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.start > WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limitPerMinute;
}
