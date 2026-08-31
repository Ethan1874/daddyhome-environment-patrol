#!/usr/bin/env python3
"""
DADDY HOME Campus Environment Patrol & Space Education Server
Seamless integration:
- Single QR Code
- DingTalk App Scan -> Internal Staff DingTalk Free-Login & Auto Check-in View
- WeChat / Browser Scan -> Parents Educational Rationale View
"""

import os
import sys
import json
import time
import base64
import binascii
import hashlib
import hmac
import uuid
import re
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = ROOT_DIR / "data"
# Keep local captures outside the deployable static tree. A local operator may
# start a Pages deployment from this checkout, so photos must never become
# accidental public assets.
UPLOADS_DIR = ROOT_DIR / ".local-uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Load .env
def load_env():
    env_paths = [ROOT_DIR / ".env"]
    for ep in env_paths:
        if ep.exists():
            for line in ep.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    os.environ.setdefault(k, v)

load_env()

DINGTALK_APP_KEY = os.environ.get("DINGTALK_APP_KEY", "")
DINGTALK_APP_SECRET = os.environ.get("DINGTALK_APP_SECRET", "")
DINGTALK_CORP_ID = os.environ.get("DINGTALK_CORP_ID", "dingfdcd647054eb40beee0f45d8e4f7c288")
DEFAULT_OPERATOR_ID = os.environ.get("DINGTALK_OPERATOR_ID", "")
TEACHER_PASSCODE = os.environ.get("TEACHER_PASSCODE", "")
PATROL_SESSION_SECRET = os.environ.get("PATROL_SESSION_SECRET", "")

MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_PHOTOS = 5
MIN_SESSION_SECRET_LENGTH = 32

TOKEN_CACHE = {"token": "", "expires_at": 0}

class RequestBodyError(ValueError):
    pass

def get_dingtalk_token():
    if not DINGTALK_APP_KEY or not DINGTALK_APP_SECRET:
        raise RuntimeError("DingTalk credentials are not configured")
    now = time.time()
    if TOKEN_CACHE["token"] and TOKEN_CACHE["expires_at"] > now + 300:
        return TOKEN_CACHE["token"]
    
    url = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
    body = json.dumps({"appKey": DINGTALK_APP_KEY, "appSecret": DINGTALK_APP_SECRET}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            token = data.get("accessToken")
            expire_in = data.get("expireIn", 7200)
            if token:
                TOKEN_CACHE["token"] = token
                TOKEN_CACHE["expires_at"] = now + expire_in
                return token
            raise RuntimeError(f"Failed to get token: {data}")
    except Exception as exc:
        print(f"[Error] DingTalk token fetch failed: {exc}", file=sys.stderr)
        raise

def load_areas_config():
    p = DATA_DIR / "areas_config.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"areas": []}

def load_staff_list():
    p = DATA_DIR / "staff_list.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return []

def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))

