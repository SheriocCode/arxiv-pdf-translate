<p align="center">
  <img src="icons/logo.svg" height="56" alt="">
    
  <img src="icons/arxiv_pdf_translate.png" height="56" alt="Arxiv PDF Translate">
</p>

<p align="center">在浏览器里翻译 arXiv 论文 PDF 与本地 PDF —— 全程在本机完成。</p>

## 快速开始

> 面向“只想用”的用户；部署与开发细节见下文。

1. **安装扩展**：打开 `chrome://extensions` → 打开“开发者模式” → “加载已解压的扩展程序” → 选择本目录（`arxiv-pdf-translate/`）。
2. **启动本机服务**：双击 `launcher/ArxivPdfTranslate.exe`，系统托盘出现图标并自动启动服务。
3. **配置模型**：扩展“设置 → 翻译设置 → 模型接口”，填写“模型名称”和“API 密钥”，点“保存到服务”。
4. **翻译**：打开 `https://arxiv.org/pdf/...`，点工具栏图标（PDF 页会显示“译”角标）→ 选好选项 → **开始翻译**；译文在翻译视图中查看与保存。

## 工作原理

扩展负责取回 PDF，**本机运行的 `pdf2zh`（PDFMathTranslate）** 负责解析与翻译，译文双语 PDF 直接回传到浏览器内查看。管线与沉浸式翻译的 “BabelDoc 云端翻译” 类似，但完全在本机完成：

```
arXiv PDF 链接 / 本地 PDF
        │  扩展抓取 PDF 字节
        ▼
本机伴生服务 127.0.0.1:8760  ──调用──▶  pdf2zh（PDFMathTranslate）
        │                                    │
        │◀────────── 双语 PDF ───────────────┘
        ▼
浏览器内嵌译文视图 + 保存 PDF
```

## 组成

| 目录                                      | 说明                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| `manifest.json` / `src/` / `icons/` | Chrome / Edge 扩展（Manifest V3）                            |
| `server/pdf2zh_server.py`               | 本机伴生 HTTP 服务，仅用 Python 标准库                       |
| `pdf2zh/`                               | 随项目携带的 PDFMathTranslate 引擎（官方 Windows 打包版）    |
| `storage/`                              | 翻译结果缓存目录（同名同参数再次翻译时直接命中，免重复翻译） |

浏览器扩展不能直接运行本地程序，所以需要一个只监听 `127.0.0.1` 的本机服务来调用 `pdf2zh`。

整个目录可以整体复制到任意位置；服务里的路径全部相对脚本自身解析，不依赖盘符或当前工作目录。

## 一、准备 pdf2zh

项目已内置引擎：`pdf2zh/pdf2zh.exe`（随附 `runtime/`、`site-packages/` 与离线资源）。
服务默认自动探测它，无需配置。首次运行会解压离线资源，稍慢一点。

如果 `pdf2zh/` 不在默认位置，或想改用其它安装，只需在 `config.json` 里填：

- `"pdf2zh_path": ""`（默认）：自动探测项目内 `pdf2zh/`，找不到再退回 PATH 上的 `pdf2zh`；
- `"pdf2zh_path": "pdf2zh"`：使用 PATH 上的安装（等效于 `pip install pdf2zh`）；
- `"pdf2zh_path": "相对或绝对路径"`：相对路径会依次相对 `server/`、项目根、当前目录解析。

## 二、启动本机服务

```powershell
cd server
copy config.example.json config.json   # 然后编辑 config.json
python pdf2zh_server.py
```

Linux / macOS 同理（把 `copy` 换成 `cp`，`python` 换成 `python3`）。也支持从任意工作目录运行：

```sh
python E:\path\to\arxiv-pdf-translate\server\pdf2zh_server.py
```

`config.json` 关键字段：

```json
{
  "port": 8760,
  "pdf2zh_path": "",
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

启动日志会打印解析到的 `project root` 与 `pdf2zh` 路径，便于确认。

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

> 也可以不改文件：扩展**设置页 → 配置 → 模型接口**里直接填写接口地址、API 密钥、模型名称等，
> 点“保存到服务”即写回 `server/config.json`（密钥只显示为掩码；清除密钥有单独按钮）。
> 对应接口 `POST /config`。

也可以用环境变量覆盖：`PDF2ZH_PATH`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、
`OPENAI_MODEL`、`PDF2ZH_PORT`。看到 `listening on http://127.0.0.1:8760` 即成功。

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

1. 点击该图标 → 弹出**翻译选项**面板：源/目标语言、输出（双语/仅译文）、翻译范围、线程。
2. 点击面板里的 **开始翻译** → 在新标签打开翻译视图，本机 pdf2zh 生成译文并显示，可
   **保存 PDF** 或在新标签打开原文/译文。
3. 面板底部的 **设置…** 进入扩展设置页。

其它入口：

- **任意 PDF 链接**：右键 → “Translate link with local pdf2zh”（立即翻译）。
- **本地 PDF**：先在扩展详情页开启“允许访问文件网址”，再用右键菜单或工具栏图标。

> Chrome 自带的 PDF 阅读器是浏览器内部页面，扩展无法往里注入页面内按钮；因此采用
> “工具栏图标 + 角标 + 弹出翻译选项”的方式，而不是改写 PDF 页面。

译文由本机 `pdf2zh` 生成，不上传任何云端服务（除你配置的翻译模型 API）。

## 配置项（扩展设置页）

| 项            | 默认                      | 说明                                                |
| ------------- | ------------------------- | --------------------------------------------------- |
| 服务地址      | `http://127.0.0.1:8760` | 与`server/config.json` 的端口一致                 |
| 源 / 目标语言 | `en` → `zh-CN`       | 传给`pdf2zh -li/-lo`                              |
| 输出 PDF      | 双语                      | 双语或仅译文                                        |
| 线程数        | 4                         | `pdf2zh -t`                                       |
| 工具栏角标    | 开                        | 打开 PDF 时在扩展图标上显示“译”，点击弹出翻译选项 |

## 五、翻译记录与缓存

翻译成功的 PDF 会写入项目 `storage/` 目录（内容+参数寻址），并在 `storage/index.json`
记录来源、语言、输出类型、大小、时间等。

- 对**同一份 PDF + 相同翻译参数**再次翻译时，服务直接返回缓存结果，不再调用 pdf2zh/模型。
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
| GET      | `/health`                | 服务与`pdf2zh` 可用性                              |
| POST     | `/jobs`                  | 请求体为原始 PDF 字节，返回`{ id }`                |
| GET      | `/jobs/<id>`             | 轮询状态、进度与日志尾部                             |
| GET      | `/jobs/<id>/result`      | 下载译文 PDF                                         |
| DELETE   | `/jobs/<id>`             | 取消并清理                                           |
| POST     | `/translate`             | 同步一次性翻译，直接返回 PDF                         |
| GET/POST | `/config`                | 读取 / 修改本机配置（模型接口、密钥、pdf2zh 路径等） |
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
- **未找到 pdf2zh**：确认 `pdf2zh/pdf2zh.exe` 存在；或把 `config.json` 的 `pdf2zh_path`
  指向实际位置（相对路径相对 `server/`、项目根、当前目录解析）。启动日志会打印解析结果。
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
