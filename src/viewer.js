/* Arxiv PDF Translate - viewer page logic. */
(function () {
  "use strict";

  const el = {
    docTitle: document.getElementById("docTitle"),
    sourceLang: document.getElementById("sourceLang"),
    targetLang: document.getElementById("targetLang"),
    outputVariant: document.getElementById("outputVariant"),
    translateBtn: document.getElementById("translateBtn"),
    toggleSourceBtn: document.getElementById("toggleSourceBtn"),
    sourceLinkBtn: document.getElementById("sourceLinkBtn"),
    saveBtn: document.getElementById("saveBtn"),
    openTabBtn: document.getElementById("openTabBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    brandBtn: document.getElementById("brandBtn"),
    frame: document.getElementById("pdfFrame"),
    statusPanel: document.getElementById("statusPanel"),
    spinner: document.getElementById("spinner"),
    statusTitle: document.getElementById("statusTitle"),
    statusText: document.getElementById("statusText"),
    progressWrap: document.getElementById("progressWrap"),
    progressFill: document.getElementById("progressFill"),
    progressPct: document.getElementById("progressPct"),
    logTail: document.getElementById("logTail"),
    logToggleBtn: document.getElementById("logToggleBtn"),
    errorText: document.getElementById("errorText"),
    retryBtn: document.getElementById("retryBtn"),
    settingsBtn: document.getElementById("settingsBtn")
  };

  const state = {
    srcUrl: "",
    serverUrl: "",
    settings: null,
    sourceBlob: null,
    translatedBlob: null,
    translatedName: "",
    sourceUrlObject: null,
    translatedUrlObject: null,
    jobId: null,
    cancelled: false,
    running: false,
    showingSource: false,
    pages: "",
    ignoreCache: false,
    readMode: false,
    fileUrl: "",
    sourceUrl: "",
    logExpanded: false
  };

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function fillLangs() {
    PDF2ZH.fillLangSelect(el.sourceLang);
    PDF2ZH.fillLangSelect(el.targetLang);
  }

  function setStatus(title, text, options) {
    const opts = options || {};
    el.statusPanel.hidden = false;
    el.statusTitle.textContent = title || "";
    el.statusText.textContent = text || "";
    el.spinner.hidden = opts.spinner === false;
    if (typeof opts.log === "string") {
      el.logTail.textContent = opts.log;
    }
    else if (opts.log === null) {
      el.logTail.textContent = "";
    }
    const hasLog = !!el.logTail.textContent.trim();
    el.logToggleBtn.hidden = !hasLog;
    el.logToggleBtn.textContent = state.logExpanded ? "隐藏日志" : "显示日志";
    el.logTail.hidden = !hasLog || !state.logExpanded;
    if (typeof opts.progress === "number") {
      const pct = Math.max(0, Math.min(100, Math.round(opts.progress)));
      el.progressWrap.hidden = false;
      el.progressFill.style.width = pct + "%";
      el.progressPct.textContent = pct + "%";
    }
    else {
      el.progressWrap.hidden = true;
    }
    el.errorText.hidden = true;
    el.errorText.textContent = "";
    el.retryBtn.hidden = true;
    el.settingsBtn.hidden = true;
  }

  function showError(message, options) {
    const opts = options || {};
    el.statusPanel.hidden = false;
    el.spinner.hidden = true;
    el.statusTitle.textContent = "翻译失败";
    el.statusText.textContent = "";
    el.logTail.textContent = "";
    el.logTail.hidden = true;
    el.logToggleBtn.hidden = true;
    el.progressWrap.hidden = true;
    el.errorText.hidden = false;
    el.errorText.textContent = message;
    el.retryBtn.hidden = false;
    el.settingsBtn.hidden = !opts.showSettings;
  }

  function setRunning(running) {
    state.running = running;
    el.translateBtn.disabled = running;
    el.translateBtn.hidden = running;
    el.cancelBtn.hidden = !running;
    el.sourceLang.disabled = running;
    el.targetLang.disabled = running;
    el.outputVariant.disabled = running;
    if (running) {
      el.saveBtn.hidden = true;
      el.openTabBtn.hidden = true;
      el.toggleSourceBtn.hidden = true;
    }
  }

  function renderPdf(blob, which) {
    const key = which === "source" ? "sourceUrlObject" : "translatedUrlObject";
    if (state[key]) {
      URL.revokeObjectURL(state[key]);
    }
    const url = URL.createObjectURL(blob);
    state[key] = url;
    state.showingSource = which === "source";
    el.frame.hidden = false;
    el.statusPanel.hidden = true;
    el.frame.src = url;

    if (state.translatedBlob && !state.readMode) {
      el.toggleSourceBtn.hidden = false;
      el.toggleSourceBtn.textContent = state.showingSource ? "查看译文" : "查看原文";
    }
    if (state.translatedBlob) {
      el.saveBtn.hidden = false;
      el.openTabBtn.hidden = false;
    }
  }

  async function fetchSource() {
    const response = await fetch(state.srcUrl, { credentials: "include" });
    if (!response.ok) {
      throw new Error("下载源 PDF 失败：HTTP " + response.status + " " + response.statusText);
    }
    const contentType = response.headers.get("content-type") || "";
    const blob = await response.blob();
    if (blob.size < 5) {
      throw new Error("源文件为空或无法读取（file:// 链接需要在扩展详情里开启“允许访问文件网址”）。");
    }
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const magic = String.fromCharCode.apply(null, head);
    if (magic !== "%PDF-") {
      throw new Error("该链接返回的不是 PDF 文件（Content-Type: " + (contentType || "unknown") + "）。");
    }
    return blob;
  }

  async function loadFile() {
    document.body.classList.add("read-mode");
    try {
      setStatus("加载中", "正在读取 PDF…", { spinner: true, log: null });
      const response = await fetch(state.fileUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("读取 PDF 失败：HTTP " + response.status);
      }
      const blob = await response.blob();
      if (blob.size < 5) {
        throw new Error("文件为空或无法读取。");
      }
      state.translatedBlob = blob;
      renderPdf(blob, "translated");
    }
    catch (err) {
      const message = err && err.message ? err.message : String(err);
      showError(message, { showSettings: false });
    }
  }

  async function loadSource() {
    try {
      setStatus("加载原文", "正在下载源 PDF…", { spinner: true, log: null });
      state.sourceBlob = await fetchSource();
      renderPdf(state.sourceBlob, "source");
    }
    catch (err) {
      const message = err && err.message ? err.message : String(err);
      showError(message, { showSettings: false });
    }
  }

  async function uploadJob(blob) {
    const params = new URLSearchParams({
      source_lang: el.sourceLang.value,
      target_lang: el.targetLang.value,
      output_variant: el.outputVariant.value,
      threads: String(state.settings.threads || 4),
      filename: PDF2ZH.basename(state.srcUrl),
      source_url: state.srcUrl
    });
    if (state.pages) {
      params.set("pages", state.pages);
    }
    if (state.ignoreCache) {
      params.set("ignore_cache", "1");
    }

    const response = await fetch(state.serverUrl + "/jobs?" + params.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: blob
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await response.json());
      }
      catch (err) {
        detail = await response.text();
      }
      throw new Error("本地 pdf2zh 服务返回 HTTP " + response.status + "\n" + detail);
    }
    return response.json();
  }

  async function pollJob(jobId) {
    while (!state.cancelled) {
      await delay(state.settings.pollIntervalMs || 1500);
      const response = await fetch(state.serverUrl + "/jobs/" + jobId);
      if (!response.ok) {
        throw new Error("查询任务状态失败：HTTP " + response.status);
      }
      const job = await response.json();
      if (job.message || job.log_tail) {
        const hasProgress = typeof job.progress === "number";
        setStatus("正在翻译…", (job.message || "") + "  (" + job.elapsed + "s)", {
          spinner: true,
          log: job.log_tail || "",
          progress: hasProgress ? job.progress : undefined
        });
      }
      if (job.status === "done") {
        state.translatedName = job.result_name || "translated.pdf";
        return job;
      }
      if (job.status === "error") {
        throw new Error(job.error || "pdf2zh 运行失败");
      }
      if (job.status === "cancelled") {
        throw new Error("翻译已取消");
      }
    }
    throw new Error("翻译已取消");
  }

  async function fetchResult(jobId) {
    const response = await fetch(state.serverUrl + "/jobs/" + jobId + "/result");
    if (!response.ok) {
      throw new Error("下载译文失败：HTTP " + response.status);
    }
    return response.blob();
  }

  async function startTranslation() {
    if (state.running) {
      return;
    }
    state.cancelled = false;
    state.translatedBlob = null;
    state.translatedName = "";
    setRunning(true);
    el.frame.hidden = true;

    try {
      if (!state.sourceBlob) {
        setStatus("第 1/3 步", "正在下载源 PDF…", { spinner: true, log: null });
        state.sourceBlob = await fetchSource();
      }

      setStatus("第 2/3 步", "正在上传到本地 pdf2zh 服务…", { spinner: true, log: null });
      let job;
      try {
        job = await uploadJob(state.sourceBlob);
      }
      catch (err) {
        throw new Error(
          "无法连接本地 pdf2zh 服务。\n请确认已启动 ArxivPdfTranslate 托盘程序（或 server/pdf2zh_server.py）。\n\n" + err.message
        );
      }
      state.jobId = job.id;

      setStatus("第 3/3 步", "pdf2zh 正在翻译，请稍候…", { spinner: true, log: null });
      await pollJob(state.jobId);

      setStatus("完成", "正在加载译文…", { spinner: true });
      state.translatedBlob = await fetchResult(state.jobId);

      setRunning(false);
      renderPdf(state.translatedBlob, "translated");
    }
    catch (err) {
      setRunning(false);
      const message = err && err.message ? err.message : String(err);
      showError(message, { showSettings: /无法连接|pdf2zh_server|托盘/.test(message) });
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "translated.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function wireEvents() {
    el.translateBtn.addEventListener("click", startTranslation);
    el.retryBtn.addEventListener("click", startTranslation);

    el.cancelBtn.addEventListener("click", async function () {
      state.cancelled = true;
      if (state.jobId) {
        try {
          await fetch(state.serverUrl + "/jobs/" + state.jobId, { method: "DELETE" });
        }
        catch (err) {
          /* ignore */
        }
      }
    });

    el.saveBtn.addEventListener("click", function () {
      if (state.translatedBlob) {
        downloadBlob(state.translatedBlob, state.translatedName);
      }
    });

    el.logToggleBtn.addEventListener("click", function () {
      state.logExpanded = !state.logExpanded;
      el.logTail.hidden = !state.logExpanded || !el.logTail.textContent.trim();
      el.logToggleBtn.textContent = state.logExpanded ? "隐藏日志" : "显示日志";
    });

    el.sourceLinkBtn.addEventListener("click", function () {
      if (state.sourceUrl) {
        chrome.tabs.create({ url: state.sourceUrl });
      }
    });

    el.openTabBtn.addEventListener("click", function () {
      const target = state.readMode ? state.fileUrl : state.translatedUrlObject;
      if (!target) {
        return;
      }
      chrome.tabs.create({
        url: PDF2ZH.fileViewerUrl(target, state.translatedName || el.docTitle.textContent)
      });
    });

    el.toggleSourceBtn.addEventListener("click", function () {
      if (!state.sourceBlob && !state.translatedBlob) {
        return;
      }
      if (state.showingSource) {
        if (state.translatedBlob) {
          renderPdf(state.translatedBlob, "translated");
        }
      }
      else if (state.sourceBlob) {
        renderPdf(state.sourceBlob, "source");
      }
    });

    const openOptions = function () {
      chrome.runtime.openOptionsPage();
    };
    el.brandBtn.addEventListener("click", openOptions);
    el.settingsBtn.addEventListener("click", openOptions);
  }

  async function init() {
    fillLangs();
    wireEvents();

    const params = new URLSearchParams(location.search);
    state.srcUrl = params.get("src") || "";
    state.fileUrl = params.get("file") || "";

    if (!state.srcUrl && !state.fileUrl) {
      showError("缺少 src/file 参数，无法确定要显示的 PDF。", {});
      return;
    }

    state.settings = await PDF2ZH.getSettings();
    state.serverUrl = PDF2ZH.normalizeServer(state.settings.serverUrl);

    if (state.fileUrl) {
      state.readMode = true;
      state.sourceUrl = params.get("source") || "";
      const title = params.get("title") || PDF2ZH.basename(state.fileUrl);
      state.translatedName = title;
      el.docTitle.textContent = title;
      el.docTitle.title = state.fileUrl;
      document.title = title + " - Arxiv PDF Translate";
      el.sourceLinkBtn.hidden = !state.sourceUrl;
      await loadFile();
      return;
    }

    if (params.get("source_lang")) { state.settings.sourceLang = params.get("source_lang"); }
    if (params.get("target_lang")) { state.settings.targetLang = params.get("target_lang"); }
    if (params.get("output_variant")) { state.settings.outputVariant = params.get("output_variant"); }
    if (params.get("threads")) { state.settings.threads = params.get("threads"); }
    state.pages = params.get("pages") || "";
    state.ignoreCache = params.get("ignore_cache") === "1";

    el.sourceLang.value = state.settings.sourceLang;
    el.targetLang.value = state.settings.targetLang;
    el.outputVariant.value = state.settings.outputVariant || "dual";

    const name = PDF2ZH.basename(state.srcUrl);
    state.sourceUrl = state.srcUrl;
    el.sourceLinkBtn.hidden = !state.sourceUrl;
    el.docTitle.textContent = name;
    el.docTitle.title = state.srcUrl;
    document.title = name + " - Arxiv PDF Translate";

    if (params.get("auto") === "1") {
      startTranslation();
    }
    else {
      await loadSource();
    }
  }

  init();
})();
