# AGENTS

## 最高优先级：精简优先，不做向后兼容

- 一切以**当前版本**为准。不要为旧版本编写兼容 / 迁移 / 兜底 / 补丁代码，例如兼容
  旧的配置字段、旧端口、旧日志格式、旧数据结构、旧安装产物等。
- 不要写“宽松解析、多格式容忍、自动迁移、默认值回填”这类防御性兼容逻辑。按当前唯一的
  格式与约定**严格**处理；不符合就忽略或明确报错。
- 如果某个问题是**用户没有更新/重启**（实际跑的还是旧版本）造成的：**直接告知用户去更新或
  重启相应组件**，而不是在代码里加容错分支去迁就旧版本。
- 发现代码库里已经存在这类兼容 / 冗余代码时，主动移除，保持实现干净。
- 破坏性变更（端口、路径、配置字段、日志/数据格式等）只改当前实现，并在说明/README 中提示
  用户更新，不写迁移或双向兼容逻辑。

## 项目约定

- 改动后运行基础校验：`python -m py_compile server/server.py`，以及对相关 JS 执行 `node --check`。
- 服务端日志统一走 `server/server.py` 的 `log(message, level, category, detail=None)`，输出格式为
  `[时间] [级别] [类别] 消息`；不要在消息里回塞旧格式 token 或未知字段。
- 默认端口 `18760`；控制台由 `server/web/` 托管；启动器为原生 Win32（`launcher/native/`）。

## 文档站点（site/ → docs/）

- 源在 `site/`（Jekyll：Markdown + `_layouts` + `assets`），产物在 `docs/`（GitHub Pages 发布目录，含 `.nojekyll`）。
  - 页面：`index.md`（首页）、`guide.md`（文档）、`reference.md`（参考：架构 / 服务 API / 发布 / 构建）、`changelog.md`（更新日志）。
  - `README.md` 只是**简短落地页**（横幅 + 快速开始 + 开发/许可，指向站点）；文档正文一律写在 `site/`，**不要往 README 堆细节**。
- **仅当本次任务改动了面向用户的内容**（首页 / 文档 / 参考 / 截图 / 更新日志）时才动它：
  改 `site/` → `powershell -File tools/build-docs.ps1` → 一并提交 `site/` 与 `docs/`。
- 与站点无关的任务：**不要**改动或重建 `docs/`，也不要顺手改文案。
- 约定：代码块用 `~~~` 围栏；图片放 `site/assets/img|index/`，Markdown 用相对路径；标题锚点用 `## 标题 {#id}`，左侧目录在 front matter `toc:` 维护；**新增页面**需设 `layout: doc`（带 `nav`/`toc`）并在 `site/_layouts/default.html` 导航里加一项；**不手改 `docs/`**（是产物）。

## 版本发布（手动，勿主动执行）

- 发布由人工执行；**不要**在无关任务里 bump 版本或发版。
- 发布前：bump `server/server.py` 的 `APP_VERSION` 与 `manifest.json` 的 `version`；引擎有变则更新 `engine/VERSION`。
- 一键发布：`powershell -File tools/publish.ps1 -Version X.Y.Z -Notes "..."`（细节见 `NOTES.local.md`）。
- **发布后必须同步文档**：更新 `site/changelog.md`（及首页如需）→ `build-docs.ps1` → 提交 `docs/`。
  `publish.ps1` 结尾会打印这份清单并对 `site/` → `docs/` 做落后检测，留意它的警告。

