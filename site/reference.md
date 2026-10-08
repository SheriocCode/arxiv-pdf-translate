---
layout: doc
nav: reference
title: 参考 — Arxiv PDF Translate
description: Arxiv PDF Translate 架构、服务 API、更新与发布、构建等参考信息。
toc:
  - title: 工作原理
    id: arch
  - title: 组成
    id: layout
  - title: 服务 API
    id: api
  - title: 更新与发布
    id: update
  - title: 构建
    id: build
  - title: 图标
    id: icons
  - title: 第三方许可
    id: license
---

## 工作原理 {#arch}

扩展负责取回 PDF，**随项目携带的本机翻译引擎（`engine/`）** 负责解析与翻译，译文 PDF 直接回传到浏览器内查看。全程在本机完成：

~~~
arXiv PDF 链接 / 本地 PDF
        │  扩展抓取 PDF 字节
        ▼
本机伴生服务 127.0.0.1:18760  ──调用──▶  engine/ArxivTranslateEngine.exe
        │                                    │
        │◀────────── 译文 PDF ───────────────┘
        ▼
浏览器内嵌对照视图（原文 + 译文）+ 导出 PDF
~~~

浏览器扩展不能直接运行本地程序，所以需要一个只监听 `127.0.0.1` 的本机服务来调用引擎。扩展是**可选**的前端，服务本身可独立使用。

## 组成 {#layout}

| 目录                                       | 说明                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `manifest.json` / `src/` / `icons/`        | Chrome / Edge 扩展（Manifest V3）                                        |
| `server/server.py`                         | 本机伴生 HTTP 服务，仅用 Python 标准库（并托管统一网页控制台 `server/web/`） |
| `launcher/ArxivPdfTranslate.exe`           | 原生 Win32 C 托盘启动器（零运行时依赖；源码 `launcher/native/launcher.c`） |
| `engine/`                                  | 随项目携带的精简翻译引擎                                                |
| `storage/`                                 | 翻译结果缓存目录（同名同参数再次翻译时直接命中）                        |
| `site/` → `docs/`                          | 本项目站点（Jekyll 源 → 构建产物，GitHub Pages 发布）                   |

整个目录可以整体复制到任意位置；服务里的路径全部相对脚本自身解析，不依赖盘符或当前工作目录。

## 服务 API {#api}

| 方法     | 路径                       | 说明                                                 |
| -------- | -------------------------- | ---------------------------------------------------- |
| GET      | `/health`                  | 服务与引擎可用性                                     |
| GET      | `/` `/console`             | 网页控制台（统一配置界面）                           |
| GET      | `/web/*` `/icons/*`        | 控制台静态资源 / 图标                                |
| GET      | `/system`                  | 系统信息（平台、路径、自启状态、启动器）             |
| GET      | `/logs`                    | 结构化日志条目（`?lines=1500`；每条含 时间/级别/类别/消息/任务ID） |
| GET      | `/update/check`            | 检查更新（与 `update_url` 指向的清单比较）           |
| POST     | `/update/apply`            | 下载补丁/整包 → sha256 校验 → 解压 → 写重启脚本并安排重启 |
| GET      | `/update/progress`         | 更新进度/状态（轮询用）                              |
| POST     | `/autostart`               | 开启/关闭开机自启 `{enabled}`                        |
| POST     | `/shortcut`                | 创建桌面快捷方式                                     |
| POST     | `/server/shutdown`         | 停止本机服务                                         |
| POST     | `/jobs`                    | 请求体为原始 PDF 字节，返回 `{ id }`                 |
| GET      | `/jobs`                    | 列出当前任务（状态、进度、块计数）                   |
| GET      | `/jobs/<id>`               | 轮询状态、进度与日志尾部                             |
| GET      | `/jobs/<id>/partial`       | 增量预览：已完成页组成的 PDF（参数 `variant=dual` 或 `mono`） |
| GET      | `/jobs/<id>/blocks`        | 段落/块事件：每块 `{page,index,total,bbox:[x0,y0,x1,y1],src,dst}`（PDF 点，左下原点） |
| GET      | `/jobs/<id>/result`        | 下载译文 PDF（`?variant=dual` 或 `mono`，同一任务可任选导出） |
| DELETE   | `/jobs/<id>`               | 取消并清理                                           |
| POST     | `/translate`               | 同步一次性翻译，直接返回 PDF                         |
| GET/POST | `/config`                  | 读取 / 修改本机配置（模型接口、密钥、引擎路径等）    |
| GET      | `/storage`                 | 列出缓存记录、分组与总大小                           |
| GET      | `/storage/<id>`            | 打开/下载某个缓存 PDF                                |
| DELETE   | `/storage/<id>`            | 删除某条缓存记录                                     |
| GET/POST | `/storage/groups`          | 列出 / 新建分组                                      |
| DELETE   | `/storage/groups/<name>`   | 删除分组                                             |
| POST     | `/storage/<id>/group`      | 设置某条记录的分组                                   |

