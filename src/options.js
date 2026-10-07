/* Arxiv PDF Translate - options page. */
(function () {
  "use strict";

  const GROUP_NONE = "\u0000none";

  const el = {
    serverUrl: document.getElementById("serverUrl"),
    sourceLang: document.getElementById("sourceLang"),
    targetLang: document.getElementById("targetLang"),
    outputVariant: document.getElementById("outputVariant"),
    threads: document.getElementById("threads"),
    testBtn: document.getElementById("testBtn"),
    testResult: document.getElementById("testResult"),
    apiKey: document.getElementById("apiKey"),
    apiKeyHelp: document.getElementById("apiKeyHelp"),
    apiModel: document.getElementById("apiModel"),
    saveApiBtn: document.getElementById("saveApiBtn"),
    clearKeyBtn: document.getElementById("clearKeyBtn"),
    apiResult: document.getElementById("apiResult"),
    sideDot: document.getElementById("sideDot"),
    recordSearch: document.getElementById("recordSearch"),
    groupFilter: document.getElementById("groupFilter"),
    newGroupBtn: document.getElementById("newGroupBtn"),
    deleteGroupBtn: document.getElementById("deleteGroupBtn"),
    storageSummary: document.getElementById("storageSummary"),
    storageRefresh: document.getElementById("storageRefresh"),
    storageEmpty: document.getElementById("storageEmpty"),
    storageList: document.getElementById("storageList"),
    toast: document.getElementById("toast")
  };

  const navItems = Array.prototype.slice.call(document.querySelectorAll(".nav-item"));
  const panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));
  const settingsControls = [
    el.serverUrl, el.sourceLang, el.targetLang, el.outputVariant, el.threads
  ];

  let serverUrl = "";
  let storageDir = "";
  let allEntries = [];
  let groups = [];
  let apiKeyReal = "";
  let toastTimer = null;

  function maskKey(value) {
    const key = String(value || "").trim();
    if (!key) { return ""; }
    if (key.length <= 12) { return "*****"; }
    return key.slice(0, 8) + "*****" + key.slice(-4);
  }

  /* -- helpers ----------------------------------------------------------- */
  function setResult(node, text, ok) {
    node.textContent = text;
    node.classList.toggle("ok", ok === true);
    node.classList.toggle("err", ok === false);
  }

  function setDot(ok, text) {
    el.sideDot.classList.toggle("ok", ok === true);
    el.sideDot.classList.toggle("err", ok === false);
    el.sideDot.title = text
      || (ok === true ? "online" : ok === false ? "offline" : "检测中…");
  }

  function showToast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1500);
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

  function fillLangs() {
    AT.fillLangSelect(el.sourceLang);
    AT.fillLangSelect(el.targetLang);
  }

  /* -- navigation -------------------------------------------------------- */
  function showPanel(name) {
    navItems.forEach(function (item) {
      item.classList.toggle("is-active", item.dataset.panel === name);
    });
    panels.forEach(function (panel) {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });
    if (name === "records") {
      refreshStorage();
    }
  }

  /* -- settings ---------------------------------------------------------- */
  async function load() {
    const settings = await AT.getSettings();
    serverUrl = AT.normalizeServer(settings.serverUrl);
    el.serverUrl.value = serverUrl;
    el.sourceLang.value = settings.sourceLang;
    el.targetLang.value = settings.targetLang;
    el.outputVariant.value = settings.outputVariant;
    el.threads.value = settings.threads;
  }

  async function autoSave() {
    const nextServer = AT.normalizeServer(el.serverUrl.value);
    const values = {
      serverUrl: nextServer,
      sourceLang: el.sourceLang.value,
      targetLang: el.targetLang.value,
      outputVariant: el.outputVariant.value,
      threads: Math.max(1, parseInt(el.threads.value, 10) || 4)
    };
    el.serverUrl.value = nextServer;
    await AT.saveSettings(values);
    showToast("已保存");
    if (nextServer !== serverUrl) {
      serverUrl = nextServer;
      checkServer();
      refreshStorage();
      loadApiConfig();
    }
  }

  async function loadApiConfig() {
    if (!serverUrl) { return; }
    setResult(el.apiResult, "", null);
    try {
      const response = await fetch(serverUrl + "/config", { cache: "no-store" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      const cfg = await response.json();
      apiKeyReal = "";
      el.apiModel.value = cfg.openai_model || "";
      el.apiKey.value = "";
      el.apiKey.dataset.masked = "0";
      el.apiKey.placeholder = cfg.openai_api_key_set
        ? (cfg.openai_api_key_masked || "已设置") : "sk-...";
      el.apiKeyHelp.textContent = cfg.openai_api_key_set
        ? "已设置（" + cfg.openai_api_key_masked + "），留空保持不变。"
        : "形如 sk-…，留空则保持原密钥不变。";
    }
    catch (err) {
      setResult(el.apiResult, "无法读取服务配置（服务未启动？）", false);
    }
  }

  async function saveApi() {
    const payload = { openai_model: el.apiModel.value.trim() };
    const key = apiKeyReal.trim();
    if (key) { payload.openai_api_key = key; }
    try {
      const response = await fetch(serverUrl + "/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok && data.ok !== false) {
        setResult(el.apiResult, "已保存到服务", true);
        await loadApiConfig();
      }
      else {
        setResult(el.apiResult, "保存失败", false);
      }
    }
    catch (err) {
      setResult(el.apiResult, "无法连接服务，保存失败", false);
    }
  }

  async function clearApiKey() {
    if (!window.confirm("清除已保存的 API 密钥？")) { return; }
    try {
      await fetch(serverUrl + "/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai_api_key: "" })
      });
      setResult(el.apiResult, "已清除密钥", true);
      await loadApiConfig();
    }
    catch (err) {
      setResult(el.apiResult, "清除失败", false);
    }
  }

  async function checkServer() {
    const target = AT.normalizeServer(el.serverUrl.value);
    setDot(null, "检测中…");
    try {
      const response = await fetch(target + "/health", { cache: "no-store" });
      if (!response.ok) {
        setDot(false, "offline");
        return;
      }
      const health = await response.json();
      setDot(health.engine_available, health.engine_available ? "online" : "offline");
    }
    catch (err) {
      setDot(false, "offline");
    }
  }

  async function testConnection() {
    const target = AT.normalizeServer(el.serverUrl.value);
    setResult(el.testResult, "检测中…", null);
    try {
      const response = await fetch(target + "/health", { cache: "no-store" });
      if (!response.ok) {
        setResult(el.testResult, "服务返回 HTTP " + response.status, false);
        return;
      }
      const health = await response.json();
      if (health.engine_available) {
        setResult(el.testResult, "连接成功", true);
      }
      else {
        setResult(el.testResult, "服务在线，但未找到翻译引擎", false);
      }
    }
    catch (err) {
      setResult(el.testResult, "无法连接，请确认服务已启动", false);
    }
  }

  /* -- records ----------------------------------------------------------- */
  function entryMeta(entry) {
    const parts = [];
    if (entry.source_lang && entry.target_lang) {
      parts.push(entry.source_lang + "→" + entry.target_lang);
    }
    parts.push(entry.output_variant === "mono" ? "仅译文" : "双语");
    if (entry.pages) { parts.push("页 " + entry.pages); }
    parts.push(formatBytes(entry.size));
    parts.push(formatDate(entry.created_at));
    return parts.join(" · ");
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = className || "btn";
    button.addEventListener("click", onClick);
    return button;
  }

  function openEntry(entry) {
    const fileUrl = serverUrl + "/storage/" + entry.id;
    chrome.tabs.create({
      url: AT.fileViewerUrl(fileUrl, entry.title || entry.name, entry.source_url)
    });
  }

  async function downloadEntry(entry) {
    try {
      const response = await fetch(serverUrl + "/storage/" + entry.id, { cache: "no-store" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.name || (entry.id + ".pdf");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
    catch (err) {
      showToast("下载失败：" + err.message);
    }
  }

  async function deleteEntry(entry) {
    if (!window.confirm("删除记录“" + (entry.title || entry.name || entry.id) + "”？")) {
      return;
    }
    try {
      await fetch(serverUrl + "/storage/" + entry.id, { method: "DELETE" });
      refreshStorage();
    }
    catch (err) {
      showToast("删除失败：" + err.message);
    }
  }

  function matchesSearch(entry, query) {
    if (!query) { return true; }
    const hay = [entry.title, entry.name, entry.source_name, entry.source_url, entry.id]
      .join(" ").toLowerCase();
    return hay.indexOf(query) >= 0;
  }

  function updateDeleteGroupBtn() {
    const value = el.groupFilter.value;
    el.deleteGroupBtn.hidden = !(value && value !== GROUP_NONE);
  }

  function renderGroupFilter() {
    const current = el.groupFilter.value;
    el.groupFilter.innerHTML = "";

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部分组 (" + allEntries.length + ")";
    el.groupFilter.appendChild(all);

    const ungrouped = allEntries.filter(function (e) { return !e.group; }).length;
    const none = document.createElement("option");
    none.value = GROUP_NONE;
    none.textContent = "未分组 (" + ungrouped + ")";
    el.groupFilter.appendChild(none);

    groups.forEach(function (name) {
      const count = allEntries.filter(function (e) { return e.group === name; }).length;
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name + " (" + count + ")";
      el.groupFilter.appendChild(option);
    });

    const exists = Array.prototype.some.call(el.groupFilter.options, function (o) {
      return o.value === current;
    });
    el.groupFilter.value = exists ? current : "";
    updateDeleteGroupBtn();
  }

  function makeGroupSelect(entry) {
    const select = document.createElement("select");
    select.className = "group-select";

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "未分组";
    select.appendChild(none);

    const names = groups.slice();
    if (entry.group && names.indexOf(entry.group) < 0) {
      names.push(entry.group);
    }
    names.forEach(function (name) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = entry.group || "";

    select.addEventListener("change", async function () {
      entry.group = select.value;
      try {
        await fetch(serverUrl + "/storage/" + entry.id + "/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group: select.value })
        });
      }
      catch (err) {
        showToast("保存分组失败");
      }
      renderGroupFilter();
      renderStorage();
    });
    return select;
  }

  function renderStorage() {
    el.storageList.innerHTML = "";
    const query = (el.recordSearch.value || "").trim().toLowerCase();
    const filter = el.groupFilter.value;

    const filtered = allEntries.filter(function (entry) {
      if (filter === GROUP_NONE) {
        if (entry.group) { return false; }
      }
      else if (filter) {
        if (entry.group !== filter) { return false; }
      }
      return matchesSearch(entry, query);
    });

    if (!filtered.length) {
      el.storageEmpty.hidden = false;
      el.storageSummary.textContent = allEntries.length
        ? "没有匹配的记录"
        : (storageDir ? "目录：" + storageDir : "暂无记录");
      return;
    }
    el.storageEmpty.hidden = true;

    let total = 0;
    filtered.forEach(function (entry) { total += entry.size || 0; });
    el.storageSummary.textContent = "显示 " + filtered.length + " / " + allEntries.length
      + " 个 · " + formatBytes(total) + (storageDir ? " · " + storageDir : "");

    filtered.forEach(function (entry) {
      const item = document.createElement("div");
      item.className = "storage-item";

      const thumb = document.createElement("img");
      thumb.className = "si-thumb";
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.src = serverUrl + "/storage/" + entry.id + "/thumb.png";
      thumb.addEventListener("error", function () { thumb.classList.add("si-thumb-missing"); });
      item.appendChild(thumb);

      const main = document.createElement("div");
      main.className = "si-main";
      const name = document.createElement("div");
      name.className = "si-name";
      name.textContent = entry.title || entry.name || (entry.id + ".pdf");
      if (entry.title) { name.title = entry.title; }
      main.appendChild(name);
      if (entry.title && entry.name) {
        const file = document.createElement("div");
        file.className = "si-file";
        file.textContent = entry.name;
        main.appendChild(file);
      }
      const meta = document.createElement("div");
      meta.className = "si-meta";
      meta.textContent = entryMeta(entry);
      main.appendChild(meta);
      if (entry.source_url) {
        const url = document.createElement("div");
        url.className = "si-url";
        url.textContent = entry.source_url;
        url.title = entry.source_url;
        main.appendChild(url);
      }

      const actions = document.createElement("div");
      actions.className = "si-actions";
      actions.appendChild(makeGroupSelect(entry));
      actions.appendChild(makeButton("打开", "btn", function () { openEntry(entry); }));
      actions.appendChild(makeButton("下载", "btn", function () { downloadEntry(entry); }));
      actions.appendChild(makeButton("删除", "btn danger", function () { deleteEntry(entry); }));

      item.appendChild(main);
      item.appendChild(actions);
      el.storageList.appendChild(item);
    });
  }

  async function refreshStorage() {
    if (!serverUrl) { return; }
    el.storageSummary.textContent = "加载中…";
    try {
      const response = await fetch(serverUrl + "/storage", { cache: "no-store" });
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      const data = await response.json();
      allEntries = data.entries || [];
      storageDir = data.dir || "";
      groups = data.groups || [];
      renderGroupFilter();
      renderStorage();
    }
    catch (err) {
      el.storageSummary.textContent = "无法读取记录（服务未启动？）";
      el.storageEmpty.hidden = true;
      el.storageList.innerHTML = "";
    }
  }

  async function createGroup() {
    const name = window.prompt("新建分组名称：");
    if (!name || !name.trim()) { return; }
    try {
      const response = await fetch(serverUrl + "/storage/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });
      const data = await response.json();
      groups = data.groups || groups;
      renderGroupFilter();
      renderStorage();
      showToast("已创建分组");
    }
    catch (err) {
      showToast("创建分组失败");
    }
  }

  async function deleteGroup() {
    const name = el.groupFilter.value;
    if (!name || name === GROUP_NONE) { return; }
    if (!window.confirm("删除分组“" + name + "”？组内记录会变为未分组。")) { return; }
    try {
      await fetch(serverUrl + "/storage/groups/" + encodeURIComponent(name), { method: "DELETE" });
    }
    catch (err) {
      showToast("删除分组失败");
      return;
    }
    el.groupFilter.value = "";
    refreshStorage();
  }

  /* -- init -------------------------------------------------------------- */
  async function init() {
    fillLangs();
    await load();
    loadApiConfig();

    navItems.forEach(function (item) {
      item.addEventListener("click", function () { showPanel(item.dataset.panel); });
    });
    settingsControls.forEach(function (control) {
      control.addEventListener("change", autoSave);
    });
    el.testBtn.addEventListener("click", testConnection);
    el.saveApiBtn.addEventListener("click", saveApi);
    el.clearKeyBtn.addEventListener("click", clearApiKey);
    el.apiKey.addEventListener("focus", function () {
      if (el.apiKey.dataset.masked === "1") {
        el.apiKey.value = apiKeyReal;
        el.apiKey.dataset.masked = "0";
      }
    });
    el.apiKey.addEventListener("input", function () {
      apiKeyReal = el.apiKey.value;
      el.apiKey.dataset.masked = "0";
    });
    el.apiKey.addEventListener("blur", function () {
      const value = el.apiKey.value.trim();
      if (value) {
        apiKeyReal = value;
        el.apiKey.value = maskKey(value);
        el.apiKey.dataset.masked = "1";
      }
      else {
        apiKeyReal = "";
      }
    });
    el.storageRefresh.addEventListener("click", refreshStorage);
    el.recordSearch.addEventListener("input", renderStorage);
    el.groupFilter.addEventListener("change", function () {
      updateDeleteGroupBtn();
      renderStorage();
    });
    el.newGroupBtn.addEventListener("click", createGroup);
    el.deleteGroupBtn.addEventListener("click", deleteGroup);

    checkServer();
    refreshStorage();
    setTimeout(refreshStorage, 3500);
  }

  init();
})();
