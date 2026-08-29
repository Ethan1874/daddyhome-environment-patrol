# DADDY HOME 园区空间巡检与教育解读系统 · 完整项目交接手册

> **版本**：v2.0 (2026 生产稳定版)  
> **项目名称**：DADDY HOME Campus Environment Patrol & Space Education System  
> **代码仓库**：[Ethan1874/daddyhome-environment-patrol](https://github.com/Ethan1874/daddyhome-environment-patrol)  
> **本地目录**：`/Users/ethan/.gemini/antigravity/scratch/campus-environment-patrol`  

---

## 1. 系统概述与双端业务架构

本项目为 **DADDY HOME 蒙特梭利托育中心** 量身定制的「空间教育解读」与「教师环境巡检」双端合一 Web 应用系统。

```
                       ┌───────────────────────────────┐
                       │   用户扫码 (实体标牌二维码)    │
                       └───────────────┬───────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     【家长端 / 微信 / 外部浏览器】                    【教师端 / 钉钉 App / 内部域名】
   patrol.daddyhome.love/life-farm               patrol.daddyhome.club/life-farm
                │                                             │
                ▼                                             ▼
   ┌──────────────────────────┐                  ┌──────────────────────────┐
   │ 纯净 8 幕长图全屏平滑流    │                  │  90天免登教师身份认证卡    │
   │  - 零多余UI，专注教育解读 │                  │  - 真实姓名与 userId 锁定 │
   │  - 1242px 高保真无缝切片  │                  │  - ⚡ 一键全部标准合格    │
   │  - 自适应移动端首屏秒开   │                  │  - 📷 现场拍照核验与评分  │
   └──────────────────────────┘                  └────────────┬─────────────┘
                                                              │
                                                              ▼ (POST /api/checkin)
                                                 ┌──────────────────────────┐
                                                 │   钉钉 Notable AI 多维表格 │
                                                 │   - 人员自动关联打卡老师  │
                                                 │   - 实时生成流水号与凭证  │
                                                 └──────────────────────────┘
```

---

## 2. 线上访问矩阵与域名配置

| 端口/场景 | 正式访问域名 | 承载功能 | 部署平台 |
| :--- | :--- | :--- | :--- |
| **对外·家长端** | **`https://patrol.daddyhome.love`**<br>`https://patrol.daddyhome.love/life-farm` | 纯净 8 幕长图流教育解读，供家长微信扫码查看 | Cloudflare Pages (Custom Domain) |
| **对内·教师端** | **`https://patrol.daddyhome.club`**<br>`https://patrol.daddyhome.club/life-farm` | 钉钉免登鉴权巡检工作台，供教职工巡检打卡 | Cloudflare Pages (Custom Domain) |
| **主部署域名** | `https://daddyhome-environment-patrol.pages.dev` | Cloudflare Pages 默认生产边缘节点 | Cloudflare Pages |

---

## 3. 技术栈与架构选型

* **前端架构**：
  * 原生现代 SPA（Vanilla HTML5 / Modern CSS / ES6+ JavaScript），**零打包依赖、零构建耗时**；
  * **内联高保真样式（Zero-Cache Inline CSS）**：规避微信/钉钉内置浏览器的外部样式强缓存问题；
  * 钉钉 JSAPI 3.0 SDK（`https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.25/dingtalk.open.js`）；
* **后端架构**：
  * **Cloudflare Pages Functions**（基于 V8 引擎的 Serverless Edge API）；
  * Node.js / Web Fetch 标准协议直连钉钉 OpenAPI；
* **数据库 / 持久化**：
  * **钉钉 Notable 多维表格（AI Table）** 作为云端数据库存储巡检记录；
  * 本地 `localStorage` 存储 90 天超长教师 Session 令牌；
  * 静态 JSON 配置库作为区域元数据和在册人员兜底字典。

---

## 4. 关键配置与凭证清单 (Credentials)

> **⚠️ 注意**：以下凭据已内置于后端接口，接手后如需更换企业应用，可在 `functions/api/` 或 Cloudflare 环境变量中更新：

| 配置项 | 参数值 | 说明 |
| :--- | :--- | :--- |
| **钉钉 AppKey** | `dingh5hmtyjgs4klkcdu` | 钉钉开放平台企业内部应用 AppKey |
| **钉钉 AppSecret** | `SDheeIfdPDzoLHUFbi9EXlOh3WzPeGcWoyF2OsCeW44Z84rKxCe9-YNnthJRtMfM` | 钉钉应用通信凭证 |
| **钉钉 CorpId** | `dingfdcd647054eb40beee0f45d8e4f7c288` | 上海杨浦睿福托育有限公司企业 ID |
| **操作人 OperatorId** | `cDq12jDIWcGFnUugiSe4fQAiEiE` | 钉钉 Notable AI 表格操作员 ID |
| **Notable BaseId** | `dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6` | 巡检多维数据表母表 BaseId |
| **生命场 SheetId** | `2tr0bHx` | 生命场子表唯一 ID |

---

## 5. 项目完整文件结构图谱

```text
campus-environment-patrol/
├── HANDOVER.md                                # 本交接手册
├── server.py                                  # 本地调试用轻量 HTTP Server
│
├── functions/                                 # 后端 Serverless 接口 (Cloudflare Pages)
│   ├── api/
│   │   ├── dingtalk-login.js                  # 钉钉 OAuth2 / JSAPI 免登与 Token 签发
│   │   ├── checkin.js                         # 巡检打卡直写钉钉 Notable AI 表格
│   │   ├── areas.js                           # 空间配置列表接口
│   │   ├── config.js                          # 全局配置与通讯录花名册接口
│   │   └── upload.js                          # 现场拍照上传处理
│   └── data/
│       ├── areas_config.json                  # 9 大空间标准及生命场长图数据
│       └── staff_list.json                    # 48 位在册教职工钉钉 userId 映射
│
├── public/                                    # 前端静态发布目录 (Cloudflare Pages Root)
│   ├── index.html                             # 核心 SPA 入口 (内嵌完整 CSS 样式)
│   ├── 404.html                               # SPA 路由重定向兜底
│   ├── _redirects                             # 路由重写规则 (/api/* 与 SPA 规则)
│   ├── app.js                                 # 核心业务逻辑 (鉴权、免登、打卡、路由)
│   ├── style.css                              # 独立样式表
│   ├── print-qrcodes.html                     # 园区 9 大空间二维码批量生成与打印工具
│   │
│   ├── life-farm/index.html                   # /life-farm 生命场专属子路由
│   ├── woodworking/index.html                 # /woodworking 木工坊子路由
│   ├── hall/index.html                        # /hall 大厅子路由
│   ├── adventure/index.html                   # /adventure 冒险岛子路由
│   ├── lawn/index.html                        # /lawn 草坪子路由
│   ├── gate/index.html                        # /gate 园区大门子路由
│   ├── weplay/index.html                      # /weplay 运动区子路由
│   ├── cospace/index.html                     # /cospace 联合工坊子路由
│   ├── veranda/index.html                     # /veranda 连廊子路由
│   │
│   └── assets/
│       ├── life_farm_qrcode.png               # 生命场专属二维码
│       ├── life_farm_specimen_badge.png       # 喜茶风实体标牌设计稿
│       ├── life_farm_v2/                      # 家长端最新 8 幕切片长图
│       │   ├── p1.jpg ~ p8.jpg (对应 2.png ~ 9.png)
│       │   └── p1.png ~ p8.png (高清原图备份)
│       └── parent_details/                    # 备用合成大图 full_detail.jpg
│
└── data/                                      # 根目录数据字典备份
    ├── areas_config.json
    └── staff_list.json
```

---

## 6. 核心业务流程与实现细节

### 6.1 家长端（纯 8 幕长图流）
* **切片对应关系**（源自 `/Users/ethan/Downloads/生命场`）：
  * `p1.jpg` ➔ `2.png`（扫码总纲封面）
  * `p2.jpg` ➔ `3.png`（理念阐释）
  * `p3.jpg` ➔ `4.png`（核心长幅展开）
  * `p4.jpg` ➔ `5.png`、`p5.jpg` ➔ `6.png`、`p6.jpg` ➔ `7.png`、`p7.jpg` ➔ `8.png`
  * `p8.jpg` ➔ `9.png`（底部收尾）
* **显示策略**：全屏无边距垂直流式排版，首屏第 1 张图 `loading="eager"` 优先加载，其余图片 `loading="lazy"` 渐进渲染。

### 6.2 教师端（90 天免登与身份自动锁定）
1. **免登持久化逻辑**：
   * 首次识别老师身份后，在客户端 `localStorage` 写入带 90 天有效期的 `dh_patrol_teacher_session_v2`；
   * 老师在 90 天内再次扫码，系统读取缓存并立即带入身份，**零感知直接进入打卡页面**；
2. **多通道认证方式**：
   * **通道 A（名录即时搜索）**：弹窗内置 48 位在册教职工名录与实时拼音/汉字模糊搜索，点击名字即可 1 秒完成绑定；
   * **通道 B（钉钉原生 OAuth）**：支持钉钉官方授权许可登录（需在钉钉后台配置回调域名）；
   * **随时换班**：工作台顶部常驻「切换身份」按钮，方便多位老师共用设备打卡。
3. **打卡记录直写钉钉 AI 表格**：
   * 提交打卡时，将当前老师的真实 `userId` 注入 payload 中的 `"人员": [{ "userId": "..." }]` 字段；
   * 写入成功后返回 Notable AI 表格的真实记录流水号（`recordId`）。

---

## 7. 日常维护、更新与发布 SOP

### 7.1 本地启动调试
```bash
cd /Users/ethan/.gemini/antigravity/scratch/campus-environment-patrol
python3 server.py
# 访问本地页面: http://localhost:8000/life-farm
```

### 7.2 更新长图切片操作步骤 (以生命场为例)
1. 将新导出的切片图片放入 `/Users/ethan/Downloads/生命场`；
2. 执行更新与压缩脚本（保持宽度 1242px，格式化为 WebP/JPG）；
3. 将图片输出至 `public/assets/life_farm_v2/` 并更新版本时间戳；
4. 执行发布命令。

### 7.3 部署到生产环境 (Cloudflare Pages)
```bash
cd /Users/ethan/.gemini/antigravity/scratch/campus-environment-patrol

# 1. 提交到 GitHub 仓库
git add .
git commit -m "feat: your update message"
git push origin main

# 2. 一键发布到 Cloudflare Pages
npx wrangler pages deploy public --project-name daddyhome-environment-patrol --branch main
```

---

## 8. 钉钉开放平台回调域名配置指引

若后续需要开启钉钉官方 OAuth2 授权无跳转弹窗，请按照以下步骤配置：
1. 登录 **[钉钉开放平台 (open-dev.dingtalk.com)](https://open-dev.dingtalk.com/)**；
2. 选择应用：**`DADDY HOME`**（AppKey: `dingh5hmtyjgs4klkcdu`）；
3. 进入 **「开发配置」➔「登录与分享」**；
4. 在 **「回调域名」** 输入框中添加：
   ```text
   patrol.daddyhome.club
   patrol.daddyhome.love
   ```
5. 保存即可生效。

---
*文档编制完成时间：2026年8月29日*