// Cloudflare Pages Function
import areasConfig from "../data/areas_config.json";

import { isSameOriginRequest, jsonResponse } from "../_lib/security.js";

function publicArea(area) {
  const { fieldMap, sheetId, ...safeArea } = area;
  return safeArea;
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "GET") return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Forbidden origin" }, 403);
  return jsonResponse({ areas: (areasConfig.areas || []).map(publicArea) });
}