def issue_teacher_session(user: dict, expires_in_days: int = 90) -> dict:
    if len(PATROL_SESSION_SECRET) < MIN_SESSION_SECRET_LENGTH:
        raise RuntimeError("PATROL_SESSION_SECRET must contain at least 32 characters")
    expires_at = int((time.time() + expires_in_days * 24 * 3600) * 1000)
    payload = {
        "v": 1,
        "sub": str(user.get("userid", "")),
        "name": str(user.get("name", "老师")),
        "title": str(user.get("title", "巡检教师")),
        "dept": str(user.get("dept", "托育教学部")),
        "exp": expires_at,
    }
    if not payload["sub"]:
        raise ValueError("Cannot issue session without userid")
    encoded = _b64url_encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(PATROL_SESSION_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return {"token": f"{encoded}.{_b64url_encode(signature)}", "expiresAt": expires_at, "expiresInDays": expires_in_days}

def verify_teacher_session(token: str):
    if not token or len(PATROL_SESSION_SECRET) < MIN_SESSION_SECRET_LENGTH:
        return None
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(PATROL_SESSION_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(signature), expected):
            return None
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
        if payload.get("v") != 1 or not payload.get("sub") or int(payload.get("exp", 0)) <= int(time.time() * 1000):
            return None
        return {
            "userid": str(payload["sub"]),
            "name": str(payload.get("name", "老师")),
            "title": str(payload.get("title", "巡检教师")),
            "dept": str(payload.get("dept", "托育教学部")),
        }
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
        return None

def sanitize_staff(user: dict) -> dict:
    return {key: str(user.get(key, "")) for key in ("userid", "name", "title", "dept", "avatar")}

def save_base64_image(b64_str: str) -> str:
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})", str(b64_str))
    if not match:
        raise ValueError("Only JPEG, PNG, and WebP data URLs are supported")
    mime_type, b64_data = match.groups()
    raw_bytes = base64.b64decode(b64_data, validate=True)
    if not raw_bytes or len(raw_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be smaller than 2MB")
    signatures = {
        "image/jpeg": raw_bytes.startswith(b"\xff\xd8\xff"),
        "image/png": raw_bytes.startswith(b"\x89PNG"),
        "image/webp": raw_bytes.startswith(b"RIFF") and raw_bytes[8:12] == b"WEBP",
    }
    if not signatures[mime_type]:
        raise ValueError("Image content does not match its declared type")
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime_type]
    filename = f"patrol_{int(time.time())}_{uuid.uuid4().hex[:6]}{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(raw_bytes)
    return f"/uploads/{filename}"

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class PatrolRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self, maximum=MAX_JSON_BYTES):
        raw_content_len = self.headers.get("Content-Length")
        try:
            content_len = int(raw_content_len) if raw_content_len is not None else 0
        except (TypeError, ValueError):
            raise RequestBodyError("请求体格式无效")
        if content_len <= 0:
            raise RequestBodyError("请求体不能为空")
        if content_len > maximum:
            raise OverflowError("Request body too large")
        try:
            return json.loads(self.rfile.read(content_len).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RequestBodyError("请求体格式无效") from exc

    def authenticated_teacher(self):
        authorization = self.headers.get("Authorization", "")
        if not authorization.lower().startswith("bearer "):
            return None
        session_user = verify_teacher_session(authorization.split(" ", 1)[1].strip())
        if not session_user:
            return None
        if not any(staff.get("userid") == session_user["userid"] for staff in load_staff_list()):
            return None
        return session_user

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/config":
            cfg = load_areas_config()
            session_user = self.authenticated_teacher()
            passcode = self.headers.get("X-Teacher-Passcode", "")
            directory_unlocked = bool(session_user) or bool(TEACHER_PASSCODE and hmac.compare_digest(passcode, TEACHER_PASSCODE))
            public_areas = [{k: v for k, v in area.items() if k not in {"fieldMap", "sheetId"}} for area in cfg.get("areas", [])]
            return self.send_json({
                "campusName": cfg.get("campusName", "DADDY HOME 蒙特梭利托育中心"),
                "corpId": DINGTALK_CORP_ID,
                "areas": public_areas,
                "staff": [sanitize_staff(user) for user in load_staff_list()] if directory_unlocked else [],
                "hasTeacherAuth": bool(session_user),
                "directoryUnlocked": directory_unlocked,
                "user": sanitize_staff(session_user) if session_user else None,
            })

        if path == "/api/areas":
            cfg = load_areas_config()
            return self.send_json({"areas": [{k: v for k, v in area.items() if k not in {"fieldMap", "sheetId"}} for area in cfg.get("areas", [])]})

        if path.startswith("/api/areas/"):
            area_id = path.split("/api/areas/")[1]
            cfg = load_areas_config()
            for a in cfg.get("areas", []):
                if a["id"] == area_id or a["sheetId"] == area_id or a["shortCode"] == area_id:
                    return self.send_json({"area": {k: v for k, v in a.items() if k not in {"fieldMap", "sheetId"}}})
            return self.send_json({"error": "Area not found"}, status=404)

        if path == "/print" or path == "/print/":
            self.path = "/print-qrcodes.html"
            return super().do_GET()

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # DingTalk JSAPI / QR Scan Free-Login
        if path == "/api/dingtalk-login":
            try:
                data = self.read_json_body(maximum=16 * 1024)
                if not isinstance(data, dict):
                    return self.send_json({"error": "请求数据格式无效"}, status=400)
                auth_code = str(data.get("authCode", "")).strip()
                manual_user_id = str(data.get("userId", "")).strip()
                manual_passcode = str(data.get("passcode", ""))
                staff_list = load_staff_list()
                matched_user = None

                if auth_code:
                    token = get_dingtalk_token()
                    dt_url = f"https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token={token}"
                    dt_body = json.dumps({"code": auth_code}).encode("utf-8")
                    req = urllib.request.Request(dt_url, data=dt_body, headers={"Content-Type": "application/json"}, method="POST")
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        res = json.loads(resp.read().decode("utf-8"))
                        if res.get("errcode") == 0 and "result" in res:
                            dt_user = res["result"]
                            user_id = dt_user.get("userid")
                            user_name = dt_user.get("name")
                            union_id = dt_user.get("unionid")
                            matched_user = next((s for s in staff_list if s["userid"] == user_id or (union_id and s["unionid"] == union_id)), None)
                            if matched_user and user_name:
                                matched_user = {**matched_user, "name": matched_user.get("name") or user_name}

                if not matched_user and manual_user_id:
                    if not TEACHER_PASSCODE or not hmac.compare_digest(manual_passcode, TEACHER_PASSCODE):
                        return self.send_json({"error": "教师名录访问口令无效"}, status=401)
                    matched_user = next((s for s in staff_list if s.get("userid") == manual_user_id), None)

                if not matched_user:
                    return self.send_json({"error": "未获取到有效的在册教师身份"}, status=401)

                safe_user = sanitize_staff(matched_user)
                session = issue_teacher_session(safe_user)

                return self.send_json({
                    "success": True,
                    "authenticated": True,
                    "isTeacher": True,
                    "user": safe_user,
                    "session": session,
                    "message": f"欢迎回来，{safe_user['name']} 老师！"
                })

            except RequestBodyError as e:
                return self.send_json({"error": str(e)}, status=400)
            except OverflowError as e:
                return self.send_json({"error": str(e)}, status=413)
            except Exception as e:
                print(f"[Error] DingTalk auth failed: {e}", file=sys.stderr)
                return self.send_json({"error": "教师身份认证失败，请稍后重试"}, status=500)

        if path == "/api/upload":
            try:
                if not self.authenticated_teacher():
                    return self.send_json({"error": "教师会话无效或已过期，请重新登录"}, status=401)
                data = self.read_json_body()
                if not isinstance(data, dict):
                    return self.send_json({"error": "请求数据格式无效"}, status=400)
                b64 = data.get("image", "")
                if not b64:
                    return self.send_json({"error": "No image data provided"}, status=400)
                url = save_base64_image(b64)
                return self.send_json({"success": True, "reference": url.removeprefix("/")})
            except RequestBodyError as e:
                return self.send_json({"error": str(e)}, status=400)
            except OverflowError as e:
                return self.send_json({"error": str(e)}, status=413)
            except ValueError as e:
                return self.send_json({"error": str(e)}, status=400)
            except Exception as e:
                print(f"[Error] Local photo upload failed: {e}", file=sys.stderr)
                return self.send_json({"error": "照片上传失败，请稍后重试"}, status=500)

        if path == "/api/checkin":
            try:
                session_user = self.authenticated_teacher()
                if not session_user:
                    return self.send_json({"error": "教师会话无效或已过期，请重新登录"}, status=401)
                data = self.read_json_body(maximum=256 * 1024)
                if not isinstance(data, dict):
                    return self.send_json({"error": "请求数据格式无效"}, status=400)
                area_id = str(data.get("areaId", "")).strip()
                cfg = load_areas_config()
                base_id = str(cfg.get("baseId", "")).strip()
                
                # Match area
                matched_area = None
                for a in cfg.get("areas", []):
                    if a["id"] == area_id or a.get("slug") == area_id or area_id in a.get("aliases", []):
                        matched_area = a
                        break
                if not matched_area:
                    return self.send_json({"error": "无效的巡检区域"}, status=400)
                sheet_id = matched_area["sheetId"]
                area_name = matched_area["name"]
                if not base_id or not sheet_id:
                    return self.send_json({"error": "钉钉表格配置不完整"}, status=503)
                patrol_type = str(data.get("patrolType", "每日巡检"))
                if patrol_type != "每日巡检":
                    return self.send_json({"error": "暂不支持该巡检类型"}, status=400)

                check_items_raw = data.get("checkItems")
                if not isinstance(check_items_raw, list) or not check_items_raw:
                    return self.send_json({"error": "请至少确认一个巡检标准项"}, status=400)
                allowed_items = set(matched_area.get("checkItems", []))
                check_items = list(dict.fromkeys(str(item) for item in check_items_raw))
                if len(check_items) > len(allowed_items) or any(item not in allowed_items for item in check_items):
                    return self.send_json({"error": "巡检标准项与当前区域配置不一致"}, status=400)

                remarks = str(data.get("remarks", "")).strip()
                if len(remarks) > 2000:
                    return self.send_json({"error": "巡检备注不能超过 2000 字"}, status=400)
                ratings = data.get("ratings", {})
                if not isinstance(ratings, dict):
                    return self.send_json({"error": "评分数据格式无效"}, status=400)
                normalized_ratings = {}
                for dimension in ("safety", "hygiene", "supplies", "experience"):
                    value = ratings.get(dimension)
                    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                        return self.send_json({"error": f"{dimension}评分必须是 1 到 5 的整数"}, status=400)
                    normalized_ratings[dimension] = value

                photo_urls = data.get("photos", [])
                if not isinstance(photo_urls, list) or len(photo_urls) > MAX_PHOTOS:
                    return self.send_json({"error": f"现场照片最多 {MAX_PHOTOS} 张"}, status=400)
                if any(not re.fullmatch(r"uploads/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)", str(ref)) for ref in photo_urls):
                    return self.send_json({"error": "现场照片凭据格式无效，请重新上传"}, status=400)
                for ref in photo_urls:
                    local_photo = UPLOADS_DIR / str(ref).removeprefix("uploads/")
                    if not local_photo.is_file():
                        return self.send_json({"error": "现场照片凭据不存在，请重新上传"}, status=400)

                today_str = time.strftime("%Y-%m-%d %H:%M")
                today_date_str = time.strftime("%Y-%m-%d")
                title_str = f"{today_date_str} {area_name}-{patrol_type}正常"

                full_remarks = remarks
                if photo_urls:
                    photo_text = "【现场照片】: " + ", ".join(photo_urls)
                    full_remarks = f"{remarks}\n{photo_text}" if remarks else photo_text

                # Format fields for DingTalk AI Table
                record_fields = {
                    "标题": title_str,
                    "打卡项目": check_items,
                    "巡检类型": patrol_type,
                    "巡检日期": int(time.time() * 1000),
                    "人员": [{"userId": session_user["userid"]}],
                    "确认完成": True,
                    "该区域安全维度评分⭐️": normalized_ratings["safety"],
                    "该区域环境卫生维度评分⭐️": normalized_ratings["hygiene"],
                    "该区域设备与物资维度评分⭐️": normalized_ratings["supplies"],
                    "该区域家园体验维度评分⭐️": normalized_ratings["experience"],
                    "备注": full_remarks or "移动端扫码打卡：安全无隐患，物品均已归位。"
                }

                # If area has maintenance actions field name variant
                if matched_area and "维护动作" in str(matched_area):
                    record_fields["维护动作"] = record_fields.pop("打卡项目", [])

                # Submit to DingTalk AI table
                if not DEFAULT_OPERATOR_ID:
                    return self.send_json({"error": "钉钉写入配置不完整"}, status=503)
                token = get_dingtalk_token()
                dt_url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/records?operatorId={DEFAULT_OPERATOR_ID}"
                dt_body = json.dumps({"records": [{"fields": record_fields}]}, ensure_ascii=False).encode("utf-8")
                
                dt_req = urllib.request.Request(
                    dt_url,
                    data=dt_body,
                    headers={
                        "Content-Type": "application/json",
                        "x-acs-dingtalk-access-token": token
                    },
                    method="POST"
                )

                with urllib.request.urlopen(dt_req, timeout=20) as resp:
                    dt_resp = json.loads(resp.read().decode("utf-8"))
                    records_val = dt_resp.get("value", [])
                    record_id = records_val[0].get("id") if records_val else ""
                    if not record_id:
                        raise RuntimeError("DingTalk record create returned no record id")

                print(f"[Success] Checkin recorded for {area_name}, Record ID: {record_id}")
                return self.send_json({
                    "success": True,
                    "message": f"【{area_name}】巡检打卡已成功提交并写入钉钉AI表格！",
                    "recordId": record_id,
                    "areaName": area_name,
                    "timestamp": today_str,
                    "userName": session_user["name"],
                    "photoUrls": photo_urls
                })

            except RequestBodyError as e:
                return self.send_json({"error": str(e)}, status=400)
            except OverflowError as e:
                return self.send_json({"error": str(e)}, status=413)
            except Exception as e:
                print(f"[Error] Checkin failed: {e}", file=sys.stderr)
                return self.send_json({"error": "巡检打卡提交失败，请稍后重试"}, status=502)

        self.send_response(404)
        self.end_headers()

def run(port=8000):
    server_address = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(server_address, PatrolRequestHandler)
    print(f"===========================================================")
    print(f"🚀 DADDY HOME 环境巡检系统已启动 (单码双流转 + 钉钉免登)")
    print(f"📱 移动端入口: http://localhost:{port}/?area=MA34iZG")
    print(f"🖨️ 标牌打印中心: http://localhost:{port}/print")
    print(f"📊 钉钉AI表格 Base ID: dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6")
    print(f"🏢 钉钉企业 Corp ID: {DINGTALK_CORP_ID}")
    print(f"===========================================================")
    httpd.serve_forever()

if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
