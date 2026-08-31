// Cloudflare Pages Function
import staffList from "../data/staff_list.json";
import {
  authenticateRequest,
  contentLengthExceeds,
  isSameOriginRequest,
  jsonResponse,
  readJsonBody,
  RequestBodyError,
} from "../_lib/security.js";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: "png", signature: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { extension: "webp", signature: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

class ImageValidationError extends Error {}

function decodeImageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new ImageValidationError("仅支持 JPEG、PNG 或 WebP 图片");

  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new ImageValidationError("图片编码无效");
  }
  if (binary.length === 0 || binary.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError("单张图片大小必须小于 2MB");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const type = IMAGE_TYPES[match[1]];
  if (!type.signature(bytes)) throw new ImageValidationError("图片内容与声明格式不一致");
  return { bytes, contentType: match[1], extension: type.extension };
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
    if (!env.PATROL_UPLOADS || typeof env.PATROL_UPLOADS.put !== "function") {
      return jsonResponse({ error: "照片存储尚未配置，请联系管理员" }, 503);
    }

    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ImageValidationError("上传数据格式无效");
    }
    const image = decodeImageDataUrl(body.image);
    const day = new Date().toISOString().slice(0, 10);
    const key = `patrol/${day}/${crypto.randomUUID()}.${image.extension}`;
    await env.PATROL_UPLOADS.put(key, image.bytes, {
      httpMetadata: { contentType: image.contentType },
      customMetadata: { userid: sessionUser.userid, teacher: sessionUser.name },
    });
    return jsonResponse({ success: true, reference: key });
  } catch (e) {
    const message = e && e.message ? e.message : "照片上传失败";
    const isValidationError = e instanceof ImageValidationError;
    if (e instanceof RequestBodyError) return jsonResponse({ error: e.message }, e.status);
    if (!isValidationError) console.error("Photo upload error:", e);
    return jsonResponse({ error: isValidationError ? message : "照片上传失败，请稍后重试" }, isValidationError ? 400 : 500);
  }
}
