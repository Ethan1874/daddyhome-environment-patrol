// Cloudflare Pages Functions - DingTalk OAuth2 & JSAPI Auth
import staffList from "../data/staff_list.json";
import {
  contentLengthExceeds,
  getSessionSecret,
  isSameOriginRequest,
  issueSessionToken,
  jsonResponse,
  readJsonBody,
  RequestBodyError,
  sanitizeUser,
  secretsMatch,
} from "../_lib/security.js";

async function getDingTalkAppToken(appKey, appSecret) {
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
  throw new Error(`DingTalk app token fetch failed: ${JSON.stringify(data)}`);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse(null, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "Forbidden origin" }, 403);
  if (contentLengthExceeds(request, 16 * 1024)) return jsonResponse({ error: "Request too large" }, 413);

  try {
    const body = await readJsonBody(request, 16 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "请求数据格式无效" }, 400);
    }
    const authCode = String(body.authCode || body.code || "").trim();
    const manualUserId = String(body.userId || "").trim();
    const manualPasscode = String(body.passcode || "");

    const DINGTALK_APP_KEY = String(env.DINGTALK_APP_KEY || "").trim();
    const DINGTALK_APP_SECRET = String(env.DINGTALK_APP_SECRET || "").trim();
    const sessionSecret = getSessionSecret(env);

    if (!sessionSecret) {
      return jsonResponse({ error: "服务端会话密钥未配置" }, 503);
    }
    if (authCode && (!DINGTALK_APP_KEY || !DINGTALK_APP_SECRET)) {
      return jsonResponse({ error: "钉钉应用凭据未配置" }, 503);
    }

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
        const userTokenData = await userTokenResp.json().catch(() => ({}));
        
        if (userTokenResp.ok && userTokenData && userTokenData.accessToken) {
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
          const userMeData = await userMeResp.json().catch(() => ({}));
          if (!userMeResp.ok) throw new Error(`DingTalk profile lookup failed with HTTP ${userMeResp.status}`);
          
          const userName = userMeData.nick || userMeData.name || "老师";
          const userAvatar = userMeData.avatarUrl || "";

          // Resolve corporate userId by unionid if possible
          let corporateUserId = null;
          try {
            if (!unionId) throw new Error("DingTalk user token returned no unionId");
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
            (s.unionid && s.unionid === unionId)
          );

          if (matched) {
            authenticatedUser = sanitizeUser({
              ...matched,
              userid: matched.userid,
              name: matched.name || userName,
              avatar: userAvatar,
            });
          }
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
          if (dtResp.ok && res.errcode === 0 && res.result) {
            const { userid, name, unionid, avatar, title } = res.result;
            const matched = staffList.find(s => s.userid === userid || (unionid && s.unionid === unionid));
            if (matched) {
              authenticatedUser = sanitizeUser({
                ...matched,
                name: matched.name || name,
                avatar: avatar || "",
                title: matched.title || title,
              });
            }
          }
        } catch (err) {
          console.error("DingTalk TopAPI getuserinfo failed:", err);
        }
      }
    }

    // 2. Manual User ID selection (for testing / manual switch)
    if (!authenticatedUser && manualUserId) {
      const manualLoginAllowed = await secretsMatch(manualPasscode, env.TEACHER_PASSCODE);
      if (!manualLoginAllowed) {
        return jsonResponse({ error: "教师名录访问口令无效" }, 401);
      }
      const found = staffList.find(s => s.userid === manualUserId);
      if (found) {
        authenticatedUser = sanitizeUser(found);
      }
    }

    // If still no user matched, return not authenticated so frontend can redirect to OAuth
    if (!authenticatedUser) {
      return jsonResponse({
        success: false,
        authenticated: false,
        error: "未获取到钉钉授权身份，请点击授权登录",
        authUrl: DINGTALK_APP_KEY
          ? `https://login.dingtalk.com/oauth2/auth?client_id=${encodeURIComponent(DINGTALK_APP_KEY)}&response_type=code&scope=openid%20corpid&prompt=consent`
          : null
      }, 401);
    }

    const session = await issueSessionToken(authenticatedUser, sessionSecret, 90);

    return jsonResponse({
      success: true,
      authenticated: true,
      isTeacher: true,
      user: sanitizeUser(authenticatedUser),
      session,
      message: `欢迎回来，${authenticatedUser.name} 老师！已开启90天免登打卡。`,
    });
  } catch (e) {
    if (e instanceof RequestBodyError) return jsonResponse({ error: e.message }, e.status);
    console.error("DingTalk login failed:", e);
    return jsonResponse({ error: "教师身份认证失败，请稍后重试" }, 500);
  }
}
