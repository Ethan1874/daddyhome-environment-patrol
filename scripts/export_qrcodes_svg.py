#!/usr/bin/env python3
"""
Export standalone printable SVG/HTML badges for all areas.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "areas_config.json"
OUT = ROOT / "public" / "exported_badges"
OUT.mkdir(parents=True, exist_ok=True)

def main():
    config = json.loads(DATA.read_text(encoding="utf-8"))
    areas = config.get("areas", [])
    print(f"Loaded {len(areas)} areas for export.")
    
    # We can write an index of all areas for quick reference
    index_md = ["# 园区环境巡检二维码与空间解读速查表\n"]
    index_md.append("| 序号 | 区域名称 | 英文名称 | 内部短码 | 钉钉子表ID | 三词标签 |")
    index_md.append("| :--- | :--- | :--- | :--- | :--- | :--- |")
    
    for i, a in enumerate(areas, 1):
        tags_str = " / ".join(a.get("tags", []))
        index_md.append(f"| {i} | **{a['name']}** | {a['enName']} | `{a['shortCode']}` | `{a['sheetId']}` | {tags_str} |")
        
    (OUT / "README.md").write_text("\n".join(index_md), encoding="utf-8")
    print(f"Generated exported_badges/README.md successfully.")

if __name__ == "__main__":
    main()
