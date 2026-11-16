/**
 * Main scraping engine orchestrator: row loops, duplicate avoidance,
 * edge case handling, progress updates, and page transitions.
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.Engine = (() => {
  const { CONFIG, Storage, Extractors, Modal, Pagination } = PPScraper;

  let running = false;
  let stopRequested = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const signal = {
    isStopRequested: () => stopRequested
  };

  function rowOf(el) {
    return el.closest('tr, [role="row"]') ||
      el.closest('li, article, [class*="row"], [class*="item"], [class*="card"]');
  }

  function findContactButtons() {
    const cands = [...document.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], [role="button"], .btn'
    )].filter((el) => {
      const t = Extractors.clean(el.tagName === 'INPUT' ? el.value : el.textContent).toLowerCase();
      if (!t || t.length > 24 || !/^contact\b/.test(t)) return false;
      if (el.closest('.modal, [role="dialog"], nav, header, footer')) return false;
      return !!rowOf(el);
    });
    return cands.filter((el) => !cands.some((o) => o !== el && o.contains(el)));
  }

  async function scrape(delayMs, opts = {}) {
    if (running) return;
    running = true;
    stopRequested = false;

    const autoMode = !!opts.auto;
    const resume = opts.resume || null;
    const t0 = Date.now();

    const auto = {
      active: true,
      delay: delayMs,
      maxPages: opts.maxPages || 0,
      pages: resume?.pages || 0,
      stats: resume?.stats || { added: 0, updated: 0, skipped: 0, noEmail: 0 },
      startedAt: resume?.startedAt || t0,
      lastSig: resume?.lastSig || '',
      visitedSignatures: resume?.visitedSignatures || []
    };
    const stats = auto.stats;
    const visitedSignatures = new Set(auto.visitedSignatures);

    // Keep-alive port to prevent Chrome timer throttling in background tabs
    let keepAlivePort = null;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'pp-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => { keepAlivePort = null; });
    } catch { /* ignore */ }

    // Inject fast non-breaking CSS helper
    let style = document.getElementById('pp-fast-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pp-fast-css';
      style.textContent = CONFIG.fastCss;
      document.documentElement.appendChild(style);
    }

    let endReason = 'done';
    let leaving = false;

    try {
      const records = await Storage.loadRecords();
      const index = new Map();
      records.forEach((r, i) => {
        const k = Extractors.urlKey(r.url);
        if (k) index.set(k, i);
      });

      for (;;) {
        let buttons = findContactButtons();
        const total = buttons.length;
        if (!total) {
          endReason = autoMode && auto.pages > 0 ? 'empty-page' : 'no-rows';
          break;
        }

        const sig = Pagination.getPageSignature(buttons);
        if (autoMode && (visitedSignatures.has(sig) || (auto.lastSig && sig === auto.lastSig))) {
          endReason = 'same-page';
          break;
        }
        visitedSignatures.add(sig);
        auto.visitedSignatures = [...visitedSignatures];

        const pageLabel = autoMode ? `Page ${auto.pages + 1} - ` : '';
        await Storage.setStatus({
          running: true,
          kind: 'info',
          done: 0,
          total,
          message: `${pageLabel}${total} sites found…`
        }, true);

        for (let i = 0; i < total; i++) {
          if (stopRequested) break;

          let btn = buttons[i];
          if (!btn || !btn.isConnected) {
            buttons = findContactButtons();
            btn = buttons[i];
          }
          if (!btn) break;

          const row = rowOf(btn);
          const base = Extractors.extractRow(row, btn);
          const key = Extractors.urlKey(base.url);
          const existingIdx = key && index.has(key) ? index.get(key) : -1;

          // Skip if already stored with a verified email
          if (existingIdx !== -1 && records[existingIdx]?.email && records[existingIdx]?.email.includes('@')) {
            stats.skipped++;
          } else {
            let emailResult = '';
            let modalToClose = null;

            try {
              const res = await Modal.openAndReadEmail(btn, row, signal);
              emailResult = res.email;
              modalToClose = res.modal;
            } catch (err) {
              console.warn('[PP Scraper] Modal error on row', i, err);
              emailResult = 'No Contact Info';
            } finally {
              if (modalToClose) {
                try {
                  await Modal.closeModal(modalToClose);
                } catch (closeErr) {
                  console.warn('[PP Scraper] Close error', closeErr);
                }
              }
            }

            if (signal.isStopRequested()) break;

            if (!emailResult || !emailResult.includes('@')) {
              stats.noEmail++;
            }

            const record = {
              category: base.category,
              url: base.url,
              da: base.da,
              pa: base.pa,
              email: emailResult || 'No Contact Info'
            };

            if (existingIdx !== -1) {
              Storage.addRecord(record, existingIdx);
              stats.updated++;
            } else {
              Storage.addRecord(record);
              if (key) index.set(key, Storage.getRecords().length - 1);
              stats.added++;
            }
          }

          Storage.setStatus({
            running: true,
            kind: 'info',
            done: i + 1,
            total,
            message: `${pageLabel}row ${i + 1}/${total} - saved ${stats.added}, skipped ${stats.skipped}, no email ${stats.noEmail}`
          });

          if (delayMs > 0) {
            await sleep(delayMs);
          }
        }

        auto.pages++;
        if (stopRequested) {
          endReason = 'stopped';
          break;
        }

        if (!autoMode) break;
        if (auto.maxPages && auto.pages >= auto.maxPages) {
          endReason = 'max-pages';
          break;
        }
        if (auto.pages >= CONFIG.maxPagesHard) {
          endReason = 'max-pages';
          break;
        }

        await Storage.flush();
        await Storage.setStatus({
          running: true,
          kind: 'info',
          done: total,
          total,
          message: `Page ${auto.pages} done (${stats.added} saved). Loading next page…`
        }, true);

        const res = await Pagination.goNext(sig, auto, signal);
        if (res === 'changed') {
          auto.lastSig = sig;
          continue; // In-page AJAX update
        }
        if (res === 'navigating') {
          leaving = true;
          break; // Full-page load
        }

        endReason = res === 'none' ? 'done' : res;
        break;
      }

      await Storage.flush();
      if (leaving) return;

      const secs = Math.round((Date.now() - auto.startedAt) / 1000);
      const summary = `${auto.pages} page(s) in ${secs}s: ${stats.added} saved, ${stats.skipped} duplicates skipped, ${stats.noEmail} without email.`;

      const finalStatus =
        endReason === 'no-rows' ? { kind: 'error', message: 'No "Contact" buttons found. Ensure the directory table is loaded.' } :
        endReason === 'stopped' ? { kind: 'info', message: `Stopped: ${summary}` } :
        endReason === 'stuck' ? { kind: 'error', message: `Next page failed to load. ${summary}` } :
        endReason === 'max-pages' ? { kind: 'ok', message: `Reached page limit. ${summary}` } :
        endReason === 'same-page' ? { kind: 'ok', message: `All pages finished. ${summary}` } :
        { kind: 'ok', message: `Done: ${summary}` };

      await chrome.storage.local.set({ [CONFIG.autoKey]: { active: false, finishedAt: Date.now() } });
      await Storage.setStatus({ running: false, ...finalStatus }, true);

    } catch (e) {
      console.error('[PP Scraper] Fatal error', e);
      await Storage.flush().catch(() => {});
      await chrome.storage.local.set({ [CONFIG.autoKey]: { active: false } }).catch(() => {});
      await Storage.setStatus({ running: false, kind: 'error', message: 'Error: ' + (e?.message || e) }, true);
    } finally {
      if (keepAlivePort) {
        try { keepAlivePort.disconnect(); } catch { /* ignore */ }
        keepAlivePort = null;
      }
      if (style && style.parentNode) style.remove();
      running = false;
    }
  }

  function stop() {
    stopRequested = true;
    chrome.storage.local.set({ [CONFIG.autoKey]: { active: false } }).catch(() => {});
  }

  function isRunning() {
    return running;
  }

  // Resume scraper after a full-page navigation
  async function autoResume() {
    try {
      const d = (await chrome.storage.local.get(CONFIG.autoKey))[CONFIG.autoKey];
      if (!d || !d.active || Date.now() - (d.updatedAt || 0) > 60000) return;

      let last = -1, stableSince = Date.now();
      const end = Date.now() + 20000;

      while (Date.now() < end) {
        const count = findContactButtons().length;
        if (count !== last) {
          last = count;
          stableSince = Date.now();
        } else if (count > 0 && Date.now() - stableSince > 300) {
          break;
        }
        await sleep(150);
      }

      if (findContactButtons().length === 0) {
        await chrome.storage.local.set({ [CONFIG.autoKey]: { active: false } });
        await Storage.setStatus({
          running: false,
          kind: 'ok',
          message: `Stopped: No more rows on next page (${d.pages || 0} page(s) done).`
        }, true);
        return;
      }

      scrape(d.delay || 50, { auto: true, maxPages: d.maxPages || 0, resume: d });
    } catch (e) {
      console.warn('[PP Scraper] Auto-resume failed', e);
    }
  }

  return {
    findContactButtons,
    scrape,
    stop,
    isRunning,
    autoResume
  };
})();
