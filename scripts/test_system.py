#!/usr/bin/env python3
import sys
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server

def test_local_api():
    print("1. Testing config loading...")
    cfg = server.load_areas_config()
    areas = cfg.get("areas", [])
    print(f"   Loaded {len(areas)} areas.")
    assert len(areas) >= 8, "Areas count should be >= 8"

    print("2. Testing DingTalk token fetch...")
    token = server.get_dingtalk_token()
    assert bool(token), "Token should not be empty"
    print("   Token fetched successfully!")

    print("3. Testing mock checkin on '木工教室' (ge6m9XC)...")
    wood_area = next(a for a in areas if a["id"] == "ge6m9XC")
    
    # Direct test of checkin payload
    today_date = time.strftime("%Y-%m-%d")
    record_fields = {
        "标题": f"{today_date} 木工教室-日常巡检正常",
        "打卡项目": [
            "工具归位（锯、锤、钻、电动工具等收纳在指定位置，幼儿不可随意触碰）",
            "危险品管理（刀具、钉子、螺丝等存放在封闭容器内）",
            "电源安全（电动工具电源关闭，无裸露电线）",
            "工作台面（无木屑、钉子残留，保持干净平整）",
            "防护用品（护目镜、手套齐备、清洁）",
            "地面环境（无木屑、杂物，通道畅通，防滑）",
            "设备清洁（电锯等常用设备表面无尘土污渍）"
        ],
        "巡检类型": "每日巡检",
        "巡检日期": int(time.time() * 1000),
        "人员": [{"userId": "015018644521509971"}],
        "确认完成": True,
        "该区域安全维度评分⭐️": 5,
        "该区域环境卫生维度评分⭐️": 5,
        "该区域设备与物资维度评分⭐️": 5,
        "该区域家园体验维度评分⭐️": 5,
        "备注": "系统自动化测试巡检：木工教室工具均已归位上锁，工作台清理平整，护目镜消杀齐备。"
    }

    base_id = cfg.get("baseId")
    sheet_id = wood_area["sheetId"]
    op_id = server.DEFAULT_OPERATOR_ID
    
    dt_url = f"https://api.dingtalk.com/v1.0/notable/bases/{base_id}/sheets/{sheet_id}/records?operatorId={op_id}"
    dt_body = json.dumps({"records": [{"fields": record_fields}]}, ensure_ascii=False).encode("utf-8")
    
    req = urllib.request.Request(
        dt_url,
        data=dt_body,
        headers={
            "Content-Type": "application/json",
            "x-acs-dingtalk-access-token": token
        },
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=20) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("   DingTalk API Response:", res)
        record_id = res["value"][0]["id"]
        print(f"   Successfully wrote record to 木工教室! Record ID: {record_id}")

    print("\nAll integration tests passed successfully!")

if __name__ == "__main__":
    test_local_api()
