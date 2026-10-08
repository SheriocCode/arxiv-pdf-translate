<p align="center">
  <img src="icons/logo.svg" height="56" alt="">
  &#160;&#160;
  <img src="icons/arxiv_pdf_translate_black.svg#gh-light-mode-only" height="56" alt="Arxiv PDF Translate">
  <img src="icons/arxiv_pdf_translate.svg#gh-dark-mode-only" height="56" alt="Arxiv PDF Translate">
</p>

<p align="center">在浏览器里翻译 arXiv 论文 PDF 与本地 PDF —— 全程在本机完成。</p>

## 快速开始

> 面向“只想用”的用户；部署与开发细节见下文。

1. **安装扩展**：打开 `chrome://extensions` → 打开“开发者模式” → “加载已解压的扩展程序” → 选择本目录（`arxiv-pdf-translate/`）。
2. **启动本机服务**：双击 `launcher/ArxivPdfTranslate.exe`，托盘出现图标、自动启动服务，并**在浏览器打开本机控制台**（`http://127.0.0.1:18760/`）。
3. **配置模型**：在控制台“翻译设置 → 模型接口”填写“模型名称”和“API 密钥”后点“保存”。（弹窗“设置”即打开该控制台。）
4. **翻译**：打开 `https://arxiv.org/pdf/...`，点工具栏图标 → 选好选项 → **开始翻译**；译文在翻译视图中查看与保存。

## 工作原理

扩展负责取回 PDF，**随项目携带的本机翻译引擎（`engine/`）** 负责解析与翻译，译文 PDF 直接回传到浏览器内查看。全程在本机完成：

```
arXiv PDF 链接 / 本地 PDF
        │  扩展抓取 PDF 字节
        ▼
本机伴生服务 127.0.0.1:18760  ──调用──▶  engine/ArxivTranslateEngine.exe
        │                                    │
        │◀────────── 译文 PDF ───────────────┘
        ▼
浏览器内嵌对照视图（原文 + 译文）+ 导出 PDF
```

## 组成

| 目录                                      | 说明                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| `manifest.json` / `src/` / `icons/` | Chrome / Edge 扩展（Manifest V3）                            |
| `server/server.py`                      | 本机伴生 HTTP 服务，仅用 Python 标准库（并托管统一网页控制台 `server/web/`） |
| `launcher/ArxivPdfTranslate.exe`        | 原生 Win32 C 托盘启动器（零运行时依赖；源码 `launcher/native/launcher.c`） |
| `engine/`                               | 随项目携带的精简翻译引擎（见下）                             |
| `storage/`                              | 翻译结果缓存目录（同名同参数再次翻译时直接命中，免重复翻译） |

浏览器扩展不能直接运行本地程序，所以需要一个只监听 `127.0.0.1` 的本机服务来调用引擎。

整个目录可以整体复制到任意位置；服务里的路径全部相对脚本自身解析，不依赖盘符或当前工作目录。

## 一、准备引擎

项目已内置**精简引擎** `engine/`：`engine/ArxivTranslateEngine.exe`（随附 `runtime/`、裁剪后的
`site-packages/` 与 `assets/` 离线资源）。服务默认优先探测它，无需配置。首次运行会把
`assets/` 里的字体、版面模型、tiktoken 缓存复制到用户目录 `~/.cache/babeldoc`，稍慢一点。

`engine/` 只保留本项目实际用到的部分：

- 只支持 **OpenAI 兼容接口**（`-s openai`，含 deepseek 等），其余翻译服务客户端已移除；
- 移除了 GUI（gradio）、MCP/Web 服务、OCR 表格识别、扫描件检测（arXiv 文本类 PDF 用不到）；
- 离线资源只保留简体中文/通用拉丁字体与版面模型，不再内置繁体/日/韩字体：
  如需翻译繁体（zh-TW）或日/韩目标，首次使用会自动联网下载对应字体。

如果引擎不在默认位置，只需在 `config.json` 里填：

- `"engine_path": ""`（默认）：自动探测项目内 `engine/`；
- `"engine_path": "相对或绝对路径"`：相对路径会依次相对 `server/`、项目根、当前目录解析。

## 二、启动本机服务

```powershell
cd server
copy config.example.json config.json   # 然后编辑 config.json
python server.py
```

Linux / macOS 同理（把 `copy` 换成 `cp`，`python` 换成 `python3`）。也支持从任意工作目录运行：

```sh
python E:\path\to\arxiv-pdf-translate\server\server.py
```

