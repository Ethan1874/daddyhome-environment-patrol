// Cloudflare Pages Functions - Comprehensive DingTalk OAuth2 & JSAPI Auth
const staffList = [
  {"userid": "015018644521509971", "name": "周士顶", "title": "数字化运营 / 负责人", "dept": "管理部", "mobile": "18600000000"},
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

async function getDingTalkAppToken(appKey, appSecret) {
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
  throw new Error(`DingTalk app token fetch failed: ${JSON.stringify(data)}`);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  try {
    const body = await request.json();
    const authCode = String(body.authCode || body.code || "").trim();
    const manualUserId = String(body.userId || "").trim();

    const DINGTALK_APP_KEY = env.DINGTALK_APP_KEY || "dingh5hmtyjgs4klkcdu";
    const DINGTALK_APP_SECRET = env.DINGTALK_APP_SECRET || "SDheeIfdPDzoLHUFbi9EXlOh3WzPeGcWoyF2OsCeW44Z84rKxCe9-YNnthJRtMfM";

    let authenticatedUser = null;

    // 1. Handle OAuth2 / JSAPI authCode
    if (authCode) {
      // Approach A: DingTalk v1.0 User Access Token (OAuth2 flow)
      try {
        const userTokenResp = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: DINGTALK_APP_KEY,
            clientSecret: DINGTALK_APP_SECRET,
            code: authCode,
            grantType: "authorization_code"
          })
        });
        const userTokenData = await userTokenResp.json();
        
        if (userTokenData && userTokenData.accessToken) {
          const userAccessToken = userTokenData.accessToken;
          const unionId = userTokenData.unionId;
          
          // Get user profile
          const userMeResp = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "x-acs-dingtalk-access-token": userAccessToken
            }
          });
          const userMeData = await userMeResp.json();
          
          const userName = userMeData.nick || userMeData.name || "老师";
          const userAvatar = userMeData.avatarUrl || "";
          const userMobile = userMeData.mobile || "";
          const userOpenId = userMeData.openId || "";

          // Resolve corporate userId by unionid if possible
          let corporateUserId = userTokenData.corpId ? null : null;
          try {
            const appToken = await getDingTalkAppToken(DINGTALK_APP_KEY, DINGTALK_APP_SECRET);
            const byUnionResp = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${appToken}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ unionid: unionId })
            });
            const byUnionData = await byUnionResp.json();
            if (byUnionData.errcode === 0 && byUnionData.result) {
              corporateUserId = byUnionData.result.userid;
            }
          } catch(e) {
            console.error("getbyunionid error:", e);
          }

          // Match in staff list
          const matched = staffList.find(s => 
            (corporateUserId && s.userid === corporateUserId) ||
            (s.unionid && s.unionid === unionId) ||
            (userMobile && s.mobile === userMobile) ||
            (s.name === userName)
          );

          authenticatedUser = {
            userid: corporateUserId || (matched ? matched.userid : "015018644521509971"),
            name: userName,
            avatar: userAvatar,
            title: matched ? matched.title : "巡检教师",
            dept: matched ? matched.dept : "托育教学部",
            unionid: unionId,
            openId: userOpenId
          };
        }
      } catch (err) {
        console.error("DingTalk v1.0 userAccessToken failed:", err);
      }

      // Approach B: TopAPI v2 JSAPI Code (fallback)
      if (!authenticatedUser) {
        try {
          const appToken = await getDingTalkAppToken(DINGTALK_APP_KEY, DINGTALK_APP_SECRET);
          const dtResp = await fetch(
            `https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${appToken}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: authCode }),
            }
          );
          const res = await dtResp.json();
          if (res.errcode === 0 && res.result) {
            const { userid, name, unionid, avatar, title } = res.result;
            const matched = staffList.find(s => s.userid === userid || (unionid && s.unionid === unionid));
            authenticatedUser = {
              userid: userid,
              name: name || (matched ? matched.name : "老师"),
              avatar: avatar || "",
              title: title || (matched ? matched.title : "巡检教师"),
              dept: matched ? matched.dept : "托育教学部",
              unionid: unionid || ""
            };
          }
        } catch (err) {
          console.error("DingTalk TopAPI getuserinfo failed:", err);
        }
      }
    }

    // 2. Manual User ID selection (for testing / manual switch)
    if (!authenticatedUser && manualUserId) {
      const found = staffList.find(s => s.userid === manualUserId);
      if (found) {
        authenticatedUser = {
          userid: found.userid,
          name: found.name,
          title: found.title || "主班教师",
          dept: found.dept || "托育教学部",
          avatar: found.avatar || ""
        };
      }
    }

    // If still no user matched, return not authenticated so frontend can redirect to OAuth
    if (!authenticatedUser) {
      return jsonResponse({
        success: false,
        authenticated: false,
        error: "未获取到钉钉授权身份，请点击授权登录",
        authUrl: `https://login.dingtalk.com/oauth2/auth?client_id=${DINGTALK_APP_KEY}&response_type=code&scope=openid%20corpid&state=patrol&prompt=consent`
      }, 401);
    }

    // 90 Days Long-Lived Session
    const now = Date.now();
    const expiresInDays = 90;
    const expiresAt = now + expiresInDays * 24 * 3600 * 1000;
    const sessionToken = "dh_sess_" + Math.random().toString(36).substring(2, 12) + "_" + Date.now().toString(36);

    return jsonResponse({
      success: true,
      authenticated: true,
      isTeacher: true,
      user: authenticatedUser,
      session: {
        token: sessionToken,
        expiresAt: expiresAt,
        expiresInDays: expiresInDays
      },
      message: `欢迎回来，${authenticatedUser.name} 老师！已开启90天免登打卡。`,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
