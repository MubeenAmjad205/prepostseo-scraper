/**
 * Background Service Worker for Prepostseo Scraper (Manifest V3)
 * Provides background tab keep-alive, download delegation, and lifecycle management.
 */

// Keep-alive port listener to prevent background tab CPU throttling during active scrapes
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'pp-keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg?.type === 'ping') {
        port.postMessage({ type: 'pong', timestamp: Date.now() });
      }
    });
  }
});

// Handle download requests from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'pp:downloadCsv' && msg?.dataUrl && msg?.filename) {
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: msg.dataUrl,
        filename: msg.filename,
        saveAs: true
      }, (downloadId) => {
        sendResponse({ ok: !!downloadId, downloadId });
      });
      return true; // async response
    }
  }
  return false;
});

