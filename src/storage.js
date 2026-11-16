/**
 * Storage management: in-memory caching, coalesced non-blocking writes, and status updates.
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.Storage = (() => {
  const { CONFIG } = PPScraper;

  let records = [];
  let saveDirty = false;
  let savingPromise = null;
  let statusState = {};
  let lastStatusWrite = 0;

  async function loadRecords() {
    try {
      const d = await chrome.storage.local.get(CONFIG.recordsKey);
      records = d[CONFIG.recordsKey] || [];
      return records;
    } catch (e) {
      console.warn('[PP Scraper] Failed to load records', e);
      return [];
    }
  }

  function getRecords() {
    return records;
  }

  function setRecords(newRecords) {
    records = newRecords;
    queueSave();
  }

  function addRecord(record, index = -1) {
    if (index >= 0 && index < records.length) {
      records[index] = record;
    } else {
      records.push(record);
    }
    queueSave();
  }

  function queueSave() {
    saveDirty = true;
    if (savingPromise) return;

    savingPromise = (async () => {
      try {
        while (saveDirty) {
          saveDirty = false;
          await chrome.storage.local.set({ [CONFIG.recordsKey]: records });
        }
      } catch (e) {
        console.warn('[PP Scraper] Storage save failed', e);
      } finally {
        savingPromise = null;
      }
    })();
  }

  async function flush() {
    if (saveDirty && !savingPromise) queueSave();
    if (savingPromise) await savingPromise;
  }

  function clearMemory() {
    records = [];
    saveDirty = false;
    savingPromise = null;
  }

  async function clearAll() {
    clearMemory();
    await chrome.storage.local.remove([
      CONFIG.recordsKey,
      CONFIG.statusKey,
      CONFIG.debugKey,
      CONFIG.autoKey
    ]);
  }

  function setStatus(patch, force = false) {
    statusState = { ...statusState, ...patch, updatedAt: Date.now() };
    const now = Date.now();
    if (!force && now - lastStatusWrite < CONFIG.statusEveryMs) {
      return Promise.resolve();
    }
    lastStatusWrite = now;
    return chrome.storage.local.set({ [CONFIG.statusKey]: statusState }).catch(() => {});
  }

  async function getSettings() {
    try {
      const d = await chrome.storage.local.get(CONFIG.settingsKey);
      return d[CONFIG.settingsKey] || {};
    } catch {
      return {};
    }
  }

  return {
    loadRecords,
    getRecords,
    setRecords,
    addRecord,
    queueSave,
    flush,
    clearMemory,
    clearAll,
    setStatus,
    getSettings
  };
})();
