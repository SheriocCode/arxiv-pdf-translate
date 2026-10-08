/* Arxiv PDF Translate - unified local web console. Same-origin: served by server.py. */
(function () {
  "use strict";

  const GROUP_NONE = "\u0000none";
  const API = "";

  // Stable extension id (pinned via the "key" field in manifest.json). The
  // console probes a web-accessible icon to tell whether the extension is
  // installed in this browser.
  const EXTENSION_ID = "ajabefplecofaoccaobofemmdcjdfala";
  const EXTENSION_PROBE = "chrome-extension://" + EXTENSION_ID + "/icons/icon16.png";

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

  const $ = function (id) { return document.getElementById(id); };

  const el = {
    sideDot: $("sideDot"),
    ovServiceDot: $("ovServiceDot"), ovService: $("ovService"), ovUrl: $("ovUrl"),
    ovEngineDot: $("ovEngineDot"), ovEngine: $("ovEngine"), ovEnginePath: $("ovEnginePath"),
    ovVersion: $("ovVersion"), ovPid: $("ovPid"), ovConfigPath: $("ovConfigPath"),
    extDot: $("extDot"), extText: $("extText"), extHint: $("extHint"), copyExtDirBtn: $("copyExtDirBtn"),
    apiBase: $("apiBase"), apiModel: $("apiModel"), apiKey: $("apiKey"),
    apiKeyHelp: $("apiKeyHelp"), clearKeyBtn: $("clearKeyBtn"),
    sourceLang: $("sourceLang"), targetLang: $("targetLang"),
    outputVariant: $("outputVariant"), threads: $("threads"),
    enginePath: $("enginePath"), enginePathHelp: $("enginePathHelp"),
    extraArgs: $("extraArgs"), timeout: $("timeout"),
    saveConfig: $("saveConfig"), reloadConfig: $("reloadConfig"),
    configResult: $("configResult"), configPath: $("configPath"),
    recordSearch: $("recordSearch"), groupFilter: $("groupFilter"),
    newGroupBtn: $("newGroupBtn"), deleteGroupBtn: $("deleteGroupBtn"),
    storageSummary: $("storageSummary"), storageRefresh: $("storageRefresh"),
    storageEmpty: $("storageEmpty"), storageList: $("storageList"),
    logPath: $("logPath"), logTrace: $("logTrace"), logEmpty: $("logEmpty"),
    logLevelChips: $("logLevelChips"), logCatChips: $("logCatChips"),
    logSearch: $("logSearch"), logRefresh: $("logRefresh"), logClear: $("logClear"),
    autostart: $("autostart"), autostartHelp: $("autostartHelp"),
    createShortcut: $("createShortcut"), shortcutResult: $("shortcutResult"),
    stopService: $("stopService"), restartHint: $("restartHint"),
    systemInfo: $("systemInfo"),
    toast: $("toast")
  };

  const navItems = Array.prototype.slice.call(document.querySelectorAll(".nav-item"));
  const panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));

  let toastTimer = null;
  let storageDir = "";
  let allEntries = [];
  let groups = [];
  let logTimer = null;
  let healthTimer = null;
  let projectRoot = "";
  let allLogs = [];
  let logLevelFilter = "ALL";
  let logCatFilter = "ALL";
  let logSig = "";
  const logExpanded = {};

  /* -- helpers ----------------------------------------------------------- */
  function setResult(node, text, ok) {
    if (!node) { return; }
    node.textContent = text || "";
    node.classList.toggle("ok", ok === true);
    node.classList.toggle("err", ok === false);
  }

  function setDot(node, ok, title) {
    if (!node) { return; }
    node.classList.toggle("ok", ok === true);
    node.classList.toggle("err", ok === false);
    if (title !== undefined && node.title !== title) { node.title = title; }
  }

  function showToast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1600);
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

  async function api(path, options) {
    const response = await fetch(API + path, options);
    if (!response.ok) { throw new Error("HTTP " + response.status); }
    return response.json();
  }

  function fillLangs() {
    LANGS.forEach(function (pair) {
      [el.sourceLang, el.targetLang].forEach(function (select) {
        const option = document.createElement("option");
        option.value = pair[0];
        option.textContent = pair[1];
        select.appendChild(option);
      });
    });
  }

  /* -- navigation -------------------------------------------------------- */
  function showPanel(name) {
    navItems.forEach(function (item) {
      item.classList.toggle("is-active", item.dataset.panel === name);
    });
    panels.forEach(function (panel) {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });
    if (name === "records") { refreshStorage(); }
    if (name === "logs") { refreshLog(); }
    if (name === "system") { refreshSystem(); }
    updateLogTimer(name);
  }

  /* -- health / overview ------------------------------------------------- */
  async function refreshHealth() {
    try {
      const health = await api("/health", { cache: "no-store" });
      setDot(el.sideDot, health.engine_available, health.engine_available ? "服务在线" : "未找到引擎");
      setDot(el.ovServiceDot, true, "在线");
      el.ovService.textContent = "在线";
      setDot(el.ovEngineDot, health.engine_available, health.engine_available ? "可用" : "未找到");
      el.ovEngine.textContent = health.engine_available ? "可用" : "未找到";
      el.ovEnginePath.textContent = health.engine || "";
      el.ovVersion.textContent = health.version || "-";
      el.ovUrl.textContent = "http://" + location.host;
      el.ovPid.textContent = "端口 " + (location.port || "80");
    }
    catch (err) {
      setDot(el.sideDot, false, "服务离线");
      setDot(el.ovServiceDot, false, "离线");
      el.ovService.textContent = "离线";
      setDot(el.ovEngineDot, false, "");
      el.ovEngine.textContent = "未知";
    }
  }

  /* -- browser extension detection --------------------------------------- */
  function detectExtension() {
    return new Promise(function (resolve) {
      const img = new Image();
      let settled = false;
      const finish = function (value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(value);
      };
      const timer = setTimeout(function () { finish(false); }, 4000);
      img.onload = function () { finish(true); };
      img.onerror = function () { finish(false); };
      img.src = EXTENSION_PROBE;
    });
  }

  async function refreshExtensionStatus() {
    const installed = await detectExtension();
    setDot(el.extDot, installed, installed ? "已安装" : "未安装");
    el.extText.textContent = installed ? "浏览器扩展：已安装" : "浏览器扩展：未安装（或未启用）";
    el.extHint.textContent = installed
      ? ""
      : "（可选）chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择本项目目录";
    el.copyExtDirBtn.hidden = installed;
    return installed;
  }

  function copyText(text) {
    if (!text) { showToast("暂无法获取路径"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast("已复制扩展目录"); },
        function () { showToast("复制失败"); });
    }
    else {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); showToast("已复制扩展目录"); }
      catch (err) { showToast("复制失败"); }
      area.remove();
    }
  }

  /* -- config ------------------------------------------------------------ */
  function maskKey(value) {
    const key = String(value || "").trim();
    if (!key) { return ""; }
    if (key.length <= 12) { return "*****"; }
    return key.slice(0, 8) + "*****" + key.slice(-4);
  }

  async function loadConfig() {
    setResult(el.configResult, "", null);
    try {
      const cfg = await api("/config", { cache: "no-store" });
      el.apiBase.value = cfg.openai_base_url || "";
      el.apiModel.value = cfg.openai_model || "";
      el.apiKey.value = "";
      el.apiKey.placeholder = cfg.openai_api_key_set
        ? (cfg.openai_api_key_masked || "已设置") : "sk-...";
      el.apiKeyHelp.textContent = cfg.openai_api_key_set
        ? "已设置（" + cfg.openai_api_key_masked + "），留空保持不变。"
        : "形如 sk-…，留空则保持原密钥不变。";
      el.sourceLang.value = cfg.source_lang || "en";
      el.targetLang.value = cfg.target_lang || "zh-CN";
      el.outputVariant.value = cfg.output_variant || "dual";
      el.threads.value = cfg.threads || 4;
      el.enginePath.value = cfg.engine_path || "";
      el.extraArgs.value = cfg.extra_args || "";
      el.timeout.value = cfg.timeout || 3600;
      el.configPath.textContent = "配置文件：" + (cfg.config_path || "");
      el.ovConfigPath.textContent = "配置文件：" + (cfg.config_path || "");
    }
    catch (err) {
      setResult(el.configResult, "无法读取配置（服务未启动？）", false);
    }
  }

  async function saveConfig() {
    const payload = {
      openai_base_url: el.apiBase.value.trim(),
      openai_model: el.apiModel.value.trim(),
      source_lang: el.sourceLang.value,
      target_lang: el.targetLang.value,
      output_variant: el.outputVariant.value,
      threads: parseInt(el.threads.value, 10) || 4,
      engine_path: el.enginePath.value.trim(),
      extra_args: el.extraArgs.value.trim(),
      timeout: parseInt(el.timeout.value, 10) || 3600
    };
    const key = el.apiKey.value.trim();
    if (key) { payload.openai_api_key = key; }
    setResult(el.configResult, "保存中…", null);
    try {
      const data = await api("/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (data.ok === false) { throw new Error("save failed"); }
      setResult(el.configResult, "已保存", true);
      showToast("配置已保存");
      await loadConfig();
      refreshHealth();
    }
    catch (err) {
      setResult(el.configResult, "保存失败：" + err.message, false);
    }
  }

  async function clearApiKey() {
    if (!window.confirm("清除已保存的 API 密钥？")) { return; }
    try {
      await api("/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai_api_key: "" })
      });
      setResult(el.configResult, "已清除密钥", true);
      await loadConfig();
    }
    catch (err) {
      setResult(el.configResult, "清除失败", false);
    }
  }

  /* -- records ----------------------------------------------------------- */
  function entryMeta(entry) {
    const parts = [];
    if (entry.source_lang && entry.target_lang) { parts.push(entry.source_lang + "→" + entry.target_lang); }
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
    window.open(API + "/storage/" + entry.id, "_blank");
  }

  async function downloadEntry(entry) {
    try {
      const response = await fetch(API + "/storage/" + entry.id, { cache: "no-store" });
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
    if (!window.confirm("删除记录“" + (entry.title || entry.name || entry.id) + "”？")) { return; }
    try {
      await fetch(API + "/storage/" + entry.id, { method: "DELETE" });
      refreshStorage();
    }
    catch (err) {
      showToast("删除失败：" + err.message);
    }
  }

  function matchesSearch(entry, query) {
    if (!query) { return true; }
    return [entry.title, entry.name, entry.source_name, entry.source_url, entry.id]
      .join(" ").toLowerCase().indexOf(query) >= 0;
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

    const exists = Array.prototype.some.call(el.groupFilter.options, function (o) { return o.value === current; });
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
    if (entry.group && names.indexOf(entry.group) < 0) { names.push(entry.group); }
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
        await api("/storage/" + entry.id + "/group", {
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
      if (filter === GROUP_NONE) { if (entry.group) { return false; } }
      else if (filter) { if (entry.group !== filter) { return false; } }
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
      thumb.src = API + "/storage/" + entry.id + "/thumb.png";
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
    el.storageSummary.textContent = "加载中…";
    try {
      const data = await api("/storage", { cache: "no-store" });
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
      const data = await api("/storage/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });
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
      await fetch(API + "/storage/groups/" + encodeURIComponent(name), { method: "DELETE" });
    }
    catch (err) {
      showToast("删除分组失败");
      return;
    }
    el.groupFilter.value = "";
    refreshStorage();
  }

  /* -- logs (trace view) ------------------------------------------------- */
  const LOG_LEVEL_LABELS = {
    ERROR: "错误", WARN: "警告", SUCCESS: "成功", INFO: "信息", DEBUG: "调试"
  };
  const LOG_CAT_LABELS = {
    JOB: "任务", ENGINE: "引擎", CACHE: "缓存", STORAGE: "存储",
    CONFIG: "配置", SYSTEM: "系统", NET: "网络", SERVER: "服务"
  };

  function levelLabel(level) { return LOG_LEVEL_LABELS[level] || level; }
  function catLabel(cat) { return LOG_CAT_LABELS[cat] || cat; }

  function logMatches(entry, query) {
    if (logLevelFilter !== "ALL" && entry.level !== logLevelFilter) { return false; }
    if (logCatFilter !== "ALL" && (entry.category || "LOG") !== logCatFilter) { return false; }
    if (!query) { return true; }
    return [entry.message, entry.category, entry.level, entry.job, entry.time]
      .join(" ").toLowerCase().indexOf(query) >= 0;
  }

  function formatLogDetail(text) {
    try {
      const data = JSON.parse(text);
      if (typeof data === "string") { return data; }
      if (Array.isArray(data) && data.length && data[0]
          && (data[0].src !== undefined || data[0].bbox !== undefined)) {
        return data.map(function (block) {
          const head = "#" + (block.index != null ? block.index : "?")
            + "/" + (block.total != null ? block.total : "?")
            + (block.bbox ? "  bbox=[" + block.bbox.join(", ") + "]" : "");
          const parts = [head];
          if (block.src) { parts.push("源: " + block.src); }
          if (block.dst) { parts.push("译: " + block.dst); }
          return parts.join("\n");
        }).join("\n\n");
      }
      return JSON.stringify(data, null, 2);
    }
    catch (err) {
      return text;
    }
  }

  function logAtBottom() {
    const box = el.logTrace;
    return box.scrollHeight - box.scrollTop - box.clientHeight <= 8;
  }

  function renderLog() {
    const atBottom = logAtBottom();
    const prevTop = el.logTrace.scrollTop;
    const query = (el.logSearch.value || "").trim().toLowerCase();
    const slice = allLogs.filter(function (entry) { return logMatches(entry, query); }).slice(-1200);

    el.logTrace.innerHTML = "";
    el.logEmpty.hidden = slice.length > 0;

    slice.forEach(function (entry) {
      const detailText = entry.detail || "";
      const multiline = /\n/.test(entry.message || "");
      const expandable = !!(detailText || multiline);

      const row = document.createElement("div");
      row.className = "trace-row lvl-" + String(entry.level || "info").toLowerCase();
      if (expandable) { row.classList.add("has-detail"); }

      const dot = document.createElement("span");
      dot.className = "trace-dot";
      row.appendChild(dot);

      const body = document.createElement("div");
      body.className = "trace-body";

      const line = document.createElement("div");
      line.className = "trace-line";

      const time = document.createElement("span");
      time.className = "trace-time";
      if (entry.time) {
        const date = document.createElement("span");
        date.className = "trace-date";
        date.textContent = entry.time.slice(0, 10);
        time.appendChild(date);
        time.appendChild(document.createTextNode(" " + entry.time.slice(11)));
      }
      else {
        time.textContent = "—";
      }

      const level = document.createElement("span");
      level.className = "trace-level";
      level.textContent = levelLabel(entry.level);

      const cat = document.createElement("span");
      cat.className = "trace-cat cat-" + String(entry.category || "log").toLowerCase();
      cat.textContent = catLabel(entry.category);

      line.appendChild(time);
      line.appendChild(level);
      line.appendChild(cat);
      if (entry.job) {
        const job = document.createElement("span");
        job.className = "trace-job";
        job.textContent = entry.job.slice(0, 8);
        job.title = "任务 " + entry.job;
        line.appendChild(job);
      }
      const msg = document.createElement("span");
      msg.className = "trace-msg";
      let display = entry.message || "";
      if (entry.job) {
        display = display.replace(new RegExp("^job\\s+" + entry.job + "[:\\s]+"), "");
      }
      msg.textContent = display;
      line.appendChild(msg);
      body.appendChild(line);

      if (expandable) {
        const detail = document.createElement("div");
        detail.className = "trace-detail";
        detail.hidden = !logExpanded[entry.raw];
        const pre = document.createElement("pre");
        pre.className = "trace-raw";
        pre.textContent = detailText ? formatLogDetail(detailText) : (entry.message || "");
        detail.appendChild(pre);
        body.appendChild(detail);

        line.addEventListener("click", function () {
          detail.hidden = !detail.hidden;
          logExpanded[entry.raw] = !detail.hidden;
        });
      }

      row.appendChild(body);
      el.logTrace.appendChild(row);
    });

    if (atBottom) {
      el.logTrace.scrollTop = el.logTrace.scrollHeight;
    }
    else {
      el.logTrace.scrollTop = prevTop;
    }
  }

  async function refreshLog() {
    try {
      const data = await api("/logs?lines=2000", { cache: "no-store" });
      const entries = data.entries || [];
      const sig = entries.length + "|" + (entries.length ? entries[entries.length - 1].raw : "");
      if (sig !== logSig) {
        logSig = sig;
        allLogs = entries;
        renderLog();
      }
      if (data.path) {
        el.logPath.innerHTML = "服务输出日志：<code></code>";
        el.logPath.querySelector("code").textContent = data.path;
      }
    }
    catch (err) {
      el.logTrace.innerHTML = "";
      el.logEmpty.hidden = false;
      el.logEmpty.textContent = "无法读取日志（服务未启动？）";
    }
  }

  function updateLogTimer(activePanel) {
    clearInterval(logTimer);
    logTimer = null;
    if (activePanel === "logs") {
      logTimer = setInterval(refreshLog, 1500);
    }
  }

  /* -- system ------------------------------------------------------------ */
  async function refreshSystem() {
    try {
      const info = await api("/system", { cache: "no-store" });
      projectRoot = info.project_root || "";
      el.autostart.checked = !!info.autostart;
      el.autostart.disabled = !info.autostart_supported;
      el.autostartHelp.textContent = info.autostart_supported
        ? (info.launcher ? "自启目标：" + info.launcher : "未找到启动器可执行文件，无法设置自启。")
        : "当前系统不支持（仅 Windows）。";
      el.createShortcut.disabled = !info.shortcut_supported;

      const rows = [
        ["平台", info.platform],
        ["版本", info.version],
        ["进程 ID", info.pid],
        ["控制台地址", info.console_url],
        ["配置文件", info.config_path],
        ["日志文件", info.log_file],
        ["启动器", info.launcher || "未找到"]
      ];
      el.systemInfo.innerHTML = "";
      rows.forEach(function (pair) {
        const dt = document.createElement("dt");
        dt.textContent = pair[0];
        const dd = document.createElement("dd");
        dd.textContent = pair[1];
        el.systemInfo.appendChild(dt);
        el.systemInfo.appendChild(dd);
      });
    }
    catch (err) {
      el.autostartHelp.textContent = "无法读取系统信息（服务未启动？）";
    }
  }

  async function toggleAutostart() {
    const enabled = el.autostart.checked;
    try {
      const data = await api("/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabled })
      });
      el.autostart.checked = !!data.autostart;
      showToast(data.autostart ? "已开启开机自启" : "已关闭开机自启");
    }
    catch (err) {
      el.autostart.checked = !enabled;
      showToast("设置失败");
    }
  }

  async function doCreateShortcut() {
    setResult(el.shortcutResult, "创建中…", null);
    try {
      const data = await api("/shortcut", { method: "POST" });
      setResult(el.shortcutResult, data.ok ? "已创建：" + data.path : "创建失败", !!data.ok);
    }
    catch (err) {
      setResult(el.shortcutResult, "创建失败", false);
    }
  }

  async function stopService() {
    if (!window.confirm("停止本机服务？停止后需要从托盘图标重新启动。")) { return; }
    try {
      await fetch(API + "/server/shutdown", { method: "POST" });
      showToast("服务已停止，请从托盘重新启动");
    }
    catch (err) {
      /* connection may drop as the server exits */
      showToast("服务已停止，请从托盘重新启动");
    }
    setTimeout(function () {
      el.ovService.textContent = "已停止";
      setDot(el.ovServiceDot, false, "已停止");
      setDot(el.sideDot, false, "已停止");
    }, 400);
  }

  /* -- init -------------------------------------------------------------- */
  function init() {
    fillLangs();

    navItems.forEach(function (item) {
      item.addEventListener("click", function () { showPanel(item.dataset.panel); });
    });
    Array.prototype.slice.call(document.querySelectorAll("[data-goto]")).forEach(function (button) {
      button.addEventListener("click", function () { showPanel(button.dataset.goto); });
    });

    el.saveConfig.addEventListener("click", saveConfig);
    el.reloadConfig.addEventListener("click", loadConfig);
    el.clearKeyBtn.addEventListener("click", clearApiKey);

    el.storageRefresh.addEventListener("click", refreshStorage);
    el.recordSearch.addEventListener("input", renderStorage);
    el.groupFilter.addEventListener("change", function () { updateDeleteGroupBtn(); renderStorage(); });
    el.newGroupBtn.addEventListener("click", createGroup);
    el.deleteGroupBtn.addEventListener("click", deleteGroup);

    el.logRefresh.addEventListener("click", refreshLog);
    Array.prototype.slice.call(el.logLevelChips.children).forEach(function (chip) {
      chip.addEventListener("click", function () {
        logLevelFilter = chip.dataset.level;
        Array.prototype.slice.call(el.logLevelChips.children).forEach(function (other) {
          other.classList.toggle("is-active", other === chip);
        });
        renderLog();
      });
    });
    Array.prototype.slice.call(el.logCatChips.children).forEach(function (chip) {
      chip.addEventListener("click", function () {
        logCatFilter = chip.dataset.cat;
        Array.prototype.slice.call(el.logCatChips.children).forEach(function (other) {
          other.classList.toggle("is-active", other === chip);
        });
        renderLog();
      });
    });
    el.logClear.addEventListener("click", async function () {
      if (!window.confirm("清空运行日志？此操作不可撤销。")) { return; }
      try {
        await api("/logs/clear", { method: "POST" });
        logSig = "";
        await refreshLog();
        showToast("日志已清空");
      }
      catch (err) {
        showToast("清空失败");
      }
    });
    el.logSearch.addEventListener("input", renderLog);

    el.autostart.addEventListener("change", toggleAutostart);
    el.createShortcut.addEventListener("click", doCreateShortcut);
    el.stopService.addEventListener("click", stopService);
    el.restartHint.addEventListener("click", function () {
      window.alert("在 Windows 任务栏右下角的托盘图标上右键 → “启动服务”，即可重新拉起本机服务。");
    });

    el.copyExtDirBtn.addEventListener("click", function () {
      copyText(projectRoot);
    });
    window.addEventListener("focus", function () {
      refreshExtensionStatus();
    });

    loadConfig();
    refreshHealth();
    refreshStorage();
    refreshSystem();
    refreshLog();
    refreshExtensionStatus();

    healthTimer = setInterval(refreshHealth, 3000);
    window.addEventListener("beforeunload", function () { clearInterval(healthTimer); });
  }

  init();
})();
