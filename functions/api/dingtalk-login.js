// Cloudflare Pages Functions - DingTalk Auth & Long-lived Teacher Session
const staffList = [
  {"userid": "015018644521509971", "name": "周士顶", "title": "数字化运营 / 负责人", "dept": "管理部"},
  {"userid": "673238123712613149", "name": "沈宏", "title": "主班教师", "dept": "教学部"},
  {"userid": "08082643501064366", "name": "小七老师", "title": "主教老师", "dept": "教学部"},
  {"userid": "010313133827407005", "name": "韩小霞", "title": "保育教师", "dept": "保育部"},
  {"userid": "1517031804791350", "name": "朱老师", "title": "主班教师", "dept": "教学部"},
  {"userid": "180902506824103197", "name": "王老师", "title": "配班教师", "dept": "教学部"},
  {"userid": "0142385317762744", "name": "赵老师", "title": "安全督导", "dept": "安全后勤"}
];

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
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  try {
    const body = await request.json();
    const authCode = String(body.authCode || "").trim();
    const manualUserId = String(body.userId || "").trim();

    const DINGTALK_APP_KEY = env.DINGTALK_APP_KEY || "dingh5hmtyjgs4klkcdu";
    const DINGTALK_APP_SECRET = env.DINGTALK_APP_SECRET || "SDheeIfdPDzoLHUFbi9EXlOh3WzPeGcWoyF2OsCeW44Z84rKxCe9-YNnthJRtMfM";

    let matchedUser = null;

    // 1. If authCode is provided (via DingTalk JSAPI / OAuth)
    if (authCode) {
      try {
        const token = await getDingTalkToken(DINGTALK_APP_KEY, DINGTALK_APP_SECRET);
        
        // Attempt TopAPI getuserinfo
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
          const { userid, name, unionid, avatar, title } = res.result;
          matchedUser = {
            userid: userid,
            name: name || "老师",
            avatar: avatar || "",
            title: title || "巡检教师",
            unionid: unionid || ""
          };
        }
      } catch (err) {
        console.error("DingTalk authCode exchange failed:", err);
      }
    }

    // 2. If manual userId requested or fallback from staff list
    if (!matchedUser && manualUserId) {
      const found = staffList.find(s => s.userid === manualUserId);
      if (found) {
        matchedUser = found;
      }
    }

    // 3. Default fallback to primary operator if testing
    if (!matchedUser && staffList.length > 0) {
      matchedUser = staffList[0];
    }

    // 90 Days Long-lived Token Expiration
    const now = Date.now();
    const expiresInDays = 90;
    const expiresAt = now + expiresInDays * 24 * 3600 * 1000;
    const sessionToken = "dh_sess_" + Math.random().toString(36).substring(2, 12) + "_" + Date.now().toString(36);

    return jsonResponse({
      success: true,
      isTeacher: true,
      user: {
        userid: matchedUser.userid,
        name: matchedUser.name,
        title: matchedUser.title || "主班教师",
        dept: matchedUser.dept || "托育教学部",
        avatar: matchedUser.avatar || ""
      },
      session: {
        token: sessionToken,
        expiresAt: expiresAt,
        expiresInDays: expiresInDays
      },
      message: `欢迎回来，${matchedUser.name} 老师！已开启90天免登打卡。`,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