`config.json` 关键字段：

```json
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
```

启动日志会打印解析到的 `project root` 与引擎路径，便于确认。

### 一键启动（托盘程序）

只需一个免安装单文件：`launcher/ArxivPdfTranslate.exe`——**原生 Win32 C 程序，不依赖 .NET 或任何第三方运行时**
（只使用 Windows 自带的系统 DLL）。双击即启动**托盘控制程序**，系统托盘出现图标、自动启动本机服务，
并在默认浏览器打开**本机控制台**。

- 悬停图标：显示 **在线 / 未启动**；
- **左键单击**图标：打开控制台；**右键单击**：弹出菜单；
- 菜单项：
  - **打开控制台**（在浏览器打开统一网页控制台）
  - **启动服务 / 停止服务**（停止走服务端 `/server/shutdown`，优雅退出）
  - **开机自启**（勾选开关，可随时取消；以 `--tray` 静默启动，不弹浏览器）
  - **创建桌面快捷方式**
  - **退出**（退出即停止服务）

命令行参数：

```
ArxivPdfTranslate.exe            启动托盘并打开控制台
ArxivPdfTranslate.exe --tray     仅托盘（用于开机自启，不打开浏览器）
ArxivPdfTranslate.exe --server   仅启动本机服务
```

单实例：重复双击不会重复启动，而是唤起已有实例打开控制台。

### 本机控制台（统一配置界面）

服务启动后访问 `http://127.0.0.1:18760/`（也可用托盘/扩展入口打开）即可进入网页控制台，
把本机服务的配置、记录与系统控制集中到一处：

- **概览**：服务、引擎、版本、端口状态；
- **翻译设置**：模型接口（地址 / 模型 / 密钥）、源/目标语言、导出格式、线程数、引擎路径、超时等，写入 `server/config.json`；扩展会自动采纳这里改动的翻译默认值；
- **翻译记录**：本地缓存 PDF 的搜索、分组、打开 / 下载 / 删除（与控制台一致）；
- **运行日志（trace）**：服务端按 `[时间] [级别] [类别] 消息` 结构化输出，前端渲染为类似 trace 的时间线——级别着色（错误/警告/成功/信息/调试）、类别标签（任务/引擎/缓存/存储/配置/系统…）、任务 ID 关联，支持按级别/类别筛选、搜索、跟随最新，并可一键清空日志。**只有带明细的事件才可展开**（如翻译时按页汇总的块识别 `src/dst/bbox`、引擎错误尾部），普通单行日志不套额外层。日志细粒度覆盖：启动/关闭、配置读写、每次任务的上传/缓存命中或未命中/引擎启动(pid)/逐页进度/块识别/退出码/耗时/结果落盘、存储与分组操作、标题补全、网络失败等。
- **系统**：开机自启、创建桌面快捷方式、停止服务；
- **软件更新**：显示当前版本，“检查更新”后如有新版本可“下载并更新”——服务端下载补丁/整包并做 sha256 校验，随后写一个重启脚本、退出、覆盖文件并重启，页面会显示进度并在重连后提示“更新完成”。更新只替换代码文件（`server/`、`server/web/`、`src/` 等），**不覆盖 `config.json` 与 `storage/`**；若本次更新含扩展文件，会提示到 `chrome://extensions` 重新加载扩展。
- **扩展检测**：控制台会探测浏览器是否已安装本插件（通过固定的扩展 ID 探测资源）。浏览器插件是**可选的**翻译前端：页面顶部常驻一条极简状态行（小圆点 + “已安装 / 未安装”，未安装时附带安装路径与“复制扩展目录”），不弹窗、不阻塞。

> 网页无法自行重新启动服务：停止后请用托盘图标“启动服务”重新拉起。

如需从源码重建 exe（**仅构建时**需要 MinGW-w64 的 `gcc`；产物本身无依赖）：

```powershell
launcher\build-native-launcher.bat
```

（源码 `launcher/native/launcher.c`，纯 Win32 API：托盘 `Shell_NotifyIcon`、`CreateProcess` 启动服务、
Winsock 直连 `127.0.0.1` 做健康检查与优雅停止、注册表开机自启、`IShellLink` 创建快捷方式。
静态链接，产物只依赖系统 DLL，无需 .NET/VC 运行库。）

