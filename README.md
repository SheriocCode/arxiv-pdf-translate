<p align="center">
  <img src="icons/logo.svg" height="56" alt="">
  &#160;&#160;
  <img src="icons/arxiv_pdf_translate_black.svg#gh-light-mode-only" height="56" alt="Arxiv PDF Translate">
  <img src="icons/arxiv_pdf_translate.svg#gh-dark-mode-only" height="56" alt="Arxiv PDF Translate">
</p>

<p align="center">在浏览器里翻译 arXiv 论文 PDF 与本地 PDF —— 全程在本机完成。</p>

<p align="center">
  <a href="https://sherioccode.github.io/arxiv-pdf-translate/">官网</a> ·
  <a href="https://github.com/SheriocCode/arxiv-pdf-translate/releases/latest">下载</a> ·
  <a href="https://sherioccode.github.io/arxiv-pdf-translate/guide.html">文档</a> ·
  <a href="https://sherioccode.github.io/arxiv-pdf-translate/changelog.html">更新日志</a>
</p>

## 快速开始

1. 打开官网 **[sherioccode.github.io/arxiv-pdf-translate](https://sherioccode.github.io/arxiv-pdf-translate/)**，点「下载安装包」（或在 [Releases](https://github.com/SheriocCode/arxiv-pdf-translate/releases/latest) 下载），双击按向导安装。
2. 运行 `ArxivPdfTranslate.exe`：托盘出现图标、自动启动本机服务并打开本机控制台。
3. 在控制台「翻译设置 → 模型接口」填入模型与 API 密钥；打开 arXiv PDF，点扩展图标 →「开始翻译」。

浏览器扩展是可选的翻译前端，加载方式与完整说明见 [文档](https://sherioccode.github.io/arxiv-pdf-translate/guide.html)；架构、服务 API、更新与发布等见 [参考](https://sherioccode.github.io/arxiv-pdf-translate/reference.html)。

## 特性

- **左右对照、实时追页**：左侧原文全篇，右侧每页译完原地替换，版面稳定不抖动。
- **全程本机**：扩展取回 PDF、本机引擎解析翻译，只调用你配置的模型 API，其余数据不出本机。
- **段落块框**：原文页叠加段落矩形，悬停显示「原文 → 译文」，逐段核对。
- **翻译缓存与记录**：相同 PDF 与参数再次翻译直接命中缓存；记录带首页缩略图、自动标题、搜索与分组。
- **统一控制台**：模型接口、语言、线程、缓存记录、结构化日志、开机自启与软件更新集中在 `127.0.0.1:18760`。
- **原生托盘**：单文件 Win32 程序，无 .NET / VC 运行库依赖，支持开机自启。

## 组成

| 目录                                       | 说明                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `manifest.json` / `src/` / `icons/`        | Chrome / Edge 扩展（Manifest V3）                                        |
| `server/server.py`                         | 本机伴生 HTTP 服务，仅用 Python 标准库（并托管统一网页控制台 `server/web/`） |
| `launcher/ArxivPdfTranslate.exe`           | 原生 Win32 C 托盘启动器（零运行时依赖；源码 `launcher/native/launcher.c`） |
| `engine/`                                  | 随项目携带的翻译引擎                                                |
| `storage/`                                 | 翻译结果缓存目录（gitignore）                                           |
| `site/` → `docs/`                          | 项目站点（Jekyll 源 → 构建产物，GitHub Pages 发布）                      |

## 开发

```powershell
# 本机服务（默认端口 18760）
python server/server.py

# 打包扩展 → dist/arxiv-pdf-translate-<version>.zip
.\build.ps1

# 重建托盘启动器（需要 MinGW-w64 gcc）
launcher\build-native-launcher.bat

# 构建站点（site/ → docs/）
powershell -File tools/build-docs.ps1

# 一键发布（人工执行；细节见 site/ 参考与 NOTES.local.md）
powershell -File tools/publish.ps1 -Version X.Y.Z -Notes "本次更新说明"
```

## 第三方许可

- **PDF.js**（`src/vendor/pdf.min.js`、`src/vendor/pdf.worker.min.js`，Mozilla，Apache-2.0）：翻译过程中的逐页增量预览。
- **Lucide**（图标，ISC 许可）：界面图标。
