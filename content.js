/**
 * Prepostseo Directory Scraper - Content Script Entrypoint
 * Coordinates modular components (Config, Storage, Extractors, Modal, Pagination, Engine).
 */
(() => {
  if (window.__ppScraperLoaded) return;
  window.__ppScraperLoaded = true;

  const { Storage, Engine } = PPScraper;

  // Listen for control messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'pp:ping') {
      sendResponse({ ok: true, running: Engine.isRunning() });
    } else if (msg?.type === 'pp:start') {
      if (Engine.isRunning()) {
        sendResponse({ ok: false, error: 'Scraper is already running' });
      } else {
        const d = Number(msg.delay);
        Engine.scrape(Number.isFinite(d) ? Math.max(0, d) : 50, {
          auto: !!msg.auto,
          maxPages: Math.max(0, Number(msg.maxPages) || 0)
        });
        sendResponse({ ok: true });
      }
    } else if (msg?.type === 'pp:stop') {
      Engine.stop();
      sendResponse({ ok: true });
    } else if (msg?.type === 'pp:clear') {
      Engine.stop();
      Storage.clearMemory();
      sendResponse({ ok: true });
    }
    return false;
  });

  // Attempt auto-resume if recovering from a page navigation
  Engine.autoResume();
})();
