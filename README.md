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
2. **启动本机服务**：双击 `launcher/ArxivPdfTranslate.exe`，系统托盘出现图标并自动启动服务。
3. **配置模型**：扩展“设置 → 翻译设置 → 模型接口”，填写“模型名称”和“API 密钥”，点“保存到服务”。
4. **翻译**：打开 `https://arxiv.org/pdf/...`，点工具栏图标（PDF 页会显示“译”角标）→ 选好选项 → **开始翻译**；译文在翻译视图中查看与保存。

## 工作原理

扩展负责取回 PDF，**随项目携带的本机翻译引擎（`engine/`）** 负责解析与翻译，译文 PDF 直接回传到浏览器内查看。全程在本机完成：

```
arXiv PDF 链接 / 本地 PDF
        │  扩展抓取 PDF 字节
        ▼
本机伴生服务 127.0.0.1:8760  ──调用──▶  engine/ArxivTranslateEngine.exe
        │                                    │
        │◀────────── 译文 PDF ───────────────┘
        ▼
浏览器内嵌对照视图（原文 + 译文）+ 导出 PDF
```

## 组成

| 目录                                      | 说明                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| `manifest.json` / `src/` / `icons/` | Chrome / Edge 扩展（Manifest V3）                            |
| `server/server.py`                      | 本机伴生 HTTP 服务，仅用 Python 标准库                       |
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
  "port": 8760,
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

只需一个免安装单文件：`launcher/ArxivPdfTranslate.exe`。双击即打开**托盘控制程序**，
系统托盘出现扩展图标，并自动启动本机服务。

- 悬停图标：显示 **在线 / 未启动**；
- **左键或右键单击**图标：都会弹出菜单；
- 菜单项：
  - **启动服务 / 停止服务**
  - **开机自启**（勾选开关，可随时取消）
  - **创建桌面快捷方式**
  - **查看日志**（弹出日志面板，实时刷新服务输出）
  - **退出**

命令行参数：

```
ArxivPdfTranslate.exe            打开托盘
ArxivPdfTranslate.exe --server   仅启动本机服务
```

如需从源码重建 exe：

```powershell
launcher\build-launcher.bat
```

（用系统自带的 .NET Framework `csc` 编译，无需联网或额外依赖。`TrayApp.cs` 为源码。）

### WPF 版启动器（可选）

另有基于 **.NET Framework 4.8 + WPF** 的启动器 `launcher/ArxivPdfTranslateWpf.exe`：双击打开一个
暗色主题的控制窗口——服务状态、启动/停止、开机自启、创建桌面快捷方式、实时日志；关闭窗口最小化到
托盘，托盘菜单可重新打开或退出。同样支持 `ArxivPdfTranslateWpf.exe --server` 只启动服务。

```powershell
launcher\build-wpf-launcher.bat
```

（用 .NET Framework 自带的 MSBuild + Roslyn `csc` 编译，XAML 主题已编译进 exe，分发只需该单文件。
本机若缺 .NET Framework 4.8 Developer Pack 会有 `MSB3644/MSB3270` 告警，可忽略；源码在 `launcher/wpf/`。）

> 也可以不改文件：扩展**设置页 → 配置 → 模型接口**里直接填写接口地址、API 密钥、模型名称等，
> 点“保存到服务”即写回 `server/config.json`（密钥只显示为掩码；清除密钥有单独按钮）。
> 对应接口 `POST /config`。

也可以用环境变量覆盖：`ENGINE_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、
`OPENAI_MODEL`、`ENGINE_PORT`。看到 `listening on http://127.0.0.1:8760` 即成功。

自检：

```sh
curl http://127.0.0.1:8760/health
```

## 三、安装扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录 `arxiv-pdf-translate/`。
   （或先运行 `.\build.ps1` 打包，再解压后加载。）

## 四、使用

打开 arXiv PDF（如 `arxiv.org/pdf/...`）时**不会自动跳转**，浏览器工具栏上的扩展图标会
出现一个蓝色 **“译”角标**：

