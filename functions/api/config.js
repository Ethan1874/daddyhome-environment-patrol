// Cloudflare Pages Function
import areasConfig from "../data/areas_config.json";
import staffList from "../data/staff_list.json";

import {
  authenticateRequest,
  isSameOriginRequest,
  jsonResponse,
  sanitizeUser,
  secretsMatch,
} from "../_lib/security.js";

function publicArea(area) {
  const { fieldMap, sheetId, ...safeArea } = area;
  return safeArea;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "GET") return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Forbidden origin" }, 403);

  const DINGTALK_CORP_ID = env.DINGTALK_CORP_ID || "dingfdcd647054eb40beee0f45d8e4f7c288";
  const signedUser = await authenticateRequest(request, env);
  const sessionUser = signedUser && (staffList || []).some((staff) => staff.userid === signedUser.userid)
    ? signedUser
    : null;
  const passcode = request.headers.get("X-Teacher-Passcode") || "";
  const passcodeValid = await secretsMatch(passcode, env.TEACHER_PASSCODE);
  const canReadDirectory = Boolean(sessionUser || passcodeValid);

  return jsonResponse({
    campusName: areasConfig.campusName || "DADDY HOME 蒙特梭利托育中心",
    corpId: DINGTALK_CORP_ID,
    areas: (areasConfig.areas || []).map(publicArea),
    staff: canReadDirectory ? (staffList || []).map(sanitizeUser) : [],
    hasTeacherAuth: Boolean(sessionUser),
    directoryUnlocked: canReadDirectory,
    user: sessionUser ? sanitizeUser(sessionUser) : null,
  });
}
