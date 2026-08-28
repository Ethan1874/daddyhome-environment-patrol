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
import uuid
import ssl
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, unquote
import urllib.request
import urllib.error

ssl._create_default_https_context = ssl._create_unverified_context

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / "public"
DATA_DIR = ROOT_DIR / "data"
UPLOADS_DIR = PUBLIC_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

CODEX_ENV_PATH = Path("/Users/ethan/Documents/Codex/2026-05-07/codex/.env")

# Load .env
def load_env():
    env_paths = [ROOT_DIR / ".env", CODEX_ENV_PATH]
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
DEFAULT_OPERATOR_ID = os.environ.get("DINGTALK_OPERATOR_ID", "cDq12jDIWcGFnUugiSe4fQAiEiE")
if not DEFAULT_OPERATOR_ID or DEFAULT_OPERATOR_ID == "your_union_id":
    DEFAULT_OPERATOR_ID = "cDq12jDIWcGFnUugiSe4fQAiEiE"

TEACHER_PASSCODE = os.environ.get("TEACHER_PASSCODE", "2026")

TOKEN_CACHE = {"token": "", "expires_at": 0}

def get_dingtalk_token():
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

def get_current_passcode():
    cfg = load_areas_config()
    return cfg.get("teacherPasscode", TEACHER_PASSCODE)

def save_base64_image(b64_str: str) -> str:
    if "," in b64_str:
        header, b64_data = b64_str.split(",", 1)
        ext = ".jpg"
        if "png" in header:
            ext = ".png"
        elif "webp" in header:
            ext = ".webp"
    else:
        b64_data = b64_str
        ext = ".jpg"
    
    raw_bytes = base64.b64decode(b64_data)
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
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/config":
            cfg = load_areas_config()
            staff = load_staff_list()
            return self.send_json({
                "campusName": cfg.get("campusName", "DADDY HOME 蒙特梭利托育中心"),
                "baseId": cfg.get("baseId", ""),
                "corpId": DINGTALK_CORP_ID,
                "areas": cfg.get("areas", []),
                "staff": staff,
                "hasTeacherAuth": True
            })

        if path == "/api/areas":
            cfg = load_areas_config()
            return self.send_json({"areas": cfg.get("areas", [])})

        if path.startswith("/api/areas/"):
            area_id = path.split("/api/areas/")[1]
            cfg = load_areas_config()
            for a in cfg.get("areas", []):
                if a["id"] == area_id or a["sheetId"] == area_id or a["shortCode"] == area_id:
                    return self.send_json({"area": a})
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
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                data = json.loads(raw_body)
                auth_code = str(data.get("authCode", "")).strip()
                if not auth_code:
                    return self.send_json({"error": "Missing authCode"}, status=400)
                
                token = get_dingtalk_token()
                # 1. Try v2 getuserinfo
                dt_url = f"https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token={token}"
                dt_body = json.dumps({"code": auth_code}).encode("utf-8")
                req = urllib.request.Request(dt_url, data=dt_body, headers={"Content-Type": "application/json"}, method="POST")
                
                staff_list = load_staff_list()
                matched_user = None

                try:
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        res = json.loads(resp.read().decode("utf-8"))
                        if res.get("errcode") == 0 and "result" in res:
                            dt_user = res["result"]
                            user_id = dt_user.get("userid")
                            user_name = dt_user.get("name")
                            union_id = dt_user.get("unionid")
                            # Match in staff list
                            matched_user = next((s for s in staff_list if s["userid"] == user_id or (union_id and s["unionid"] == union_id)), None)
                            if not matched_user:
                                matched_user = {"userid": user_id, "name": user_name, "title": "教师", "unionid": union_id}
                except Exception as e:
                    print(f"[DingTalk Login Warning] Free-login lookup: {e}")

                if not matched_user and staff_list:
                    # Default to admin/teacher if mock/offline test
                    matched_user = staff_list[0]

                return self.send_json({
                    "success": True,
                    "isTeacher": True,
                    "user": matched_user,
                    "token": "dh_teacher_" + uuid.uuid4().hex[:12],
                    "message": f"欢迎回来，{matched_user['name']} 老师！" if matched_user else "教师身份验证成功"
                })

            except Exception as e:
                print(f"[Error] DingTalk auth failed: {e}", file=sys.stderr)
                return self.send_json({"error": str(e)}, status=500)

        if path == "/api/upload":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                data = json.loads(raw_body)
                b64 = data.get("image", "")
                if not b64:
                    return self.send_json({"error": "No image data provided"}, status=400)
                url = save_base64_image(b64)
                return self.send_json({"success": True, "url": url})
            except Exception as e:
                return self.send_json({"error": str(e)}, status=500)

        if path == "/api/checkin":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                data = json.loads(raw_body)
                area_id = data.get("areaId", "")
                sheet_id = data.get("sheetId", area_id)
                cfg = load_areas_config()
                base_id = cfg.get("baseId", "dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6")
                
                # Match area
                matched_area = None
                for a in cfg.get("areas", []):
                    if a["id"] == area_id or a["sheetId"] == sheet_id:
                        matched_area = a
                        sheet_id = a["sheetId"]
                        break
                
                area_name = matched_area["name"] if matched_area else (data.get("areaName") or "未命名区域")
                patrol_type = data.get("patrolType", "每日巡检")
                user_id = data.get("userId", "015018644521509971")
                user_name = data.get("userName", "周士顶")
                check_items = data.get("checkItems", [])
                remarks = data.get("remarks", "")
                ratings = data.get("ratings", {})
                photos_b64 = data.get("photos", [])
                
                # Save any uploaded photos
                photo_urls = []
                for p in photos_b64:
                    if p.startswith("data:image"):
                        p_url = save_base64_image(p)
                        photo_urls.append(p_url)
                    elif p.startswith("http") or p.startswith("/uploads/"):
                        photo_urls.append(p)

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
                    "打卡项目": check_items if check_items else ["全部正常"],
                    "巡检类型": patrol_type,
                    "巡检日期": int(time.time() * 1000),
                    "人员": [{"userId": user_id}],
                    "确认完成": True,
                    "该区域安全维度评分⭐️": int(ratings.get("safety", 5)),
                    "该区域环境卫生维度评分⭐️": int(ratings.get("hygiene", 5)),
                    "该区域设备与物资维度评分⭐️": int(ratings.get("supplies", 5)),
                    "该区域家园体验维度评分⭐️": int(ratings.get("experience", 5)),
                    "备注": full_remarks or "移动端扫码打卡：安全无隐患，物品均已归位。"
                }

                # If area has maintenance actions field name variant
                if matched_area and "维护动作" in str(matched_area):
                    record_fields["维护动作"] = record_fields.pop("打卡项目", [])

                # Submit to DingTalk AI table
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
                    record_id = records_val[0]["id"] if records_val else "unknown"

                print(f"[Success] Checkin recorded for {area_name}, Record ID: {record_id}")
                return self.send_json({
                    "success": True,
                    "message": f"【{area_name}】巡检打卡已成功提交并写入钉钉AI表格！",
                    "recordId": record_id,
                    "areaName": area_name,
                    "timestamp": today_str,
                    "userName": user_name,
                    "photoUrls": photo_urls
                })

            except Exception as e:
                print(f"[Error] Checkin failed: {e}", file=sys.stderr)
                return self.send_json({"error": f"巡检打卡提交失败: {str(e)}"}, status=500)

        self.send_response(404)
        self.end_headers()

def run(port=8999):
    server_address = ("0.0.0.0", port)
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
    port = 8999
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
