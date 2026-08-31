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

> **⚠️ 安全要求**：源码不保存任何密钥。下列敏感项必须通过 Cloudflare Pages 的 Secrets/Bindings 配置；本地仅放在已被 `.gitignore` 排除的 `.env` 中。

| 配置项 | 参数值 | 说明 |
| :--- | :--- | :--- |
| **钉钉 AppKey** | `dingh5hmtyjgs4klkcdu` | 钉钉开放平台企业内部应用 AppKey |
| **钉钉 AppSecret** | `DINGTALK_APP_SECRET`（Secret） | 钉钉应用通信凭证；旧值曾进入版本库，必须轮换后再发布 |
| **钉钉 CorpId** | `dingfdcd647054eb40beee0f45d8e4f7c288` | 上海杨浦睿福托育有限公司企业 ID |
| **操作人 OperatorId** | `cDq12jDIWcGFnUugiSe4fQAiEiE` | 钉钉 Notable AI 表格操作员 ID |
| **Notable BaseId** | `dpYLaezmVNL9GkK1u4YgEkAA8rMqPxX6` | 巡检多维数据表母表 BaseId |
| **生命场 SheetId** | `2tr0bHx` | 生命场子表唯一 ID |

生产环境还必须配置：

| 配置项 | 类型 | 用途 |
| :--- | :--- | :--- |
| `PATROL_SESSION_SECRET` | Secret | 对 90 天教师会话做 HMAC 签名，建议使用独立高熵随机值 |
| `TEACHER_PASSCODE` | Secret | 浏览器手动载入教师名录及人工切换身份；不得写回 JSON 配置 |
| `PATROL_UPLOADS` | R2 Bucket Binding | 持久化现场照片，单张最大 2MB、每次最多 5 张 |

---

## 5. 项目完整文件结构图谱

```text
campus-environment-patrol/
├── HANDOVER.md                                # 本交接手册
├── .env.example                               # 本地环境变量模板（不含真实密钥）
├── server.py                                  # 本地调试用轻量 HTTP Server
│
├── functions/                                 # 后端 Serverless 接口 (Cloudflare Pages)
│   ├── _lib/security.js                       # 会话签名、验签、恒时口令比较与安全响应
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
│   ├── _headers                                # 静态资源安全响应头
│   ├── _redirects                             # 路由说明（各子路径使用物理 index）
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
   * 首次识别老师身份后，由后端签发带 HMAC 签名和 90 天有效期的会话令牌，再写入客户端 `localStorage` 的 `dh_patrol_teacher_session_v2`；
   * 老师在 90 天内再次扫码，前端仍需由 `/api/config` 验签成功后才恢复身份；伪造或过期缓存会被清除；
2. **多通道认证方式**：
   * **通道 A（名录即时搜索）**：输入服务端配置的教师名录访问口令后，接口只返回必要的姓名、职位和 `userId`，再选择本人完成绑定；公开配置不再下发完整名录、`unionId` 或内部字段；
   * **通道 B（钉钉原生 OAuth）**：支持钉钉官方授权许可登录（需在钉钉后台配置回调域名）；
   * **随时换班**：工作台顶部常驻「切换身份」按钮，方便多位老师共用设备打卡。
3. **打卡记录直写钉钉 AI 表格**：
   * 提交打卡时，后端只采用验签会话中的 `userId`，忽略客户端自报身份；区域、检查项、评分、备注和照片凭据均需通过白名单与长度校验；
   * 只有钉钉接口返回成功状态且带真实 `recordId` 时才向前端报告完成；错误响应或缺少流水号均按失败处理。

### 6.3 现场照片持久化

* 浏览器先压缩图片，再以已认证会话调用 `/api/upload`；
* Functions 校验请求大小、MIME、文件魔数和教师会话后写入 `PATROL_UPLOADS` R2；
* `/api/checkin` 只接受服务端签发的 R2 对象引用，不再接收或回显任意 Base64/外部 URL；
* 未配置 R2 Binding 时，无照片巡检仍可使用；选择了照片则明确失败，不会把“仅统计张数”误报为已保存凭据。

---

## 7. 日常维护、更新与发布 SOP

### 7.1 本地启动调试
```bash
cd /Users/ethan/.gemini/antigravity/scratch/campus-environment-patrol
python3 server.py
# 访问本地页面: http://localhost:8000/life-farm
```

本地服务默认仅监听 `127.0.0.1`，只读取项目根目录 `.env`，不会再加载其他项目的凭据，也不会关闭 TLS 证书校验。

### 7.2 安全回归与 Functions 编译

```bash
# 无外部写入的 Python 回归测试
python3 -m unittest -v scripts.test_system

# 使用当前 Cloudflare Pages Functions 运行时编译
npx wrangler@latest pages functions build functions \
  --compatibility-date 2026-08-29 \
  --compatibility-flags nodejs_compat
```

`scripts/test_pages_security.mjs` 用于连接本地 Wrangler Pages 服务，覆盖公开配置、跨域、口令、签名会话、R2 上传及写入前参数拒绝。测试必须使用测试专用绑定，不能填入生产钉钉凭据。

### 7.3 更新长图切片操作步骤 (以生命场为例)
1. 将新导出的切片图片放入 `/Users/ethan/Downloads/生命场`；
2. 执行更新与压缩脚本（保持宽度 1242px，格式化为 WebP/JPG）；
3. 将图片输出至 `public/assets/life_farm_v2/` 并更新版本时间戳；
4. 执行发布命令。

### 7.4 部署到生产环境 (Cloudflare Pages)
```bash
cd /Users/ethan/.gemini/antigravity/scratch/campus-environment-patrol

# 1. 提交到 GitHub 仓库
git add .
git commit -m "feat: your update message"
git push origin main

# 2. 一键发布到 Cloudflare Pages
npx wrangler pages deploy public --project-name daddyhome-environment-patrol --branch main
```

发布前必须先在 Cloudflare Pages 项目设置中确认三个 Secrets（`DINGTALK_APP_SECRET`、`PATROL_SESSION_SECRET`、`TEACHER_PASSCODE`）、非敏感配置和 `PATROL_UPLOADS` R2 Binding 均存在。缺任一必要配置时，接口会明确失败，不会回退到源码默认值。

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
