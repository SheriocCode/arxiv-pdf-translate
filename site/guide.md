---
layout: doc
nav: guide
title: 文档 — Arxiv PDF Translate
description: Arxiv PDF Translate 安装、启动、配置与使用文档。
toc:
  - title: 安装与启动
    id: install
  - title: 准备引擎
    id: engine
  - title: 启动本机服务
    id: service
  - title: 本机控制台
    id: console
  - title: 安装扩展
    id: extension
  - title: 使用
    id: usage
  - title: 配置项
    id: config
  - title: 翻译记录与缓存
    id: storage
  - title: 故障排查
    id: troubleshoot
---

## 安装与启动 {#install}

最快的方式是使用 Windows 安装包（内置精简翻译引擎）：

1. 在[下载页](https://github.com/SheriocCode/arxiv-pdf-translate/releases/latest)获取 `ArxivPdfTranslate-Setup-vX.exe`，双击按向导安装到可写目录。
2. 运行托盘程序 `ArxivPdfTranslate.exe`：托盘出现图标、自动启动本机服务，并在浏览器打开本机控制台。
3. 加载浏览器扩展（见 [安装扩展](#extension)）。

> 扩展是**可选**的翻译前端；本机服务才是核心。只装服务也能通过控制台或 API 使用。

## 准备引擎 {#engine}

安装包已内置**精简引擎** `engine/ArxivTranslateEngine.exe`（随附裁剪后的运行时、`site-packages/` 与离线资源）。服务默认优先探测它，无需配置。首次运行会把字体、版面模型、tiktoken 缓存复制到用户目录 `~/.cache/babeldoc`，稍慢一点。

精简引擎只保留本项目实际用到的部分：

- 只支持 **OpenAI 兼容接口**（`-s openai`，含 deepseek 等）；
- 移除了 GUI（gradio）、MCP/Web 服务、OCR 表格识别、扫描件检测；
- 离线资源只保留简体中文/通用拉丁字体与版面模型，如需繁体或日/韩目标，首次使用会自动联网下载对应字体。

如果引擎不在默认位置，在 `config.json` 里设置 `engine_path`：

- `""`（默认）：自动探测项目内 `engine/`；
- 相对或绝对路径：相对路径会依次相对 `server/`、项目根、当前目录解析。

## 启动本机服务 {#service}

从源码运行时（服务本身只用 Python 标准库，零第三方依赖）：

~~~
cd server
copy config.example.json config.json   # 然后编辑 config.json
python server.py
~~~

Linux / macOS 同理，把 `copy` 换成 `cp`、`python` 换成 `python3`。也支持从任意工作目录运行：

~~~
python E:\path\to\arxiv-pdf-translate\server\server.py
~~~

默认端口 `18760`。启动日志会打印解析到的 `project root` 与引擎路径，看到 `listening on http://127.0.0.1:18760` 即成功。自检：

~~~
curl http://127.0.0.1:18760/health
~~~

也可用环境变量覆盖：`ENGINE_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`ENGINE_PORT`。

### 一键启动（托盘程序）

`launcher/ArxivPdfTranslate.exe` 是**原生 Win32 单文件**，不依赖 .NET 或任何第三方运行时（只用 Windows 自带系统 DLL）。双击即启动托盘控制程序。

- 悬停图标：显示 **在线 / 未启动**；
- **左键单击**：打开控制台；**右键单击**：弹出菜单；
- 菜单项：打开控制台、启动 / 停止服务（停止走 `/server/shutdown` 优雅退出）、开机自启（勾选开关，可取消；以 `--tray` 静默启动）、创建桌面快捷方式、退出（退出即停止服务）。

命令行参数：

~~~
ArxivPdfTranslate.exe            启动托盘并打开控制台
ArxivPdfTranslate.exe --tray     仅托盘（用于开机自启，不打开浏览器）
ArxivPdfTranslate.exe --server   仅启动本机服务
~~~

单实例：重复双击不会重复启动，而是唤起已有实例打开控制台。

> 从源码重建该 exe **仅构建时**需要 MinGW-w64 的 `gcc`，产物本身无依赖：`launcher\build-native-launcher.bat`。

## 本机控制台 {#console}

服务启动后访问 `http://127.0.0.1:18760/`（也可用托盘或扩展入口打开），把配置、记录与系统控制集中到一处：

- **概览**：服务、引擎、版本、端口状态。
- **翻译设置**：模型接口（地址 / 模型 / 密钥）、源/目标语言、导出格式、线程数、引擎路径、超时等，写入 `server/config.json`；扩展会自动采纳这里改动的默认值。
- **翻译记录**：本地缓存 PDF 的搜索、分组、打开 / 下载 / 删除。
- **运行日志（trace）**：服务端按 `[时间] [级别] [类别] 消息` 结构化输出，前端渲染成时间线——级别着色（错误/警告/成功/信息/调试）、类别标签（任务/引擎/缓存/存储/配置/系统…）、任务 ID 关联，支持按级别/类别筛选、搜索、跟随最新、一键清空。覆盖启动/关闭、配置读写、每次任务的上传/缓存命中或未命中、引擎启动(pid)、逐页进度、块识别、退出码、耗时、结果落盘、存储与分组、标题补全、网络失败等。
- **系统**：开机自启、创建桌面快捷方式、停止服务。
- **软件更新**：显示当前版本，「检查更新」后如有新版本可「下载并更新」——服务端下载补丁/整包并做 sha256 校验，随后写重启脚本、退出、覆盖文件并重启，页面显示进度并在重连后提示「更新完成」。更新只替换代码文件（`server/`、`server/web/`、`src/` 等），**不覆盖 `config.json` 与 `storage/`**；若含扩展文件会提示到 `chrome://extensions` 重新加载。
- **扩展检测**：控制台会探测浏览器是否已安装本插件（通过固定扩展 ID）。页面顶部常驻一条极简状态行（小圆点 + 「已安装 / 未安装」，未安装时给出安装路径与「复制扩展目录」）。

> 网页无法自行重新启动服务：停止后请用托盘图标「启动服务」重新拉起。

> 扩展弹窗底部的 **设置** 直接打开该控制台；服务未启动时，弹窗内会显示「连接本机服务」面板（可改服务地址、重试或打开控制台）。模型接口等均写入 `server/config.json`（密钥只显示为掩码，清除密钥有单独按钮）。

## 安装扩展 {#extension}

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目目录 `arxiv-pdf-translate/`（或先运行 `.\build.ps1` 打包再解压加载）。

控制台会自动检测扩展是否已安装。扩展固定 ID 为 `ajabefplecofaoccaobofemmdcjdfala`（由 `manifest.json` 的 `key` 决定）。若是从旧版本「加载已解压」升级，固定 ID 后浏览器可能视为新扩展，需移除旧的再重新加载一次。

> 本地 PDF 需要在扩展详情页开启「允许访问文件网址」。

## 使用 {#usage}

打开 arXiv PDF（如 `arxiv.org/pdf/...`）不会自动跳转，点击浏览器工具栏上的扩展图标即可：

1. 弹出**翻译选项**面板：源 → 目标语言、翻译范围（导出格式在翻译视图里选、线程在控制台改）。
2. 点击 **开始翻译** → 在新标签打开翻译视图，本机引擎生成译文，可 **保存 PDF** 或在新标签打开原文/译文。
   - **左右对照、实时追页**：左侧立即显示原文全篇；右侧先按原文页数铺好等高「翻译中…」占位页，每页译完原地替换（标题栏显示「已翻译 k/N 页」），版面稳定不抖动、同一滚动区天然对齐。
   - **页码 / 缩放**：工具栏 `‹ 页码/N ›` 跳页与 `− 100% +` 缩放（也可 **Ctrl + 滚轮**）；窗口尺寸变化自动适配宽度。
   - **逐页进度**：未开始显示「排队中…」，翻译中的页显示「翻译中…」加进度条（按该页已译段落比例推进），译完即替换。
   - **视图切换**：**原文 / 译文 / 对比**三种随时切换，不影响正在跑的翻译。
   - **块框（段落级）**：工具栏 **块框** 开关在原文页叠加每个段落块的矩形，**悬停**显示该块「原文 → 译文」（数据来自 `/jobs/<id>/blocks`）。
   - **工具栏进度条**：工具栏底边 2px 的页级进度条随已完成页数推进。
3. 面板底部的 **设置** 打开本机统一控制台。

其它入口：

- **任意 PDF 链接**：右键 → 「Translate link with the local engine」（立即翻译）。
- **本地 PDF**：先在扩展详情页开启「允许访问文件网址」，再用右键菜单或工具栏图标。

> Chrome 自带的 PDF 阅读器是浏览器内部页面，扩展无法往里注入页面内按钮；因此采用「工具栏图标 + 弹出翻译选项」的方式，而不是改写 PDF 页面。

译文由本机翻译引擎生成，不上传任何云端服务（除你配置的翻译模型 API）。

## 配置项 {#config}

以下设置统一在本机控制台 `http://127.0.0.1:18760/` 中修改。关键字段（`server/config.json`）：

~~~json
{
  "port": 18760,
  "engine_path": "",
  "service": "openai",
  "openai_base_url": "https://api.deepseek.com",
  "openai_api_key": "sk-你的密钥",
  "openai_model": "deepseek-flash",
  "source_lang": "en",
  "target_lang": "zh-CN",
  "output_variant": "dual",
  "threads": 4
}
~~~

| 项            | 默认                      | 说明                        |
| ------------- | ------------------------- | --------------------------- |
| 服务地址      | `http://127.0.0.1:18760`  | 与 `config.json` 端口一致   |
| 源 / 目标语言 | `en` → `zh-CN`            | 写入配置，扩展采纳为默认值  |
| 导出格式      | 双语                      | 保存/打开时导出双语或仅译文 |
| 线程数        | 4                         | 引擎的 `-t`                 |

环境变量可覆盖：`ENGINE_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`ENGINE_PORT`。

## 翻译记录与缓存 {#storage}

翻译成功的 PDF 写入项目 `storage/`（内容+参数寻址），并在 `storage/index.json` 记录来源、语言、输出类型、大小、时间等。

- 对**同一份 PDF + 相同参数**再次翻译时，服务直接返回缓存，不再调用引擎/模型；在翻译选项里勾选「忽略缓存，强制重新翻译」可绕过。
- 控制台「翻译记录」每条含**首页缩略图**、自动识别的**论文标题**、文件名、语言/输出/大小/时间、来源链接，可**打开 / 下载 / 删除**。
- **搜索与分组**：顶部搜索框按标题 / 文件名 / 链接过滤；下拉按分组筛选（全部 / 未分组 / 自定义）；「新建分组」创建分类，每条右侧下拉归类；选中分组可「删除分组」（组内记录变为未分组）。
- **标题**：对 arXiv 链接通过 `export.arxiv.org` API 获取；其它链接尝试读取网页的 `citation_title`；老记录会在服务启动时后台补全。
- **缩略图**：由 `server/make_thumb.py` 用 PyMuPDF 渲染首页（`storage/<id>.thumb.png`），失败则该项不显示缩略图。
- 直接删除 `storage/` 目录即可清空全部缓存。

## 故障排查 {#troubleshoot}

- **无法连接本地服务**：确认 `server` 已启动；端口与扩展内配置一致；浏览器与模型 API 网络可用。
- **未找到翻译引擎**：确认 `engine/ArxivTranslateEngine.exe` 存在，或把 `engine_path` 指向实际位置；启动日志会打印解析结果。
- **本地 PDF 打不开**：在 `chrome://extensions` 详情页开启「允许访问文件网址」。
- **翻译报错**：查看翻译视图里的日志尾部，或 `server` 控制台输出。
