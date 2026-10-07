/* Arxiv PDF Translate - viewer page logic. */
(function () {
  "use strict";

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL("src/vendor/pdf.worker.min.js");
  }

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
    compare: document.getElementById("compareView"),
    viewModes: document.getElementById("viewModes"),
    pageNav: document.getElementById("pageNav"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageInput: document.getElementById("pageInput"),
    pageTotal: document.getElementById("pageTotal"),
    zoomNav: document.getElementById("zoomNav"),
    zoomOut: document.getElementById("zoomOut"),
    zoomIn: document.getElementById("zoomIn"),
    zoomLevel: document.getElementById("zoomLevel"),
    toolProgress: document.getElementById("toolProgress"),
    toolProgressFill: document.getElementById("toolProgressFill"),
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
    leftDoc: null,
    rightDoc: null,
    rightRendered: 0,
    rightSlots: [],
    leftSlots: [],
    rightCanvases: [],
    translatedIndices: [],
    basePageW: 0,
    zoom: 1,
    lastDpr: 0,
    rows: [],
    currentPageIndex: 0,
    currentPage: 0,
    pageDone: 0,
    pageTotal: 0,
    viewMode: "compare",
    lastPartialKey: "",
    currentJobId: "",
    previewVariant: "mono",
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
    AT.fillLangSelect(el.sourceLang);
    AT.fillLangSelect(el.targetLang);
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
    if (el.toolProgress) {
      el.toolProgress.hidden = true;
    }
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
    resetCompare();
    if (el.viewModes) {
      el.viewModes.hidden = true;
    }
    if (el.toolProgress) {
      el.toolProgress.hidden = true;
    }
    if (el.pageNav) {
      el.pageNav.hidden = true;
    }
    if (el.zoomNav) {
      el.zoomNav.hidden = true;
    }
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
      filename: AT.basename(state.srcUrl),
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
      throw new Error("本地翻译服务返回 HTTP " + response.status + "\n" + detail);
    }
    return response.json();
  }

  function resetCompare() {
    if (state.leftDoc) {
      try { state.leftDoc.destroy(); }
      catch (err) { /* ignore */ }
      state.leftDoc = null;
    }
    if (state.rightDoc) {
      try { state.rightDoc.destroy(); }
      catch (err) { /* ignore */ }
      state.rightDoc = null;
    }
    state.rightRendered = 0;
    state.rightSlots = [];
    state.leftSlots = [];
    state.rightCanvases = [];
    state.translatedIndices = [];
    state.currentPage = 0;
    state.pageDone = 0;
    state.pageTotal = 0;
    state.rows = [];
    state.currentPageIndex = 0;
    if (el.pageInput) {
      el.pageInput.value = "1";
    }
    if (el.pageTotal) {
      el.pageTotal.textContent = "/ 0";
    }
    el.compare.innerHTML = "";
    el.compare.hidden = true;
    el.compare.style.removeProperty("--page-w");
  }

  function computeFitWidth() {
    return Math.max(220, (el.compare.clientWidth - 24 - 12) / 2);
  }

  function pageWidth() {
    return Math.max(80, state.basePageW * state.zoom);
  }

  function applyPageWidth() {
    el.compare.style.setProperty("--page-w", pageWidth() + "px");
  }

  function makeCanvas() {
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    return canvas;
  }

  async function renderPageIntoCanvas(canvas, page, base, width) {
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / base.width) * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    return base.height / base.width;
  }

  async function renderDocPageInPlace(canvas, doc, n, width) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    return renderPageIntoCanvas(canvas, page, base, width);
  }

  function parseTranslatedIndices(total) {
    const raw = (state.pages || "").trim();
    const indices = [];
    if (!raw) {
      for (let i = 0; i < total; i++) {
        indices.push(i);
      }
      return indices;
    }
    raw.split(",").forEach(function (part) {
      const token = part.trim();
      if (token.indexOf("-") >= 0) {
        const bounds = token.split("-");
        const start = parseInt(bounds[0], 10);
        const end = parseInt(bounds[1], 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) {
            indices.push(i - 1);
          }
        }
      }
      else {
        const n = parseInt(token, 10);
        if (!isNaN(n)) {
          indices.push(n - 1);
        }
      }
    });
    return indices.filter(function (i) { return i >= 0 && i < total; });
  }

  function makePlaceholder(aspect, text, extraClass) {
    const div = document.createElement("div");
    div.className = "page-placeholder" + (extraClass ? " " + extraClass : "");
    div.style.aspectRatio = (1 / aspect).toString();
    div.textContent = text;
    return div;
  }

  async function buildCompare(data) {
    resetCompare();
    el.compare.hidden = false;
    setViewMode(state.viewMode);
    state.rows = [];
    state.basePageW = computeFitWidth();
    state.zoom = 1;
    state.lastDpr = window.devicePixelRatio || 1;
    applyPageWidth();
    const doc = await pdfjsLib.getDocument({ data: data }).promise;
    state.leftDoc = doc;
    const total = doc.numPages;
    state.translatedIndices = parseTranslatedIndices(total);
    const selected = {};
    state.translatedIndices.forEach(function (i) { selected[i] = true; });
    const width = pageWidth();
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const aspect = base.height / base.width;
      const row = document.createElement("div");
      row.className = "compare-row";
      const cellL = document.createElement("div");
      cellL.className = "compare-cell";
      const canvas = makeCanvas();
      cellL.appendChild(canvas);
      state.leftSlots[i] = canvas;
      const cellR = document.createElement("div");
      cellR.className = "compare-cell";
      if (selected[i - 1]) {
        const ph = makePlaceholder(aspect, "排队中…");
        cellR.appendChild(ph);
        state.rightSlots[i - 1] = ph;
      }
      else {
        cellR.appendChild(makePlaceholder(aspect, "未选择", "page-skip"));
        state.rightSlots[i - 1] = null;
      }
      row.appendChild(cellL);
      row.appendChild(cellR);
      el.compare.appendChild(row);
      state.rows.push(row);
      await renderPageIntoCanvas(canvas, page, base, width);
    }
    if (el.pageTotal) {
      el.pageTotal.textContent = "/ " + total;
    }
    updateZoomLabel();
    updateCurrentPage();
  }

  async function renderRightPages(data) {
    if (state.rightDoc) {
      try { state.rightDoc.destroy(); }
      catch (err) { /* ignore */ }
      state.rightDoc = null;
    }
    const doc = await pdfjsLib.getDocument({ data: data }).promise;
    state.rightDoc = doc;
    const width = pageWidth();
    for (let n = state.rightRendered + 1; n <= doc.numPages; n++) {
      const srcIndex = state.translatedIndices[n - 1];
      const slot = srcIndex === undefined ? null : state.rightSlots[srcIndex];
      const canvas = makeCanvas();
      await renderDocPageInPlace(canvas, doc, n, width);
      if (slot && slot.parentNode) {
        slot.replaceWith(canvas);
      }
      if (srcIndex !== undefined) {
        state.rightSlots[srcIndex] = canvas;
        state.rightCanvases[n] = canvas;
      }
    }
    state.rightRendered = doc.numPages;
  }

  function refreshPlaceholderLabels() {
    if (!state.rightSlots.length) {
      return;
    }
    const current = state.currentPage;
    const done = state.pageDone;
    const total = state.pageTotal;
    for (let idx = 0; idx < state.rightSlots.length; idx++) {
      const cell = state.rightSlots[idx];
      if (!cell || cell.tagName !== "DIV") {
        continue;
      }
      if (current && idx === current - 1) {
        if (!cell.classList.contains("page-active")) {
          cell.classList.add("page-active");
          cell.innerHTML = "";
          const label = document.createElement("div");
          label.className = "ph-label";
          label.textContent = "翻译中…";
          const bar = document.createElement("div");
          bar.className = "ph-bar";
          const fill = document.createElement("div");
          fill.className = "ph-fill";
          bar.appendChild(fill);
          cell.appendChild(label);
          cell.appendChild(bar);
        }
        const bar = cell.querySelector(".ph-bar");
        const fill = cell.querySelector(".ph-fill");
        if (total > 0) {
          bar.classList.remove("indeterminate");
          fill.style.width = Math.round(done * 100 / total) + "%";
        }
        else {
          bar.classList.add("indeterminate");
          fill.style.width = "";
        }
      }
      else {
        cell.classList.remove("page-active");
        cell.textContent = "排队中…";
      }
    }
  }

  async function refreshRight() {
    const jobId = state.currentJobId;
    if (!jobId) {
      return 0;
    }
    try {
      const response = await fetch(
        state.serverUrl + "/jobs/" + jobId + "/partial?variant=" +
        encodeURIComponent(state.previewVariant || "mono") + "&_=" + Date.now()
      );
      if (!response.ok) {
        return 0;
      }
      await renderRightPages(new Uint8Array(await response.arrayBuffer()));
      return state.rightRendered;
    }
    catch (err) {
      return 0;
    }
  }

  function setToolProgress(done, total) {
    if (!el.toolProgressFill) {
      return;
    }
    const pct = total > 0 ? Math.round(done * 100 / total) : 0;
    el.toolProgressFill.style.width = pct + "%";
  }

  function setViewMode(mode) {
    if (mode !== "source" && mode !== "target" && mode !== "compare") {
      mode = "compare";
    }
    state.viewMode = mode;
    el.compare.classList.remove("mode-source", "mode-target", "mode-compare");
    el.compare.classList.add("mode-" + mode);
    if (el.viewModes) {
      Array.prototype.forEach.call(el.viewModes.querySelectorAll("button"), function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
      });
    }
  }

  function updateZoomLabel() {
    if (el.zoomLevel) {
      el.zoomLevel.textContent = Math.round(state.zoom * 100) + "%";
    }
  }

  function updateCurrentPage() {
    if (!state.rows.length) {
      return;
    }
    const top = el.compare.scrollTop + 4;
    let idx = 0;
    for (let i = 0; i < state.rows.length; i++) {
      idx = i;
      if (state.rows[i].offsetTop + state.rows[i].offsetHeight > top) {
        break;
      }
    }
    state.currentPageIndex = idx;
    if (el.pageInput && document.activeElement !== el.pageInput) {
      el.pageInput.value = idx + 1;
    }
  }

  function goToPage(index) {
    if (!state.rows.length) {
      return;
    }
    const i = Math.max(0, Math.min(state.rows.length - 1, index));
    const row = state.rows[i];
    el.compare.scrollTop = Math.max(0, row.offsetTop - 12);
    state.currentPageIndex = i;
    if (el.pageInput) {
      el.pageInput.value = i + 1;
    }
  }

  function setZoom(z) {
    state.zoom = Math.max(0.4, Math.min(6, z));
    updateZoomLabel();
    applyScale();
  }

  function showSplit() {
    el.frame.hidden = true;
    el.statusPanel.hidden = true;
    el.compare.hidden = false;
    if (el.viewModes) {
      el.viewModes.hidden = false;
    }
    if (el.pageNav) {
      el.pageNav.hidden = false;
    }
    if (el.zoomNav) {
      el.zoomNav.hidden = false;
    }
  }

  async function prepareSplit() {
    showSplit();
    try {
      if (!state.leftDoc && state.sourceBlob) {
        await buildCompare(new Uint8Array(await state.sourceBlob.arrayBuffer()));
      }
    }
    catch (err) {
      // Ignore; translation can still complete.
    }
  }

  async function showPartial(jobId, job) {
    const key = job.done_pages + ":" + (job.total_pages || 0);
    if (state.lastPartialKey === key) {
      return;
    }
    state.lastPartialKey = key;
    state.currentJobId = jobId;
    state.previewVariant = "mono";
    try {
      const response = await fetch(
        state.serverUrl + "/jobs/" + jobId + "/partial?variant=mono&_=" + Date.now()
      );
      if (!response.ok) {
        return;
      }
      showSplit();
      await renderRightPages(new Uint8Array(await response.arrayBuffer()));
      el.docTitle.textContent = "翻译中 · 已翻译 " + job.done_pages +
        "/" + (job.total_pages || "?") + " 页";
    }
    catch (err) {
      // Ignore preview failures; the final result still arrives on completion.
    }
  }

  let scaleInFlight = false;
  async function applyScale() {
    if (scaleInFlight || el.compare.hidden || !state.leftDoc) {
      return;
    }
    scaleInFlight = true;
    try {
      applyPageWidth();
      const width = pageWidth();
      const leftDoc = state.leftDoc;
      for (let i = 1; i <= leftDoc.numPages; i++) {
        const canvas = state.leftSlots[i];
        if (canvas) {
          await renderDocPageInPlace(canvas, leftDoc, i, width);
        }
      }
      const rightDoc = state.rightDoc;
      if (rightDoc) {
        for (let n = 1; n <= state.rightRendered; n++) {
          const canvas = state.rightCanvases[n];
          if (canvas) {
            await renderDocPageInPlace(canvas, rightDoc, n, width);
          }
        }
      }
    }
    catch (err) {
      // ignore
    }
    finally {
      scaleInFlight = false;
    }
  }

  let scaleTimer = null;
  function scheduleScale() {
    if (el.compare.hidden) {
      return;
    }
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(runScale, 250);
  }
  async function runScale() {
    if (el.compare.hidden || !state.leftDoc) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== state.lastDpr) {
      // Browser zoom: keep the CSS-pixel page width (so it magnifies) and just
      // re-render the existing canvases at the new device resolution.
      state.lastDpr = dpr;
    }
    else {
      // Real window size change: refit the page width to the new pane width.
      state.basePageW = computeFitWidth();
    }
    await applyScale();
  }

  window.addEventListener("resize", scheduleScale);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleScale);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleScale).observe(el.compare);
  }
  function watchDevicePixelRatio() {
    if (!window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
    const onChange = function () {
      scheduleScale();
      watchDevicePixelRatio();
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
    }
    else if (mq.addListener) {
      mq.addListener(onChange);
    }
  }
  watchDevicePixelRatio();

  el.compare.addEventListener("wheel", function (event) {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    state.zoom = Math.max(0.4, Math.min(6, state.zoom * factor));
    updateZoomLabel();
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(applyScale, 80);
  }, { passive: false });

  let scrollRaf = 0;
  el.compare.addEventListener("scroll", function () {
    if (scrollRaf) {
      return;
    }
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      updateCurrentPage();
    });
  });

  async function pollJob(jobId) {
    while (!state.cancelled) {
      await delay(700);
      const response = await fetch(state.serverUrl + "/jobs/" + jobId);
      if (!response.ok) {
        throw new Error("查询任务状态失败：HTTP " + response.status);
      }
      const job = await response.json();
      state.currentPage = job.current_page || 0;
      state.pageDone = job.page_done || 0;
      state.pageTotal = job.page_total || 0;
      setToolProgress(job.done_pages || 0, job.total_pages || 0);
      if (!el.compare.hidden) {
        refreshPlaceholderLabels();
      }
      const previewing = typeof job.done_pages === "number" &&
        job.done_pages > 0 && job.status === "running";
      if (previewing) {
        await showPartial(jobId, job);
      }
      else if (job.message || job.log_tail) {
        const hasProgress = typeof job.progress === "number";
        const pct = hasProgress ? " · " + job.progress + "%" : "";
        if (!el.compare.hidden) {
          el.docTitle.textContent = "翻译中…" + pct + "  (" + job.elapsed + "s)";
        }
        else {
          setStatus("正在翻译…", (job.message || "") + "  (" + job.elapsed + "s)", {
            spinner: true,
            log: job.log_tail || "",
            progress: hasProgress ? job.progress : undefined
          });
        }
      }
      if (job.status === "done") {
        state.translatedName = job.result_name || "translated.pdf";
        return job;
      }
      if (job.status === "error") {
        throw new Error(job.error || "翻译失败");
      }
      if (job.status === "cancelled") {
        throw new Error("翻译已取消");
      }
    }
    throw new Error("翻译已取消");
  }

  async function fetchResult(jobId, variant) {
    let url = state.serverUrl + "/jobs/" + jobId + "/result";
    if (variant) {
      url += "?variant=" + encodeURIComponent(variant);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("下载译文失败：HTTP " + response.status);
    }
    return response.blob();
  }

  async function startTranslation() {
    if (state.running) {
      return;
    }
    const previousTitle = el.docTitle.textContent || "";
    state.cancelled = false;
    state.translatedBlob = null;
    state.translatedName = "";
    state.lastPartialKey = "";
    state.currentJobId = "";
    state.previewVariant = "mono";
    resetCompare();
    setRunning(true);
    if (el.toolProgress) {
      el.toolProgress.hidden = false;
    }
    setToolProgress(0, 0);
    el.frame.hidden = true;

    try {
      if (!state.sourceBlob) {
        setStatus("第 1/3 步", "正在下载源 PDF…", { spinner: true, log: null });
        state.sourceBlob = await fetchSource();
      }

      setStatus("第 2/3 步", "正在准备原文与上传…", { spinner: true, log: null });
      await prepareSplit();
      el.docTitle.textContent = "翻译中…";

      let job;
      try {
        job = await uploadJob(state.sourceBlob);
      }
      catch (err) {
        throw new Error(
          "无法连接本地翻译服务。\n请确认已启动 ArxivPdfTranslate 托盘程序（或 server/server.py）。\n\n" + err.message
        );
      }
      state.jobId = job.id;

      await pollJob(state.jobId);
      if (el.toolProgress) {
        el.toolProgress.hidden = true;
      }

      state.translatedBlob = await fetchResult(state.jobId, el.outputVariant.value);
      setRunning(false);
      if (state.rightRendered > 0) {
        if (state.translatedUrlObject) {
          URL.revokeObjectURL(state.translatedUrlObject);
        }
        state.translatedUrlObject = URL.createObjectURL(state.translatedBlob);
        el.saveBtn.hidden = false;
        el.openTabBtn.hidden = false;
        el.toggleSourceBtn.hidden = true;
      }
      else {
        // Engine fallback (no --partial-dir support): show the final PDF only.
        renderPdf(state.translatedBlob, "translated");
      }
      el.docTitle.textContent = previousTitle;
    }
    catch (err) {
      setRunning(false);
      const message = err && err.message ? err.message : String(err);
      showError(message, { showSettings: /无法连接|server\.py|托盘/.test(message) });
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

    if (el.viewModes) {
      Array.prototype.forEach.call(el.viewModes.querySelectorAll("button"), function (btn) {
        btn.addEventListener("click", function () {
          setViewMode(btn.getAttribute("data-mode"));
        });
      });
    }

    if (el.prevPage) {
      el.prevPage.addEventListener("click", function () {
        goToPage(state.currentPageIndex - 1);
      });
    }
    if (el.nextPage) {
      el.nextPage.addEventListener("click", function () {
        goToPage(state.currentPageIndex + 1);
      });
    }
    if (el.pageInput) {
      el.pageInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          const n = parseInt(el.pageInput.value, 10);
          if (!isNaN(n)) {
            goToPage(n - 1);
          }
          el.pageInput.blur();
        }
      });
      el.pageInput.addEventListener("blur", function () {
        el.pageInput.value = state.currentPageIndex + 1;
      });
    }
    if (el.zoomIn) {
      el.zoomIn.addEventListener("click", function () {
        setZoom(state.zoom * 1.15);
      });
    }
    if (el.zoomOut) {
      el.zoomOut.addEventListener("click", function () {
        setZoom(state.zoom / 1.15);
      });
    }

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
        url: AT.fileViewerUrl(target, state.translatedName || el.docTitle.textContent)
      });
    });

    el.outputVariant.addEventListener("change", async function () {
      if (!state.jobId || !state.translatedBlob) {
        return;
      }
      try {
        const variant = el.outputVariant.value;
        const blob = await fetchResult(state.jobId, variant);
        state.translatedBlob = blob;
        if (state.translatedUrlObject) {
          URL.revokeObjectURL(state.translatedUrlObject);
        }
        state.translatedUrlObject = URL.createObjectURL(blob);
        state.translatedName = (state.translatedName || "translated.pdf")
          .replace(/\.(dual|mono)\./, "." + variant + ".");
      }
      catch (err) {
        // keep the previous export on failure
      }
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

    state.settings = await AT.getSettings();
    state.serverUrl = AT.normalizeServer(state.settings.serverUrl);

    if (state.fileUrl) {
      state.readMode = true;
      state.sourceUrl = params.get("source") || "";
      const title = params.get("title") || AT.basename(state.fileUrl);
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

    const name = AT.basename(state.srcUrl);
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