> 扩展弹窗底部的 **设置** 按钮直接打开本机控制台（`http://127.0.0.1:18760/`），扩展不再有独立的设置页面；
> 若服务未启动，弹窗内会显示“连接本机服务”面板（可改服务地址、重试或打开控制台）。
> 模型接口等均写入 `server/config.json`（密钥只显示为掩码；清除密钥有单独按钮）。对应接口 `POST /config`。

也可以用环境变量覆盖：`ENGINE_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、
`OPENAI_MODEL`、`ENGINE_PORT`。看到 `listening on http://127.0.0.1:18760` 即成功。

自检：

```sh
curl http://127.0.0.1:18760/health
```

## 三、安装扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录 `arxiv-pdf-translate/`。
   （或先运行 `.\build.ps1` 打包，再解压后加载。）

> 控制台会自动检测扩展是否已安装，并在页面顶部常驻一条极简状态行。浏览器插件是**可选的**：
> 未安装时状态行会给出安装路径，点“复制扩展目录”后按提示
> `chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择本项目目录` 即可。
> 扩展固定 ID 为 `ajabefplecofaoccaobofemmdcjdfala`（由 `manifest.json` 的 `key` 决定），
> 页面正是用这个 ID 做探测。若你是从旧版本“加载已解压”升级，固定 ID 后浏览器可能视为新扩展，
> 需移除旧的再重新加载一次。

## 四、使用

打开 arXiv PDF（如 `arxiv.org/pdf/...`）时**不会自动跳转**，点击浏览器工具栏上的扩展图标即可：

1. 弹出**翻译选项**面板：源 → 目标语言、翻译范围（导出格式在翻译视图里选、线程在控制台改）。
2. 点击面板里的 **开始翻译** → 在新标签打开翻译视图，本机翻译引擎生成译文并显示，可
   **保存 PDF** 或在新标签打开原文/译文。
   - 翻译过程为**左右对照、实时追页**：左侧立即显示原文全篇；右侧先按原文页数铺好
     **等高“翻译中…”占位页**，每页译完就**原地替换**为译文（标题栏显示“已翻译 k/N 页”），
     版面从始至终稳定不抖动，同一滚动区天然对齐，无需等整篇译完。
   - **页码/缩放控件**：工具栏有 `‹ 页码/N ›` 跳页与 `− 100% +` 缩放（也可 **Ctrl + 滚轮**），缩放会重绘得更清晰；窗口尺寸变化会自动适配宽度。
   - **逐页进度**：右侧每一页都有状态——未开始显示“排队中…”，正在翻译的页显示“翻译中…”加
     **进度条**（按该页已译段落比例推进），译完即替换为译文。
   - **视图切换**：翻译过程中（及完成后）可用工具栏的 **原文 / 译文 / 对比** 切换只看原文、只看译文或左右对比（默认），随时切换、不影响正在跑的翻译。
   - **块框（段落级）**：工具栏 **块框** 开关可在原文页上叠加每个段落块的矩形；**悬停**显示该块“原文 → 译文”。数据来自 `/jobs/<id>/blocks`（每块含 bbox、原文、译文）。
   - **工具栏进度条**：工具栏底边有一条 2px 的页级进度条，随已完成页数推进。
3. 面板底部的 **设置** 打开本机统一控制台（设置与系统控制都在那里）。

其它入口：

- **任意 PDF 链接**：右键 → “Translate link with the local engine”（立即翻译）。
- **本地 PDF**：先在扩展详情页开启“允许访问文件网址”，再用右键菜单或工具栏图标。

> Chrome 自带的 PDF 阅读器是浏览器内部页面，扩展无法往里注入页面内按钮；因此采用
> “工具栏图标 + 弹出翻译选项”的方式，而不是改写 PDF 页面。

译文由本机翻译引擎生成，不上传任何云端服务（除你配置的翻译模型 API）。

## 配置项

以下设置统一在本机控制台 `http://127.0.0.1:18760/` 中修改（弹窗“设置”打开此控制台）。

| 项            | 默认                      | 说明                                                |
| ------------- | ------------------------- | --------------------------------------------------- |
| 服务地址      | `http://127.0.0.1:18760` | 与`server/config.json` 的端口一致（服务未启动时可在弹窗内修改） |
| 源 / 目标语言 | `en` → `zh-CN`       | 写入 `config.json`，扩展会采纳为默认值（弹窗仍可临时改） |
| 导出格式      | 双语                      | 保存/打开时导出双语或仅译文（对照视图始终显示原文+译文） |
| 线程数        | 4                         | 引擎的 `-t`                                       |

## 五、翻译记录与缓存

