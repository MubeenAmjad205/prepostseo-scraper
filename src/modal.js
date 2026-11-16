/**
 * Modal interactions: fast opening, direct negative-pattern exit (<150ms),
 * scoped DOM polling, stop-signal responsiveness, and clean Bootstrap closing.
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.Modal = (() => {
  const { CONFIG, Extractors } = PPScraper;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' &&
      s.display !== 'none' && s.opacity !== '0';
  }

  function getVisibleModals() {
    return [...document.querySelectorAll(CONFIG.modalSelector)].filter(isVisible);
  }

  function getModalRoot(el) {
    return el.closest('.modal, [role="dialog"], .swal2-container, .mfp-wrap') || el;
  }

  function isLoading(root) {
    if (!root) return false;
    if ([...root.querySelectorAll(CONFIG.loadingSelectors)].some(isVisible)) return true;
    const t = Extractors.clean(root.innerText || '').toLowerCase();
    return /\b(loading|please wait|fetching|processing)\b/i.test(t.slice(0, 200));
  }

  /**
   * Opens the contact modal for a row, extracts the email,
   * handles "no contact info" instantly, and returns the result.
   */
  async function openAndReadEmail(btn, row, signal) {
    // 1. FAST PATH (0ms): Check if data is already embedded in the row/button
    const directEmail = Extractors.checkDirectData(row, btn);
    if (directEmail) {
      return { email: directEmail, modal: null, source: 'preloaded' };
    }

    // Check if the button is explicitly disabled
    if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true') {
      return { email: 'No Contact Info', modal: null, source: 'disabled-button' };
    }

    if (signal?.isStopRequested()) return { email: '', modal: null, stopped: true };

    const modalsBefore = new Set(getVisibleModals());
    btn.click();

    let modal = null;
    let email = '';
    let negativeReason = null;
    const startTime = Date.now();
    let limit = startTime + CONFIG.modalWaitMs;
    const hardLimit = startTime + CONFIG.loadingMaxMs;
    let lastDomChange = Date.now();

    // Fast-polling loop (checks stop signal on every single tick)
    while (Date.now() < limit) {
      if (signal?.isStopRequested()) {
        if (modal) await closeModal(modal);
        return { email: '', modal: null, stopped: true };
      }

      // 1. Detect newly opened modal
      if (!modal) {
        const found = getVisibleModals().find((m) => !modalsBefore.has(m));
        if (found) {
          modal = getModalRoot(found);
          lastDomChange = Date.now();
        }
      }

      if (modal && modal.isConnected) {
        // 2. INSTANT NEGATIVE CHECK (<150ms): "No contact info", "Login required", etc.
        negativeReason = Extractors.checkNegativeInfo(modal);
        if (negativeReason) {
          break; // Fast exit!
        }

        // 3. Scan for emails
        const emails = Extractors.extractEmails(modal);
        if (emails.length > 0) {
          email = Extractors.firstEmail(emails.join('; '));
          break; // Email found!
        }

        // 4. Loading check: only extend timeout if an active spinner is showing
        if (isLoading(modal)) {
          limit = Math.min(hardLimit, Date.now() + 600);
        } else {
          // If DOM settled with no spinners and no email, don't waste time
          if (Date.now() - lastDomChange > CONFIG.settleMs) {
            break;
          }
        }
      }

      await sleep(CONFIG.pollMs);
    }

    // Determine final result
    let finalEmail = '';
    if (email) {
      finalEmail = email;
    } else if (negativeReason) {
      finalEmail = negativeReason; // e.g. "No Contact Info", "Login Required"
    } else {
      // Final fallback scan on row itself
      const rowEmails = Extractors.extractEmails(row);
      if (rowEmails.length > 0) {
        finalEmail = Extractors.firstEmail(rowEmails.join('; '));
      } else {
        finalEmail = 'No Contact Info';
      }
    }

    return {
      email: finalEmail,
      modal,
      source: email ? 'modal' : (negativeReason ? 'negative-match' : 'timeout')
    };
  }

  /**
   * Closes a modal cleanly without breaking Bootstrap's internal state machine.
   */
  async function closeModal(modal) {
    if (!modal) return;
    const root = getModalRoot(modal);
    const gone = () => !isVisible(root) && !isVisible(modal);

    // 1. Try standard close buttons inside the modal
    let closeBtn = null;
    for (const sel of CONFIG.closeSelectors) {
      closeBtn = [...root.querySelectorAll(sel)].find(isVisible);
      if (closeBtn) break;
    }

    if (!closeBtn) {
      closeBtn = [...root.querySelectorAll('button, a, [role="button"]')].find(
        (b) => isVisible(b) && /^(close|×|x|cancel|ok|got it)$/i.test(Extractors.clean(b.textContent))
      );
    }

    if (closeBtn) {
      closeBtn.click();
      const closed = await waitForCondition(gone, CONFIG.closeWaitMs, 20);
      if (closed) return;
    }

    // 2. Dispatch Escape key
    for (const target of [document.activeElement, document.body, root].filter(Boolean)) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    }
    if (await waitForCondition(gone, 400, 20)) return;

    // 3. Click backdrop
    const backdrop = document.querySelector('.modal-backdrop, .swal2-container, .mfp-bg');
    if (backdrop) backdrop.click();
    if (root.classList.contains('modal')) root.click();
    if (await waitForCondition(gone, 400, 20)) return;

    // 4. Safe recovery fallback (without breaking styles permanently)
    root.classList.remove('show', 'in');
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }

  async function waitForCondition(fn, timeout, interval = 25) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (fn()) return true;
      await sleep(interval);
    }
    return !!fn();
  }

  return {
    isVisible,
    getVisibleModals,
    openAndReadEmail,
    closeModal
  };
})();