1. 点击该图标 → 弹出**翻译选项**面板：源 → 目标语言、翻译范围（导出格式在翻译视图里选、线程在设置页改）。
2. 点击面板里的 **开始翻译** → 在新标签打开翻译视图，本机翻译引擎生成译文并显示，可
   **保存 PDF** 或在新标签打开原文/译文。
   - 翻译过程为**左右对照、实时追页**：左侧立即显示原文全篇；右侧先按原文页数铺好
     **等高“翻译中…”占位页**，每页译完就**原地替换**为译文（标题栏显示“已翻译 k/N 页”），
     版面从始至终稳定不抖动，同一滚动区天然对齐，无需等整篇译完。
   - **页码/缩放控件**：工具栏有 `‹ 页码/N ›` 跳页与 `− 100% +` 缩放（也可 **Ctrl + 滚轮**），缩放会重绘得更清晰；窗口尺寸变化会自动适配宽度。
   - **逐页进度**：右侧每一页都有状态——未开始显示“排队中…”，正在翻译的页显示“翻译中…”加
     **进度条**（按该页已译段落比例推进），译完即替换为译文。
   - **视图切换**：翻译过程中（及完成后）可用工具栏的 **原文 / 译文 / 对比** 切换只看原文、只看译文或左右对比（默认），随时切换、不影响正在跑的翻译。
   - **工具栏进度条**：工具栏底边有一条 2px 的页级进度条，随已完成页数推进。
3. 面板底部的 **设置…** 进入扩展设置页。

其它入口：

- **任意 PDF 链接**：右键 → “Translate link with the local engine”（立即翻译）。
- **本地 PDF**：先在扩展详情页开启“允许访问文件网址”，再用右键菜单或工具栏图标。

> Chrome 自带的 PDF 阅读器是浏览器内部页面，扩展无法往里注入页面内按钮；因此采用
> “工具栏图标 + 角标 + 弹出翻译选项”的方式，而不是改写 PDF 页面。

译文由本机翻译引擎生成，不上传任何云端服务（除你配置的翻译模型 API）。

## 配置项（扩展设置页）

| 项            | 默认                      | 说明                                                |
| ------------- | ------------------------- | --------------------------------------------------- |
| 服务地址      | `http://127.0.0.1:8760` | 与`server/config.json` 的端口一致                 |
| 源 / 目标语言 | `en` → `zh-CN`       | 传给引擎的 `-li/-lo`                              |
| 导出格式      | 双语                      | 保存/打开时导出双语或仅译文（对照视图始终显示原文+译文） |
| 线程数        | 4                         | 引擎的 `-t`                                       |
| 工具栏角标    | 开                        | 打开 PDF 时在扩展图标上显示“译”，点击弹出翻译选项 |

## 五、翻译记录与缓存

翻译成功的 PDF 会写入项目 `storage/` 目录（内容+参数寻址），并在 `storage/index.json`
记录来源、语言、输出类型、大小、时间等。

- 对**同一份 PDF + 相同翻译参数**再次翻译时，服务直接返回缓存结果，不再调用引擎/模型。
  在翻译选项面板勾选 **忽略缓存，强制重新翻译** 可绕过缓存。
- 打开扩展**设置页** →“翻译记录（本地缓存）”，每条包含 **首页缩略图**、**论文标题**
  （自动识别）、文件名、语言/输出/大小/时间、来源链接，每项可 **打开 / 下载 / 删除**。
- **搜索与分组**：顶部搜索框可按标题 / 文件名 / 链接过滤；下拉可按分组筛选（全部 / 未分组 /
  自定义分组）；“新建分组”创建自定义分类，每条记录右侧的下拉即可把它归入某组；
  选中某分组后可“删除分组”（组内记录会变为未分组）。
- **标题**：对 arXiv 链接通过 `export.arxiv.org` API 自动获取；其它链接尝试读取网页的
  `citation_title`。老记录会在服务启动时后台补全（打开设置页稍等片刻或点“刷新”）。
- **缩略图**：由 `server/make_thumb.py` 用 PyMuPDF 渲染首页（`storage/<id>.thumb.png`），
  优先用当前 Python，否则回退到内置运行时的依赖；失败则该项不显示缩略图。
- 直接删除 `storage/` 目录即可清空全部缓存。

## 服务 API

| 方法     | 路径                       | 说明                                                 |
| -------- | -------------------------- | ---------------------------------------------------- |
| GET      | `/health`                | 服务与引擎可用性                                    |
| POST     | `/jobs`                  | 请求体为原始 PDF 字节，返回`{ id }`                |
| GET      | `/jobs/<id>`             | 轮询状态、进度与日志尾部                             |
| GET      | `/jobs/<id>/partial`     | 增量预览：已完成页组成的 PDF（参数 `variant=dual` 或 `mono`） |
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

## 故障排查

- **无法连接本地服务**：确认 `server` 已启动；端口与扩展设置一致；浏览器与模型 API 网络可用。
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
