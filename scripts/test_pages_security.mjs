#!/usr/bin/env node
// Run against a local Wrangler Pages server configured with test-only bindings.

const base = process.env.PATROL_TEST_BASE_URL || "http://127.0.0.1:8788";
const passcode = process.env.PATROL_TEST_PASSCODE || "test-passcode";

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

async function call(path, options = {}) {
  const headers = { Origin: base, ...(options.headers || {}) };
  const response = await fetchWithRetry(base + path, { ...options, headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const staticPage = await fetchWithRetry(base + "/");
assert(staticPage.headers.get("x-content-type-options") === "nosniff", "static security header missing");
assert(staticPage.headers.get("referrer-policy") === "no-referrer", "static referrer policy missing");

const publicConfig = await call("/api/config");
assert(publicConfig.status === 200, "public config status");
assert(publicConfig.body.staff.length === 0, "public config leaked staff");
assert(!("baseId" in publicConfig.body), "public config leaked baseId");
assert(!("fieldMap" in publicConfig.body.areas[0]), "public config leaked fieldMap");
assert(!("sheetId" in publicConfig.body.areas[0]), "public config leaked sheetId");

const crossOrigin = await fetchWithRetry(base + "/api/config", {
  headers: { Origin: "https://attacker.example" },
});
assert(crossOrigin.status === 403, "cross-origin request was not rejected");

const badDirectory = await call("/api/config", {
  headers: { "X-Teacher-Passcode": "wrong" },
});
assert(
  badDirectory.body.staff.length === 0 && !badDirectory.body.directoryUnlocked,
  "bad passcode unlocked directory"
);

const directory = await call("/api/config", {
  headers: { "X-Teacher-Passcode": passcode },
});
assert(directory.status === 200 && directory.body.staff.length > 0, "directory did not unlock");
assert(
  Object.keys(directory.body.staff[0]).every((key) =>
    ["userid", "name", "title", "dept", "avatar"].includes(key)
  ),
  "directory leaked extra fields"
);

const userid = directory.body.staff[0].userid;
const badLogin = await call("/api/dingtalk-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: userid, passcode: "wrong" }),
});
assert(badLogin.status === 401, "bad manual login accepted");

const malformedLogin = await call("/api/dingtalk-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{",
});
assert(malformedLogin.status === 400, "malformed login JSON was not rejected");

const login = await call("/api/dingtalk-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: userid, passcode }),
});
assert(login.status === 200 && login.body.session.token, "manual login failed");
const auth = { Authorization: `Bearer ${login.body.session.token}` };

const restored = await call("/api/config", { headers: auth });
assert(restored.body.hasTeacherAuth && restored.body.staff.length > 0, "signed session did not restore");
assert(restored.body.user && restored.body.user.userid === userid, "signed session user was not authoritative");

const noAuthUpload = await call("/api/upload", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image: "x" }),
});
assert(noAuthUpload.status === 401, "unauthenticated upload accepted");

const invalidUpload = await call("/api/upload", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ image: "data:text/plain;base64,dGVzdA==" }),
});
assert(invalidUpload.status === 400, "invalid upload accepted");

const malformedUpload = await call("/api/upload", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: "{",
});
assert(malformedUpload.status === 400, "malformed upload JSON was not rejected");

const jpeg =
  "data:image/jpeg;base64," + Buffer.from(Uint8Array.from([255, 216, 255, 224, 1, 2, 3, 4])).toString("base64");
const upload = await call("/api/upload", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ image: jpeg }),
});
assert(upload.status === 200 && /^patrol\//.test(upload.body.reference), "valid R2 upload failed");

const noAuthCheckin = await call("/api/checkin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
assert(noAuthCheckin.status === 401, "unauthenticated checkin accepted");

const invalidArea = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ areaId: "attacker-sheet" }),
});
assert(invalidArea.status === 400, "arbitrary sheet accepted");

const area = publicConfig.body.areas[0];
const injectedItem = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    areaId: area.id,
    checkItems: ["forged-item"],
    ratings: { safety: 5, hygiene: 5, supplies: 5, experience: 5 },
  }),
});
assert(injectedItem.status === 400, "forged check item accepted");

const invalidRating = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    areaId: area.id,
    checkItems: [area.checkItems[0]],
    ratings: { safety: 6, hygiene: 5, supplies: 5, experience: 5 },
  }),
});
assert(invalidRating.status === 400, "out-of-range rating accepted");

const booleanRating = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    areaId: area.id,
    checkItems: [area.checkItems[0]],
    ratings: { safety: true, hygiene: 5, supplies: 5, experience: 5 },
  }),
});
assert(booleanRating.status === 400, "boolean rating accepted");

const missingPhoto = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    areaId: area.id,
    checkItems: [area.checkItems[0]],
    ratings: { safety: 5, hygiene: 5, supplies: 5, experience: 5 },
    photos: ["patrol/2026-01-01/not-uploaded.jpg"],
  }),
});
assert(missingPhoto.status === 400, "missing photo reference accepted");

const malformedCheckin = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: "{",
});
assert(malformedCheckin.status === 400, "malformed checkin JSON was not rejected");

const oversizedCheckin = await call("/api/checkin", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ payload: "x".repeat(300 * 1024) }),
});
assert(oversizedCheckin.status === 413, "oversized checkin body was not rejected");

console.log(JSON.stringify({ scenarios: passed, passed, uploadPersisted: true }));
