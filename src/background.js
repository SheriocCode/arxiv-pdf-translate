/* Arxiv PDF Translate - background service worker (MV3). */
importScripts("common.js");

const MENU_LINK = "pdf2zh-translate-link";
const MENU_PAGE = "pdf2zh-translate-page";
const BADGE_TEXT = "译";
const BADGE_COLOR = "#2563eb";

function ensureDefaults() {
  return PDF2ZH.getSettings().then(function (settings) {
    return PDF2ZH.saveSettings(settings);
  });
}

function rebuildMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: "Translate link with local pdf2zh",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pdf*", "*://arxiv.org/pdf/*"]
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: "Translate this PDF with local pdf2zh",
      contexts: ["page", "image"],
      documentUrlPatterns: ["*://*/*.pdf*", "*://arxiv.org/pdf/*"]
    });
  });
}

function setBadge(tabId, show) {
  if (tabId === undefined || tabId === null) {
    return;
  }
  chrome.action.setBadgeText({ tabId: tabId, text: show ? BADGE_TEXT : "" });
  if (show) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }
}

function consumeLastError() {
  void chrome.runtime.lastError; /* clears "unchecked lastError" warnings */
}

function updateBadge(tab) {
  if (!tab || tab.id === undefined || tab.id === null) {
    return;
  }
  const url = tab.url || "";
  PDF2ZH.getSettings().then(function (settings) {
    const show = !!settings.badgeOnPdf && PDF2ZH.isPdfUrl(url);
    setBadge(tab.id, show);
    chrome.action.setTitle({
      tabId: tab.id,
      title: show ? "用本地 pdf2zh 翻译此 PDF" : "Arxiv PDF Translate"
    });
  });
}

function refreshAllBadges() {
  chrome.tabs.query({}, function (tabs) {
    consumeLastError();
    (tabs || []).forEach(updateBadge);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  ensureDefaults().then(function () {
    rebuildMenus();
    refreshAllBadges();
  });
});

chrome.runtime.onStartup.addListener(function () {
  rebuildMenus();
  refreshAllBadges();
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    consumeLastError();
    updateBadge(tab);
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateBadge(tab);
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  setBadge(tabId, false);
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "sync" && changes.badgeOnPdf) {
    refreshAllBadges();
  }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  const url = info.linkUrl || (tab && tab.url) || "";
  if (url && PDF2ZH.isPdfUrl(url)) {
    PDF2ZH.openViewer(url, { auto: true });
  }
  else if (info.linkUrl) {
    PDF2ZH.openViewer(info.linkUrl, { auto: true });
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "openViewer" && message.url) {
    PDF2ZH.openViewer(message.url, message.options || { auto: true }).then(function (tab) {
      sendResponse({ ok: true, tabId: tab && tab.id });
    });
    return true;
  }

  if (message.type === "getActiveTabInfo") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      const url = (tab && tab.url) || "";
      sendResponse({
        url: url,
        isPdf: PDF2ZH.isPdfUrl(url),
        isArxiv: PDF2ZH.isArxivPdf(url)
      });
    });
    return true;
  }

  return false;
});