翻译成功的 PDF 会写入项目 `storage/` 目录（内容+参数寻址），并在 `storage/index.json`
记录来源、语言、输出类型、大小、时间等。

- 对**同一份 PDF + 相同翻译参数**再次翻译时，服务直接返回缓存结果，不再调用引擎/模型。
  在翻译选项面板勾选 **忽略缓存，强制重新翻译** 可绕过缓存。
- 打开本机**控制台** →“翻译记录”，每条包含 **首页缩略图**、**论文标题**
  （自动识别）、文件名、语言/输出/大小/时间、来源链接，每项可 **打开 / 下载 / 删除**。
- **搜索与分组**：顶部搜索框可按标题 / 文件名 / 链接过滤；下拉可按分组筛选（全部 / 未分组 /
  自定义分组）；“新建分组”创建自定义分类，每条记录右侧的下拉即可把它归入某组；
  选中某分组后可“删除分组”（组内记录会变为未分组）。
- **标题**：对 arXiv 链接通过 `export.arxiv.org` API 自动获取；其它链接尝试读取网页的
  `citation_title`。老记录会在服务启动时后台补全（打开控制台记录页稍等片刻或点“刷新”）。
- **缩略图**：由 `server/make_thumb.py` 用 PyMuPDF 渲染首页（`storage/<id>.thumb.png`），
  优先用当前 Python，否则回退到内置运行时的依赖；失败则该项不显示缩略图。
- 直接删除 `storage/` 目录即可清空全部缓存。

## 服务 API

| 方法     | 路径                       | 说明                                                 |
| -------- | -------------------------- | ---------------------------------------------------- |
| GET      | `/health`                | 服务与引擎可用性                                    |
| GET      | `/` `/console`           | 网页控制台（统一配置界面）                           |
| GET      | `/web/*` `/icons/*`      | 控制台静态资源 / 图标                                |
| GET      | `/system`                | 系统信息（平台、路径、自启状态、启动器）             |
| GET      | `/logs`                  | 结构化日志条目（`?lines=1500`；每条含 时间/级别/类别/消息/任务ID） |
| GET      | `/update/check`          | 检查更新（与 `update_url` 指向的清单比较）           |
| POST     | `/update/apply`          | 下载补丁/整包 → sha256 校验 → 解压 → 写重启脚本并安排重启 |
| GET      | `/update/progress`       | 更新进度/状态（轮询用）                              |
| POST     | `/autostart`             | 开启/关闭开机自启 `{enabled}`                        |
| POST     | `/shortcut`              | 创建桌面快捷方式                                     |
| POST     | `/server/shutdown`       | 停止本机服务                                         |
| POST     | `/jobs`                  | 请求体为原始 PDF 字节，返回`{ id }`                |
| GET      | `/jobs`                  | 列出当前任务（状态、进度、块计数）                   |
| GET      | `/jobs/<id>`             | 轮询状态、进度与日志尾部                             |
| GET      | `/jobs/<id>/partial`     | 增量预览：已完成页组成的 PDF（参数 `variant=dual` 或 `mono`） |
| GET      | `/jobs/<id>/blocks`      | 段落/块事件：每块 `{page,index,total,bbox:[x0,y0,x1,y1],src,dst}`（PDF 点，左下原点） |
| GET      | `/jobs/<id>/result`      | 下载译文 PDF（`?variant=dual` 或 `mono`，同一任务可任选导出） |
| DELETE   | `/jobs/<id>`             | 取消并清理                                           |
| POST     | `/translate`             | 同步一次性翻译，直接返回 PDF                         |
| GET/POST | `/config`                | 读取 / 修改本机配置（模型接口、密钥、引擎路径等）   |
| GET      | `/storage`               | 列出缓存记录、分组与总大小                           |
| GET      | `/storage/<id>`          | 打开/下载某个缓存 PDF                                |
| DELETE   | `/storage/<id>`          | 删除某条缓存记录                                     |
| GET/POST | `/storage/groups`        | 列出 / 新建分组                                      |
| DELETE   | `/storage/groups/<name>` | 删除分组                                             |
| POST     | `/storage/<id>/group`    | 设置某条记录的分组                                   |

查询参数：`source_lang`、`target_lang`、`service`、`output_variant`、`pages`、
`threads`、`use_babeldoc`、`skip_subset_fonts`、`ignore_cache`、
`formula_font_regex`、`prompt`、`extra_args`、`filename`、`source_url`。

## 更新与发布

