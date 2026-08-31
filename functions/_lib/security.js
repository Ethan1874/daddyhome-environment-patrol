const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MIN_SESSION_SECRET_LENGTH = 32;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export function contentLengthExceeds(request, maximumBytes) {
  const raw = request.headers.get("Content-Length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maximumBytes;
}

export class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(request, maximumBytes) {
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maximumBytes) {
    throw new RequestBodyError("Request too large", 413);
  }
  if (!raw.trim()) throw new RequestBodyError("Invalid JSON", 400);
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestBodyError("Invalid JSON", 400);
  }
}

export function getSessionSecret(env) {
  const secret = String(env.PATROL_SESSION_SECRET || "").trim();
  return secret.length >= MIN_SESSION_SECRET_LENGTH ? secret : "";
}

export function sanitizeUser(user) {
  return {
    userid: String(user.userid || ""),
    name: String(user.name || "老师"),
    title: String(user.title || "巡检教师"),
    dept: String(user.dept || "托育教学部"),
    avatar: String(user.avatar || ""),
  };
}

export async function issueSessionToken(user, secret, expiresInDays = 90) {
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error("PATROL_SESSION_SECRET must contain at least 32 characters");
  }
  const safeUser = sanitizeUser(user);
  if (!safeUser.userid) throw new Error("Cannot issue a session without userid");

  const now = Date.now();
  const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000;
  const payload = {
    v: 1,
    sub: safeUser.userid,
    name: safeUser.name,
    title: safeUser.title,
    dept: safeUser.dept,
    iat: now,
    exp: expiresAt,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return {
    token: `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt,
    expiresInDays,
  };
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(parts[1]),
      encoder.encode(parts[0])
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(fromBase64Url(parts[0])));
    if (payload.v !== 1 || !payload.sub || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      return null;
    }
    return {
      userid: String(payload.sub),
      name: String(payload.name || "老师"),
      title: String(payload.title || "巡检教师"),
      dept: String(payload.dept || "托育教学部"),
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function authenticateRequest(request, env) {
  return verifySessionToken(getBearerToken(request), getSessionSecret(env));
}

export async function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(provided))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected))),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}
