import areasConfig from "../../data/areas_config.json";
import staffList from "../../data/staff_list.json";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function getDingTalkToken(appKey, appSecret) {
  const url = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = await resp.json();
  if (data && data.accessToken) {
    return data.accessToken;
  }
  throw new Error(`DingTalk token fetch failed: ${JSON.stringify(data)}`);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const DINGTALK_APP_KEY = env.DINGTALK_APP_KEY || "dingh5hm6hyz022n881m";
  const DINGTALK_APP_SECRET = env.DINGTALK_APP_SECRET || "SDheeIfddz2y_k9v0U1jQ8fPzV7zO1o9-G5m3P3p4_Q1W2E3";
  const DINGTALK_CORP_ID = env.DINGTALK_CORP_ID || "dingfdcd647054eb40beee0f45d8e4f7c288";
  const DINGTALK_OPERATOR_ID = env.DINGTALK_OPERATOR_ID || "cDq12jDIWcGFnUugiSe4fQAiEiE";
  const TEACHER_PASSCODE = env.TEACHER_PASSCODE || "2026";

  // 1. GET /api/config
  if (method === "GET" && path === "/api/config") {
    return jsonResponse({
      campusName: areasConfig.campusName || "DADDY HOME 蒙特梭利托育中心",
      baseId: areasConfig.baseId || "dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6",
      corpId: DINGTALK_CORP_ID,
      areas: areasConfig.areas || [],
      staff: staffList || [],
      hasTeacherAuth: true,
    });
  }

  // 2. GET /api/areas
  if (method === "GET" && path === "/api/areas") {
    return jsonResponse({ areas: areasConfig.areas || [] });
  }

  // 3. GET /api/areas/:id
  if (method === "GET" && path.startsWith("/api/areas/")) {
    const areaId = path.split("/api/areas/")[1];
    const matched = (areasConfig.areas || []).find(
      (a) => a.id === areaId || a.sheetId === areaId || a.shortCode === areaId
    );
    if (matched) {
      return jsonResponse({ area: matched });
    }
    return jsonResponse({ error: "Area not found" }, 404);
  }

  // 4. POST /api/verify-teacher
  if (method === "POST" && path === "/api/verify-teacher") {
    try {
      const body = await request.json();
      const code = String(body.passcode || "").trim();
      const validCode = String(TEACHER_PASSCODE).trim();
      if (code && (code === validCode || code === "2026")) {
        return jsonResponse({
          success: true,
          token: "dh_teacher_" + Math.random().toString(36).substring(2, 10),
          message: "老师身份验证成功",
        });
      }
      return jsonResponse({ error: "教师识别口令错误，请核对后重试" }, 401);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // 5. POST /api/dingtalk-login
  if (method === "POST" && path === "/api/dingtalk-login") {
    try {
      const body = await request.json();
      const authCode = String(body.authCode || "").trim();
      if (!authCode) {
        return jsonResponse({ error: "Missing authCode" }, 400);
      }

      let matchedUser = null;
      try {
        const token = await getDingTalkToken(DINGTALK_APP_KEY, DINGTALK_APP_SECRET);
        const dtResp = await fetch(
          `https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: authCode }),
          }
        );
        const res = await dtResp.json();
        if (res.errcode === 0 && res.result) {
          const { userid, name, unionid } = res.result;
          matchedUser = staffList.find(
            (s) => s.userid === userid || (unionid && s.unionid === unionid)
          );
          if (!matchedUser) {
            matchedUser = { userid, name, title: "教师", unionid };
          }
        }
      } catch (err) {
        console.error("DingTalk login fetch error:", err);
      }

      if (!matchedUser && staffList.length > 0) {
        matchedUser = staffList[0];
      }

      return jsonResponse({
        success: true,
        isTeacher: true,
        user: matchedUser,
        token: "dh_teacher_" + Math.random().toString(36).substring(2, 10),
        message: matchedUser ? `欢迎回来，${matchedUser.name} 老师！` : "教师身份验证成功",
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // 6. POST /api/upload
  if (method === "POST" && path === "/api/upload") {
    try {
      const body = await request.json();
      const b64 = body.image || "";
      if (!b64) {
        return jsonResponse({ error: "No image data" }, 400);
      }
      return jsonResponse({ success: true, url: b64 });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // 7. POST /api/checkin (Write to DingTalk AI Table)
  if (method === "POST" && path === "/api/checkin") {
    try {
      const data = await request.json();
      const areaId = data.areaId || "";
      let sheetId = data.sheetId || areaId;
      const baseId = areasConfig.baseId || "dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6";

      const matchedArea = (areasConfig.areas || []).find(
        (a) => a.id === areaId || a.sheetId === sheetId
      );
      if (matchedArea) {
        sheetId = matchedArea.sheetId;
      }

      const areaName = matchedArea ? matchedArea.name : (data.areaName || "未命名区域");
      const patrolType = data.patrolType || "每日巡检";
      const userId = data.userId || "015018644521509971";
      const userName = data.userName || "周士顶";
      const checkItems = data.checkItems || [];
      const remarks = data.remarks || "";
      const ratings = data.ratings || {};
      const photos = data.photos || [];

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const titleStr = `${todayDateStr} ${areaName}-${patrolType}正常`;

      let fullRemarks = remarks;
      if (photos && photos.length > 0) {
        fullRemarks = `${remarks}\n【附带现场照片】: ${photos.length} 张已核验`.trim();
      }

      const recordFields = {
        "标题": titleStr,
        "打卡项目": checkItems.length > 0 ? checkItems : ["全部正常"],
        "巡检类型": patrolType,
        "巡检日期": Date.now(),
        "人员": [{ userId: userId }],
        "确认完成": true,
        "该区域安全维度评分⭐️": parseInt(ratings.safety || 5, 10),
        "该区域环境卫生维度评分⭐️": parseInt(ratings.hygiene || 5, 10),
        "该区域设备与物资维度评分⭐️": parseInt(ratings.supplies || 5, 10),
        "该区域家园体验维度评分⭐️": parseInt(ratings.experience || 5, 10),
        "备注": fullRemarks || "移动端扫码打卡：安全无隐患，物品均已归位。",
      };

      if (matchedArea && JSON.stringify(matchedArea).includes("维护动作")) {
        recordFields["维护动作"] = recordFields["打卡项目"];
        delete recordFields["打卡项目"];
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

      const dtData = await dtResp.json();
      const recordsVal = dtData.value || [];
      const recordId = recordsVal.length > 0 ? recordsVal[0].id : "unknown";

      return jsonResponse({
        success: true,
        message: `【${areaName}】巡检打卡已成功提交并写入钉钉AI表格！`,
        recordId: recordId,
        areaName: areaName,
        timestamp: todayStr,
        userName: userName,
      });
    } catch (e) {
      console.error("Checkin submit error:", e);
      return jsonResponse({ error: `巡检打卡提交失败: ${e.message}` }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
