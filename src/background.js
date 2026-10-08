/* Arxiv PDF Translate - background service worker (MV3). */
importScripts("common.js");

const MENU_LINK = "translate-link";
const MENU_PAGE = "translate-page";

function ensureDefaults() {
  return AT.getSettings().then(function (settings) {
    return AT.saveSettings(settings);
  });
}

function rebuildMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: "Translate link with the local engine",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pdf*", "*://arxiv.org/pdf/*"]
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: "Translate this PDF with the local engine",
      contexts: ["page", "image"],
      documentUrlPatterns: ["*://*/*.pdf*", "*://arxiv.org/pdf/*"]
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  ensureDefaults().then(rebuildMenus);
});

chrome.runtime.onStartup.addListener(function () {
  rebuildMenus();
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  const url = info.linkUrl || (tab && tab.url) || "";
  if (url && AT.isPdfUrl(url)) {
    AT.openViewer(url, { auto: true });
  }
  else if (info.linkUrl) {
    AT.openViewer(info.linkUrl, { auto: true });
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "openViewer" && message.url) {
    AT.openViewer(message.url, message.options || { auto: true }).then(function (tab) {
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
        isPdf: AT.isPdfUrl(url),
        isArxiv: AT.isArxivPdf(url)
      });
    });
    return true;
  }

  return false;
});
