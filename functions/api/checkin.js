// Cloudflare Pages Function
import areasConfig from "../data/areas_config.json";
import staffList from "../data/staff_list.json";

import {
  authenticateRequest,
  contentLengthExceeds,
  isSameOriginRequest,
  jsonResponse,
  readJsonBody,
  RequestBodyError,
} from "../_lib/security.js";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_REMARKS_LENGTH = 2000;
const MAX_PHOTOS = 5;

class RequestValidationError extends Error {}

function requireRating(value, fieldName) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new RequestValidationError(`${fieldName}评分必须是 1 到 5 的整数`);
  }
  return value;
}

async function getDingTalkToken(appKey, appSecret) {
  const url = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.ok && data && data.accessToken) {
    return data.accessToken;
  }
  throw new Error(`DingTalk token fetch failed: ${JSON.stringify(data)}`);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Forbidden origin" }, 403);
  if (contentLengthExceeds(request, MAX_REQUEST_BYTES)) return jsonResponse({ error: "Request too large" }, 413);

  try {
    const signedUser = await authenticateRequest(request, env);
    const sessionUser = signedUser && (staffList || []).some((staff) => staff.userid === signedUser.userid)
      ? signedUser
      : null;
    if (!sessionUser) return jsonResponse({ error: "教师会话无效或已过期，请重新登录" }, 401);

    const data = await readJsonBody(request, MAX_REQUEST_BYTES);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new RequestValidationError("请求数据格式无效");
    }
    const areaId = String(data.areaId || "").trim();
    const baseId = String(areasConfig.baseId || "").trim();

    const matchedArea = (areasConfig.areas || []).find(
      (a) => a.id === areaId || a.slug === areaId || (a.aliases || []).includes(areaId)
    );
    if (!matchedArea) {
      throw new RequestValidationError("无效的巡检区域");
    }
    const sheetId = matchedArea.sheetId;
    if (!baseId || !sheetId) {
      return jsonResponse({ error: "钉钉表格配置不完整" }, 503);
    }

    const areaName = matchedArea.name;
    const patrolType = String(data.patrolType || "每日巡检");
    if (patrolType !== "每日巡检") throw new RequestValidationError("暂不支持该巡检类型");

    if (!Array.isArray(data.checkItems) || data.checkItems.length === 0) {
      throw new RequestValidationError("请至少确认一个巡检标准项");
    }
    const allowedItems = new Set(matchedArea.checkItems || []);
    const checkItems = [...new Set(data.checkItems.map((item) => String(item)))];
    if (checkItems.length > allowedItems.size || checkItems.some((item) => !allowedItems.has(item))) {
      throw new RequestValidationError("巡检标准项与当前区域配置不一致");
    }

    if (data.remarks !== undefined && data.remarks !== null && typeof data.remarks !== "string") {
      throw new RequestValidationError("巡检备注格式无效");
    }
    const remarks = String(data.remarks || "").trim();
    if (remarks.length > MAX_REMARKS_LENGTH) throw new RequestValidationError("巡检备注不能超过 2000 字");

    const ratings = data.ratings && typeof data.ratings === "object" ? data.ratings : {};
    const normalizedRatings = {
      safety: requireRating(ratings.safety, "安全维度"),
      hygiene: requireRating(ratings.hygiene, "环境卫生维度"),
      supplies: requireRating(ratings.supplies, "设备与物资维度"),
      experience: requireRating(ratings.experience, "家园体验维度"),
    };

    const photos = data.photos === undefined ? [] : data.photos;
    if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) {
      throw new RequestValidationError(`现场照片最多 ${MAX_PHOTOS} 张`);
    }
    const photoReferences = photos.map((reference) => String(reference));
    if (photoReferences.some((reference) => !/^patrol\/[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/.test(reference))) {
      throw new RequestValidationError("现场照片凭据格式无效，请重新上传");
    }
    if (photoReferences.length > 0) {
      if (!env.PATROL_UPLOADS || typeof env.PATROL_UPLOADS.head !== "function") {
        throw new RequestValidationError("照片存储尚未配置，请重新上传");
      }
      for (const reference of photoReferences) {
        const object = await env.PATROL_UPLOADS.head(reference);
        if (!object || object.customMetadata?.userid !== sessionUser.userid) {
          throw new RequestValidationError("现场照片凭据不存在或不属于当前教师");
        }
      }
    }

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const titleStr = `${todayDateStr} ${areaName}-${patrolType}正常`;

    let fullRemarks = remarks;
    if (photoReferences.length > 0) {
      const photoLine = `【现场照片凭据】: ${photoReferences.join(", ")}`;
      fullRemarks = `${remarks}\n${photoLine}`.trim();
    }

    const recordFields = {
      "标题": titleStr,
      "打卡项目": checkItems,
      "巡检类型": patrolType,
      "巡检日期": Date.now(),
      "人员": [{ userId: sessionUser.userid }],
      "确认完成": true,
      "该区域安全维度评分⭐️": normalizedRatings.safety,
      "该区域环境卫生维度评分⭐️": normalizedRatings.hygiene,
      "该区域设备与物资维度评分⭐️": normalizedRatings.supplies,
      "该区域家园体验维度评分⭐️": normalizedRatings.experience,
      "备注": fullRemarks || "移动端扫码打卡：安全无隐患，物品均已归位。",
    };

    if (matchedArea && JSON.stringify(matchedArea).includes("维护动作")) {
      recordFields["维护动作"] = recordFields["打卡项目"];
      delete recordFields["打卡项目"];
    }

    const DINGTALK_APP_KEY = String(env.DINGTALK_APP_KEY || "").trim();
    const DINGTALK_APP_SECRET = String(env.DINGTALK_APP_SECRET || "").trim();
    const DINGTALK_OPERATOR_ID = String(env.DINGTALK_OPERATOR_ID || "").trim();
    if (!DINGTALK_APP_KEY || !DINGTALK_APP_SECRET || !DINGTALK_OPERATOR_ID) {
      return jsonResponse({ error: "钉钉写入配置不完整" }, 503);
    }

    const token = await getDingTalkToken(DINGTALK_APP_KEY, DINGTALK_APP_SECRET);
    const dtUrl = `https://api.dingtalk.com/v1.0/notable/bases/${baseId}/sheets/${sheetId}/records?operatorId=${DINGTALK_OPERATOR_ID}`;
    
    const dtResp = await fetch(dtUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({ records: [{ fields: recordFields }] }),
    });

    const dtData = await dtResp.json().catch(() => ({}));
    if (!dtResp.ok) {
      throw new Error(`DingTalk record create failed with HTTP ${dtResp.status}`);
    }
    const recordsVal = dtData.value || [];
    const recordId = recordsVal.length > 0 ? recordsVal[0].id : "";
    if (!recordId) throw new Error("DingTalk record create returned no record id");

    return jsonResponse({
      success: true,
      message: `【${areaName}】巡检打卡已成功提交并写入钉钉AI表格！`,
      recordId: recordId,
      areaName: areaName,
      timestamp: todayStr,
      userName: sessionUser.name,
    });
  } catch (e) {
    if (e instanceof RequestValidationError) return jsonResponse({ error: e.message }, 400);
    if (e instanceof RequestBodyError) return jsonResponse({ error: e.message }, e.status);
    console.error(JSON.stringify({ message: "checkin_submit_failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonResponse({ error: "巡检打卡提交失败，请稍后重试" }, 502);
  }
}
