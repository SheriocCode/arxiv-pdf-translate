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

1. 到 [Releases](https://github.com/SheriocCode/arxiv-pdf-translate/releases/latest) 下载 `ArxivPdfTranslate-Setup-vX.exe`，双击按向导安装到可写目录。
2. 安装后运行托盘程序 `ArxivPdfTranslate.exe`：托盘出现图标、自动启动本机服务，并在浏览器打开本机控制台。
3. 加载浏览器扩展（见 [安装扩展](#extension)）。

> 扩展是**可选**的翻译前端；本机服务才是核心。只装服务也能通过控制台或 API 使用。

## 准备引擎 {#engine}

安装包已内置**精简引擎** `engine/ArxivTranslateEngine.exe`（随附裁剪后的运行时、`site-packages/` 与离线资源）。服务默认优先探测它，无需配置。首次运行会把字体、版面模型、tiktoken 缓存复制到用户目录 `~/.cache/babeldoc`，稍慢一点。

精简引擎只保留本项目实际用到的部分：

- 只支持 **OpenAI 兼容接口**（`-s openai`，含 deepseek 等）；
- 移除了 GUI（gradio）、MCP/Web 服务、OCR 表格识别、扫描件检测；
- 离线资源只保留简体中文/通用拉丁字体与版面模型，如需繁体或日/韩目标，首次使用会自动联网下载对应字体。

如果引擎不在默认位置，在 `config.json` 里设置 `engine_path`：留空为自动探测项目内 `engine/`；填相对路径会依次相对 `server/`、项目根、当前目录解析。

## 启动本机服务 {#service}

从源码运行时（需要 Python 标准库即可，服务本身零第三方依赖）：

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

### 一键启动（托盘程序）

`launcher/ArxivPdfTranslate.exe` 是原生 Win32 单文件程序，不依赖 .NET 或任何第三方运行时。双击即启动托盘控制程序。

- 悬停图标显示 **在线 / 未启动**；左键单击打开控制台，右键单击弹出菜单。
- 菜单项：打开控制台、启动/停止服务、开机自启、创建桌面快捷方式、退出。

命令行参数：

~~~
ArxivPdfTranslate.exe            启动托盘并打开控制台
ArxivPdfTranslate.exe --tray     仅托盘（用于开机自启，不打开浏览器）
ArxivPdfTranslate.exe --server   仅启动本机服务
~~~

## 本机控制台 {#console}

服务启动后访问 `http://127.0.0.1:18760/`，把配置、记录与系统控制集中到一处：

- **概览**：服务、引擎、版本、端口状态。
- **翻译设置**：模型接口（地址 / 模型 / 密钥）、源/目标语言、导出格式、线程数、引擎路径、超时等，写入 `server/config.json`；扩展会自动采纳这里的默认值。
- **翻译记录**：本地缓存 PDF 的搜索、分组、打开 / 下载 / 删除。
- **运行日志**：按 `[时间] [级别] [类别] 消息` 结构化输出的时间线，支持级别/类别筛选、搜索、跟随最新与清空。
- **系统**：开机自启、创建桌面快捷方式、停止服务。
- **软件更新**：检查更新、下载并更新（详见 [更新日志](changelog.html)）。

> 网页无法自行重新启动服务：停止后请用托盘图标「启动服务」重新拉起。

## 安装扩展 {#extension}

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目目录 `arxiv-pdf-translate/`（或先运行 `.\build.ps1` 打包再解压加载）。

控制台会自动检测扩展是否已安装。扩展固定 ID 为 `ajabefplecofaoccaobofemmdcjdfala`。若是从旧版本升级，固定 ID 后浏览器可能视为新扩展，需移除旧的再重新加载一次。

> 本地 PDF 需要在扩展详情页开启「允许访问文件网址」。

## 使用 {#usage}

打开 arXiv PDF（如 `arxiv.org/pdf/...`）不会自动跳转，点击工具栏扩展图标即可：

1. 弹出**翻译选项**面板：源 → 目标语言、翻译范围。
2. 点击 **开始翻译** → 在新标签打开翻译视图，本机引擎生成译文，可 **保存 PDF**。
   - 左右对照、逐页实时追页；每页译完原地替换。
   - 工具栏提供页码跳转与缩放（也可 **Ctrl + 滚轮**）。
   - **原文 / 译文 / 对比**三种视图随时切换。
   - **块框**开关叠加段落块矩形，悬停显示「原文 → 译文」。
3. 面板底部的 **设置** 打开本机统一控制台。

其它入口：任意 PDF 链接可右键「Translate link with the local engine」；本地 PDF 先开启文件访问权限再用右键菜单或工具栏图标。

## 配置项 {#config}

以下设置统一在本机控制台中修改。关键字段（`server/config.json`）：

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

也可用环境变量覆盖：`ENGINE_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`ENGINE_PORT`。

## 翻译记录与缓存 {#storage}

翻译成功的 PDF 写入项目 `storage/`（内容+参数寻址），并在 `storage/index.json` 记录来源、语言、输出类型、大小、时间等。

- 同一份 PDF + 相同参数再次翻译直接返回缓存；可在翻译选项里勾选「忽略缓存，强制重新翻译」绕过。
- 控制台「翻译记录」含首页缩略图、自动识别的论文标题、文件名、语言/输出/大小/时间与来源链接，可打开 / 下载 / 删除。
- 支持按标题 / 文件名 / 链接搜索，以及自定义分组。
- 直接删除 `storage/` 目录即可清空全部缓存。

## 故障排查 {#troubleshoot}

- **无法连接本地服务**：确认 `server` 已启动；端口与扩展内配置一致；浏览器与模型 API 网络可用。
- **未找到翻译引擎**：确认 `engine/ArxivTranslateEngine.exe` 存在，或把 `engine_path` 指向实际位置；启动日志会打印解析结果。
- **本地 PDF 打不开**：在 `chrome://extensions` 详情页开启「允许访问文件网址」。
- **翻译报错**：查看翻译视图里的日志尾部，或 `server` 控制台输出。