分发形态：**一个安装包 `ArxivPdfTranslate-Setup-vX.exe`**（内置引擎，用户双击按向导安装到
可写目录），以及**代码补丁 `*-patch-from-<上一版>.zip`**。**引擎只随安装包分发一份**，不出现在补丁里。

更新基于一个**固定 URL 的清单** `update.json`（默认指向仓库 `main` 分支，可用配置项
`update_url` 覆盖）。客户端「检查更新」读取它并与本地版本比较：

```json
{
  "version": "0.5.0",
  "engine_version": "0.1.0",
  "notes": "本次更新说明",
  "installer": { "url": ".../ArxivPdfTranslate-Setup-v0.5.0.exe" },
  "patch": { "from": "0.4.1", "url": ".../v0.5.0-patch-from-0.4.1.zip", "sha256": "..." }
}
```

判定规则：
- 本地 `APP_VERSION` == `version` → 已是最新。
- 本地引擎版本（`engine/VERSION`）≠ `engine_version` → 说明**本次更新改了引擎**，补丁不可用，
  界面提示 **“下载最新安装包”**（用 `installer.url`）。
- 引擎版本匹配且本地版本 == `patch.from` → 下载**补丁**并自动更新。
- 其它（跨多版）→ 同样走安装包。

补丁 zip 的根即项目相对路径（如 `server/server.py`、`server/web/console.js`、`src/…`）；
可含 `patch.json`，其 `delete` 列出需要删除的文件。

**更新流程**：控制台「系统 → 软件更新」→ 服务端下载补丁并 sha256 校验 → 解压到临时目录 →
写 `%TEMP%\at-update\apply.bat` → 服务退出 → 脚本等待端口释放后用 robocopy 覆盖项目并重启服务
（`launcher\ArxivPdfTranslate.exe --server`）。页面轮询检测到重启后提示“更新完成”。需要重装时则显示
“下载最新安装包”按钮。

**发布（本地一键）**：一次性准备——MinGW-w64 的 `gcc`、Inno Setup 6、GitHub CLI（`gh auth login`）；
发版前把 `server/server.py` 的 `APP_VERSION` 改到本次版本，引擎有改动时更新 `engine/VERSION`。然后：

```powershell
powershell -File tools/publish.ps1 -Version 0.5.0 -Notes "本次更新说明"
```

脚本会：`tools/build-release.ps1` 产出 payload 与代码补丁 → Inno 生成 `ArxivPdfTranslate-Setup-vX.exe`
→ 打 tag 并推送 → 用 `gh` 创建/更新 Release 并上传 `Setup.exe`/`patch.zip`/`SHA256SUMS` →
写入 `update.json` 并推回默认分支。**引擎只随安装包分发一份，补丁只含代码；引擎有变则提示用户重下安装包。**


## 故障排查

- **无法连接本地服务**：确认 `server` 已启动；端口与扩展内配置一致；浏览器与模型 API 网络可用。
- **未找到翻译引擎**：确认 `engine/ArxivTranslateEngine.exe` 存在；或把
  `config.json` 的 `engine_path` 指向实际位置（相对路径相对 `server/`、项目根、当前目录解析）。
  启动日志会打印解析结果。
- **本地 PDF 打不开**：在 `chrome://extensions` 详情页开启“允许访问文件网址”。
- **翻译报错**：查看翻译视图里的日志尾部，或 `server` 控制台输出。

## 构建

```powershell
.\build.ps1
```

产物在 `dist/arxiv-pdf-translate-<version>.zip`。

## 图标

- **品牌标志**：`icons/logo.svg`（矢量，界面里直接引用）与 `icons/logo.png`。
- **品牌文字**：`icons/arxiv_pdf_translate.svg` / `.png`（wordmark）；README 顶部横幅由
  `logo.svg` + `arxiv_pdf_translate.png` 组成。
- **扩展/托盘图标**：`icons/make_icons.py` 以 `logo.png` 为源、居中留白生成方形
  `icon16/32/48/128.png` 与 `icon.ico`（托盘 exe、快捷方式用）。
- **界面图标**（翻译设置 / 翻译记录 / GitHub 等）：内联自
  [Lucide](https://lucide.dev/)（ISC 许可），以 SVG 形式直接嵌入，离线可用。

## 第三方许可

- **PDF.js**（`src/vendor/pdf.min.js`、`src/vendor/pdf.worker.min.js`，Mozilla，Apache-2.0）：
  用于翻译过程中的**逐页增量预览**（把已完成页渲染到 canvas，避免整篇重载）。
