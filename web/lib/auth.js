export const SESSION_COOKIE = "iot_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();
let cachedKey = null;
let cachedKeySecret = null;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function getPassword() {
  return process.env.DASHBOARD_PASSWORD || null;
}

export function authConfigured() {
  return Boolean(getSecret() && getPassword());
}

function constantTimeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function passwordMatches(provided) {
  const expected = getPassword();
  if (!expected || typeof provided !== "string") return false;
  return constantTimeEqualString(provided, expected);
}

async function getKey() {
  const secret = getSecret();
  if (!secret) return null;
  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedKeySecret = secret;
  return cachedKey;
}

function bufToHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBuf(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

export async function issueSessionCookie(ttlSeconds = DEFAULT_TTL_SECONDS) {
  const key = await getKey();
  if (!key) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `v1.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return {
    name: SESSION_COOKIE,
    value: `${payload}.${bufToHex(signature)}`,
    maxAge: ttlSeconds
  };
}

export async function verifySessionCookie(rawCookie) {
  const key = await getKey();
  if (!key || !rawCookie) return false;

  const parts = rawCookie.split(".");
  if (parts.length !== 3) return false;

  const [version, expiryStr, signatureHex] = parts;
  if (version !== "v1") return false;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const signatureBytes = hexToBuf(signatureHex);
  if (!signatureBytes) return false;

  const payload = `${version}.${expiryStr}`;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(payload)
    );
  } catch {
    return false;
  }
}
