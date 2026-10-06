/* Arxiv PDF Translate - toolbar popup (translation options). */
(function () {
  "use strict";

  const el = {
    serverStatus: document.getElementById("serverStatus"),
    tabUrl: document.getElementById("tabUrl"),
    sourceLang: document.getElementById("sourceLang"),
    targetLang: document.getElementById("targetLang"),
    outputVariant: document.getElementById("outputVariant"),
    pageMode: document.getElementById("pageMode"),
    customPages: document.getElementById("customPages"),
    threads: document.getElementById("threads"),
    ignoreCache: document.getElementById("ignoreCache"),
    translate: document.getElementById("translate"),
    hint: document.getElementById("hint"),
    openOptions: document.getElementById("openOptions"),
    existingSection: document.getElementById("existingSection"),
    existingList: document.getElementById("existingList")
  };

  let activeUrl = "";
  let targetUrl = "";
  let isPdf = false;
  let isReadOnlyViewer = false;
  let serverUrl = "";

  function arxivId(url) {
    const match = String(url || "").match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i);
    return match ? match[1] : "";
  }

  function sameSource(entry, url) {
    const stored = entry.source_url || "";
    if (!stored) { return false; }
    if (stored === url) { return true; }
    const a = arxivId(stored);
    const b = arxivId(url);
    if (a && b) { return a === b; }
    return PDF2ZH.basename(stored) === PDF2ZH.basename(url);
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) { return n + " B"; }
    if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + " KB"; }
    if (n < 1024 * 1024 * 1024) { return (n / 1024 / 1024).toFixed(1) + " MB"; }
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function formatDate(ts) {
    if (!ts) { return ""; }
    const d = new Date(ts * 1000);
    const pad = function (v) { return String(v).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderExisting(entries) {
    el.existingList.innerHTML = "";
    el.existingSection.hidden = !entries.length;
    entries.forEach(function (entry) {
      const item = document.createElement("div");
      item.className = "existing-item";

      const info = document.createElement("div");
      info.className = "existing-info";
      const name = document.createElement("div");
      name.className = "existing-name";
      name.textContent = entry.title || entry.name || (entry.id + ".pdf");
      name.title = name.textContent;
      const meta = document.createElement("div");
      meta.className = "existing-meta";
      const parts = [];
      if (entry.source_lang && entry.target_lang) {
        parts.push(entry.source_lang + "→" + entry.target_lang);
      }
      parts.push(entry.output_variant === "mono" ? "仅译文" : "双语");
      if (entry.pages) { parts.push("页 " + entry.pages); }
      parts.push(formatDate(entry.created_at));
      parts.push(formatBytes(entry.size));
      meta.textContent = parts.join(" · ");
      info.appendChild(name);
      info.appendChild(meta);

      const open = document.createElement("button");
      open.textContent = "打开";
      open.addEventListener("click", function () {
        chrome.tabs.create({
          url: PDF2ZH.fileViewerUrl(
            serverUrl + "/storage/" + entry.id,
            entry.title || entry.name,
            entry.source_url
          )
        });
        window.close();
      });

      item.appendChild(info);
      item.appendChild(open);
      el.existingList.appendChild(item);
    });
  }

  async function findExisting(url) {
    if (!serverUrl || !url) { return; }
    try {
      const response = await fetch(serverUrl + "/storage", { cache: "no-store" });
      if (!response.ok) { return; }
      const data = await response.json();
      const matches = (data.entries || []).filter(function (entry) {
        return sameSource(entry, url);
      });
      renderExisting(matches);
    }
    catch (err) {
      /* server offline: ignore */
    }
  }

  function setServerStatus(ok, text) {
    el.serverStatus.textContent = text;
    el.serverStatus.classList.toggle("ok", ok === true);
    el.serverStatus.classList.toggle("err", ok === false);
  }

  async function checkServer(serverUrl) {
    try {
      const response = await fetch(serverUrl + "/health", { cache: "no-store" });
      if (!response.ok) {
        setServerStatus(false, "服务异常");
        return;
      }
      const health = await response.json();
      setServerStatus(health.pdf2zh_available, health.pdf2zh_available ? "本机服务在线" : "未找到 pdf2zh");
    }
    catch (err) {
      setServerStatus(false, "服务未启动");
    }
  }

  function currentOptions() {
    return {
      auto: true,
      sourceLang: el.sourceLang.value,
      targetLang: el.targetLang.value,
      outputVariant: el.outputVariant.value,
      threads: Math.max(1, parseInt(el.threads.value, 10) || 4),
      pages: PDF2ZH.pageArgument(el.pageMode.value, el.customPages.value),
      ignoreCache: el.ignoreCache.checked
    };
  }

  function persistOptions() {
    PDF2ZH.saveSettings({
      sourceLang: el.sourceLang.value,
      targetLang: el.targetLang.value,
      outputVariant: el.outputVariant.value,
      threads: Math.max(1, parseInt(el.threads.value, 10) || 4)
    });
  }

  function renderTabInfo() {
    el.translate.disabled = !isPdf;
    el.tabUrl.innerHTML = "";
    const label = document.createElement("strong");
    const url = document.createElement("span");
    if (isPdf) {
      label.textContent = "检测到 PDF，可开始翻译";
      url.textContent = targetUrl;
      el.hint.textContent = "将使用本机 pdf2zh 在翻译视图中生成译文。";
    }
    else if (isReadOnlyViewer) {
      label.textContent = "这是已打开的译文（缓存）";
      url.textContent = activeUrl;
      el.hint.textContent = "从“翻译记录”打开的是缓存译文；如需重译，请打开原 PDF 链接。";
    }
    else {
      label.textContent = "当前标签不是 PDF";
      url.textContent = activeUrl || "(无)";
      el.hint.textContent = "打开 arXiv PDF 后，工具栏图标会显示“译”，再点开这里。";
    }
    el.tabUrl.appendChild(label);
    el.tabUrl.appendChild(url);
  }

  async function init() {
    const settings = await PDF2ZH.getSettings();

    PDF2ZH.fillLangSelect(el.sourceLang, settings.sourceLang);
    PDF2ZH.fillLangSelect(el.targetLang, settings.targetLang);
    el.outputVariant.value = settings.outputVariant || "dual";
    el.threads.value = settings.threads || 4;

    serverUrl = PDF2ZH.normalizeServer(settings.serverUrl);
    checkServer(serverUrl);

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      activeUrl = (tab && tab.url) || "";
      const info = PDF2ZH.viewerInfo(activeUrl);
      targetUrl = PDF2ZH.resolveTargetUrl(activeUrl);
      isPdf = !!targetUrl;
      isReadOnlyViewer = !!(info && info.file && !info.src);
      renderTabInfo();
      if (isPdf) {
        findExisting(targetUrl);
      }
    });

    el.customPages.addEventListener("input", function () {
      if (el.customPages.value.trim()) {
        el.pageMode.value = "custom";
      }
    });

    el.pageMode.addEventListener("change", function () {
      if (el.pageMode.value !== "custom") {
        el.customPages.value = "";
      }
    });

    el.translate.addEventListener("click", function () {
      if (!isPdf || !targetUrl) {
        return;
      }
      persistOptions();
      chrome.runtime.sendMessage(
        { type: "openViewer", url: targetUrl, options: currentOptions() },
        function () { window.close(); }
      );
    });

    el.openOptions.addEventListener("click", function () {
      chrome.runtime.openOptionsPage();
    });
  }

  init();
})();
