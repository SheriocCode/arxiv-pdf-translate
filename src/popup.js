/* Arxiv PDF Translate - toolbar popup (translation options). */
(function () {
  "use strict";

  const el = {
    serverStatus: document.getElementById("serverStatus"),
    sourceLang: document.getElementById("sourceLang"),
    targetLang: document.getElementById("targetLang"),
    pageMode: document.getElementById("pageMode"),
    customPages: document.getElementById("customPages"),
    ignoreCache: document.getElementById("ignoreCache"),
    translate: document.getElementById("translate"),
    openOptions: document.getElementById("openOptions"),
    existingSection: document.getElementById("existingSection"),
    existingList: document.getElementById("existingList")
  };

  let activeUrl = "";
  let targetUrl = "";
  let isPdf = false;
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
    return AT.basename(stored) === AT.basename(url);
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
          url: AT.fileViewerUrl(
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

  function setServerStatus(state, title) {
    el.serverStatus.classList.remove("ok", "err", "checking");
    el.serverStatus.classList.add(state);
    el.serverStatus.title = title || "";
    el.serverStatus.setAttribute("aria-label", title || "");
  }

  async function checkServer(serverUrl) {
    try {
      const response = await fetch(serverUrl + "/health", { cache: "no-store" });
      if (!response.ok) {
        setServerStatus("err", "服务异常");
        return;
      }
      const health = await response.json();
      if (health.engine_available) {
        setServerStatus("ok", "本机服务在线");
      }
      else {
        setServerStatus("err", "未找到翻译引擎");
      }
    }
    catch (err) {
      setServerStatus("err", "服务未启动");
    }
  }

  function currentOptions() {
    return {
      auto: true,
      sourceLang: el.sourceLang.value,
      targetLang: el.targetLang.value,
      pages: AT.pageArgument(el.pageMode.value, el.customPages.value),
      ignoreCache: el.ignoreCache.checked
    };
  }

  function persistOptions() {
    AT.saveSettings({
      sourceLang: el.sourceLang.value,
      targetLang: el.targetLang.value
    });
  }

  function renderTabInfo() {
    el.translate.disabled = !isPdf;
  }

  async function init() {
    const settings = await AT.getSettings();

    AT.fillLangSelect(el.sourceLang, settings.sourceLang);
    AT.fillLangSelect(el.targetLang, settings.targetLang);

    serverUrl = AT.normalizeServer(settings.serverUrl);
    checkServer(serverUrl);

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      activeUrl = (tab && tab.url) || "";
      targetUrl = AT.resolveTargetUrl(activeUrl);
      isPdf = !!targetUrl;
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
