---
layout: page
nav: changelog
title: 更新日志 — Arxiv PDF Translate
description: Arxiv PDF Translate 版本更新历史。
---
# 更新日志

全部版本见 [GitHub Releases](https://github.com/SheriocCode/arxiv-pdf-translate/releases)。

## v0.5.1

2026-10-08 · patch

- 首次使用时加入引导教程（driver.js），帮助新用户快速上手。
- 更新清单改为无 BOM 的 UTF-8，并容忍读取带 BOM 的清单。

## v0.5.0

2026-10-08 · feature

- 首个正式发布：Chrome / Edge 扩展 + 本机伴生服务 。
- 本地一键发布流程（`tools/publish.ps1`）与 Inno Setup 安装包。
- 原生 Win32 托盘启动器与统一网页控制台，移除 .NET/WPF 依赖。
- 左右对照实时预览、逐页进度、块框段落级溯源与缩放按视口重绘。
- 翻译缓存、记录分组、结构化运行日志与在线更新。
