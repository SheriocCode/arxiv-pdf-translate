/* Shared helpers for the Arxiv PDF Translate extension. */
(function (global) {
  "use strict";

  const DEFAULTS = {
    serverUrl: "http://127.0.0.1:8760",
    sourceLang: "en",
    targetLang: "zh-CN",
    outputVariant: "dual",
    threads: 4,
    badgeOnPdf: true,
    pollIntervalMs: 1500
  };

  const LANGS = [
    ["auto", "自动检测"],
    ["en", "英语"],
    ["zh-CN", "简体中文"],
    ["zh-TW", "繁体中文"],
    ["ja", "日语"],
    ["ko", "韩语"],
    ["fr", "法语"],
    ["de", "德语"],
    ["es", "西班牙语"],
    ["ru", "俄语"],
    ["pt", "葡萄牙语"],
    ["it", "意大利语"],
    ["ar", "阿拉伯语"]
  ];

  const ARXIV_PDF_RE = /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/pdf\/[^?#\s]+/i;

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(DEFAULTS, function (items) {
        resolve(Object.assign({}, DEFAULTS, items || {}));
      });
    });
  }

  function saveSettings(values) {
    return new Promise(function (resolve) {
      chrome.storage.sync.set(values, function () { resolve(); });
    });
  }

  function normalizeServer(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function isArxivPdf(url) {
    return ARXIV_PDF_RE.test(String(url || ""));
  }

  function isPdfUrl(url) {
    if (!url) {
      return false;
    }
    if (isArxivPdf(url)) {
      return true;
    }
    try {
      const parsed = new URL(url);
      if (!/^https?:|^file:/.test(parsed.protocol)) {
        return false;
      }
      return /\.pdf$/i.test(parsed.pathname) || /\.pdf$/i.test(parsed.href);
    }
    catch (err) {
      return false;
    }
  }

  function viewerInfo(url) {
    if (!url) {
      return null;
    }
    let base;
    try {
      base = chrome.runtime.getURL("src/viewer.html");
    }
    catch (err) {
      return null;
    }
    if (String(url).indexOf(base) !== 0) {
      return null;
    }
    try {
      const parsed = new URL(url);
      return {
        src: parsed.searchParams.get("src") || "",
        file: parsed.searchParams.get("file") || ""
      };
    }
    catch (err) {
      return null;
    }
  }

  function resolveTargetUrl(url) {
    const info = viewerInfo(url);
    if (info) {
      return info.src || "";
    }
    return isPdfUrl(url) ? url : "";
  }

  function basename(url) {
    try {
      const parsed = new URL(url);
      const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      return name || "paper.pdf";
    }
    catch (err) {
      return "paper.pdf";
    }
  }

  function pageArgument(pageMode, customPages) {
    switch (pageMode) {
      case "first":
        return "1";
      case "first5":
        return "1-5";
      case "custom":
        return String(customPages || "").trim();
      case "all":
      default:
        return "";
    }
  }

  function viewerUrl(srcUrl, options) {
    const opts = options || {};
    const params = new URLSearchParams();
    params.set("src", srcUrl);
    if (opts.auto) { params.set("auto", "1"); }
    if (opts.sourceLang) { params.set("source_lang", opts.sourceLang); }
    if (opts.targetLang) { params.set("target_lang", opts.targetLang); }
    if (opts.outputVariant) { params.set("output_variant", opts.outputVariant); }
    if (opts.threads) { params.set("threads", String(opts.threads)); }
    if (opts.pages) { params.set("pages", opts.pages); }
    if (opts.ignoreCache) { params.set("ignore_cache", "1"); }
    return chrome.runtime.getURL("src/viewer.html") + "?" + params.toString();
  }

  function openViewer(srcUrl, options) {
    return chrome.tabs.create({ url: viewerUrl(srcUrl, options) });
  }

  function fileViewerUrl(fileUrl, title, sourceUrl) {
    const params = new URLSearchParams();
    params.set("file", fileUrl);
    if (title) { params.set("title", title); }
    if (sourceUrl) { params.set("source", sourceUrl); }
    return chrome.runtime.getURL("src/viewer.html") + "?" + params.toString();
  }

  function openFileViewer(fileUrl, title, sourceUrl) {
    return chrome.tabs.create({ url: fileViewerUrl(fileUrl, title, sourceUrl) });
  }

  function fillLangSelect(select, selected) {
    LANGS.forEach(function (pair) {
      const option = document.createElement("option");
      option.value = pair[0];
      option.textContent = pair[1];
      select.appendChild(option);
    });
    if (selected !== undefined && selected !== null) {
      select.value = selected;
    }
  }

  global.PDF2ZH = {
    DEFAULTS: DEFAULTS,
    LANGS: LANGS,
    getSettings: getSettings,
    saveSettings: saveSettings,
    normalizeServer: normalizeServer,
    isArxivPdf: isArxivPdf,
    isPdfUrl: isPdfUrl,
    viewerInfo: viewerInfo,
    resolveTargetUrl: resolveTargetUrl,
    basename: basename,
    pageArgument: pageArgument,
    viewerUrl: viewerUrl,
    openViewer: openViewer,
    fileViewerUrl: fileViewerUrl,
    openFileViewer: openFileViewer,
    fillLangSelect: fillLangSelect
  };
})(typeof self !== "undefined" ? self : this);