查询参数：`source_lang`、`target_lang`、`service`、`output_variant`、`pages`、`threads`、`use_babeldoc`、`skip_subset_fonts`、`ignore_cache`、`formula_font_regex`、`prompt`、`extra_args`、`filename`、`source_url`。

## 更新与发布 {#update}

分发形态：**一个安装包 `ArxivPdfTranslate-Setup-vX.exe`**（内置引擎，双击按向导安装到可写目录），以及**代码补丁 `*-patch-from-<上一版>.zip`**。**引擎只随安装包分发一份**，不出现在补丁里。

更新基于一个**固定 URL 的清单** `update.json`（默认指向仓库 `main` 分支，可用配置项 `update_url` 覆盖）。客户端「检查更新」读取它并与本地版本比较：

~~~json
{
  "version": "0.5.0",
  "engine_version": "0.1.0",
  "notes": "本次更新说明",
  "installer": { "url": ".../ArxivPdfTranslate-Setup-v0.5.0.exe" },
  "patch": { "from": "0.4.1", "url": ".../v0.5.0-patch-from-0.4.1.zip", "sha256": "..." }
}
~~~

判定规则：

- 本地 `APP_VERSION` == `version` → 已是最新。
- 本地引擎版本（`engine/VERSION`）≠ `engine_version` → 本次更新改了引擎，补丁不可用，界面提示 **「下载最新安装包」**（用 `installer.url`）。
- 引擎版本匹配且本地版本 == `patch.from` → 下载**补丁**并自动更新。
- 其它（跨多版）→ 同样走安装包。

补丁 zip 的根即项目相对路径（如 `server/server.py`、`server/web/console.js`、`src/…`）；可含 `patch.json`，其 `delete` 列出需要删除的文件。

**更新流程**：控制台「系统 → 软件更新」→ 服务端下载补丁并 sha256 校验 → 解压到临时目录 → 写 `%TEMP%\at-update\apply.bat` → 服务退出 → 脚本等待端口释放后用 robocopy 覆盖项目并重启服务（`launcher\ArxivPdfTranslate.exe --server`）。页面轮询检测到重启后提示「更新完成」；需要重装时显示「下载最新安装包」。

**发布（本地一键）**：一次性准备——MinGW-w64 的 `gcc`、Inno Setup 6、GitHub CLI（`gh auth login`）；发版前把 `server/server.py` 的 `APP_VERSION` 改到本次版本，引擎有改动时更新 `engine/VERSION`。然后：

~~~powershell
powershell -File tools/publish.ps1 -Version 0.5.0 -Notes "本次更新说明"
~~~

脚本会：`tools/build-release.ps1` 产出 payload 与代码补丁 → Inno 生成 `ArxivPdfTranslate-Setup-vX.exe` → 打 tag 并推送 → 用 `gh` 创建/更新 Release 并上传 `Setup.exe`/`patch.zip`/`SHA256SUMS` → 写入 `update.json` 并推回默认分支。**引擎只随安装包分发一份，补丁只含代码；引擎有变则提示用户重下安装包。**

发布后记得同步本站文档（更新日志 + 重新构建站点），`publish.ps1` 结尾会给出提醒与落后检测。

## 构建 {#build}

打包扩展：

~~~powershell
.\build.ps1
~~~

产物在 `dist/arxiv-pdf-translate-<version>.zip`。

从源码重建托盘启动器（改了 `launcher/native/launcher.c` 才需要；需要 MinGW-w64 的 `gcc`）：

~~~powershell
launcher\build-native-launcher.bat
~~~

构建本站点（源在 `site/`，产物写入 `docs/`）：

~~~powershell
powershell -File tools/build-docs.ps1
~~~

## 图标 {#icons}

- **品牌标志**：`icons/logo.svg`（矢量）与 `icons/logo.png`。
- **品牌文字**：`icons/arxiv_pdf_translate.svg` / `.png`（wordmark）。
- **扩展/托盘图标**：`icons/make_icons.py` 以 `logo.png` 为源生成方形 `icon16/32/48/128.png` 与 `icon.ico`。
- **界面图标**：内联自 [Lucide](https://lucide.dev/)（ISC 许可），以 SVG 形式直接嵌入，离线可用。

## 第三方许可 {#license}

- **PDF.js**（`src/vendor/pdf.min.js`、`src/vendor/pdf.worker.min.js`，Mozilla，Apache-2.0）：用于翻译过程中的逐页增量预览。
- **Lucide**（图标，ISC 许可）：界面图标。
