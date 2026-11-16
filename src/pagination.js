/**
 * Pagination handling: next button discovery (text, icons, SVGs, numeric, URL params),
 * robust page signature generation, and smooth AJAX / full-page navigation.
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.Pagination = (() => {
  const { CONFIG, Extractors, Modal } = PPScraper;

  const NEXT_WORD_RE = /^(next|next page|siguiente|suivant|weiter|pr[oó]xima|avanti)\s*[›»>→]*$/i;
  const NEXT_SYM_RE = /^[›»>→]+$/;
  const PREV_RE = /\b(prev|previous|anterior|zurück|left)\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let navigating = false;
  window.addEventListener('beforeunload', () => { navigating = true; });

  const labelOf = (el) =>
    Extractors.clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '');

  const isNextLabel = (t) => NEXT_WORD_RE.test(t) || NEXT_SYM_RE.test(t);

  function isDisabled(el) {
    if (!el) return true;
    if (el.matches('[disabled], [aria-disabled="true"], .disabled')) return true;
    const parent = el.closest('li, .page-item');
    return !!parent && (parent.classList.contains('disabled') || parent.getAttribute('aria-disabled') === 'true');
  }

  const asClickable = (el) =>
    (el.matches('a, button, input') ? el : el.querySelector('a, button') || el);

  /**
   * Finds the "Next Page" button across modern and legacy pagination designs.
   */
  function findNextButton() {
    // 1. Standard rel="next" link
    const rel = [...document.querySelectorAll('a[rel~="next" i]')].find(Modal.isVisible);
    if (rel && !isDisabled(rel)) return rel;

    // 2. Look inside pagination containers
    const containers = [...document.querySelectorAll(
      '.pagination, ul.pager, nav[aria-label*="pagination" i], [class*="pagination" i], [id*="pagination" i]'
    )].filter(Modal.isVisible);

    for (const c of containers) {
      // 2a. Explicit text / aria-label Next
      const textNext = [...c.querySelectorAll('a, button, [role="button"], li')].find((x) => {
        const lbl = labelOf(x);
        if (PREV_RE.test(lbl) || PREV_RE.test(String(x.className || ''))) return false;
        return isNextLabel(lbl) || /(^|[\s_-])next([\s_-]|$)/i.test(String(x.className || ''));
      });
      if (textNext) {
        const clk = asClickable(textNext);
        if (!isDisabled(textNext) && !isDisabled(clk) && Modal.isVisible(clk)) return clk;
      }

      // 2b. Active page number followed by next page sibling (e.g. Page 2 after Page 1)
      const active = c.querySelector('li.active, .page-item.active, [aria-current="page"], a.active, .current');
      if (active) {
        let sib = (active.closest('li') || active).nextElementSibling;
        while (sib && !Modal.isVisible(sib)) sib = sib.nextElementSibling;
        if (sib && !isDisabled(sib)) {
          const clk = asClickable(sib);
          if (!isDisabled(clk) && !/^[.…\s]*$/.test(Extractors.clean(sib.textContent))) {
            return clk;
          }
        }
      }

      // 2c. Icon-based Next buttons (right arrows only, strictly excluding previous buttons)
      const iconCandidates = [...c.querySelectorAll(
        '.fa-angle-right, .fa-chevron-right, .fa-arrow-right, .bi-chevron-right, .bi-arrow-right'
      )].map((icon) => icon.closest('a, button, [role="button"]')).filter(Boolean);

      for (const btn of iconCandidates) {
        const lbl = labelOf(btn);
        if (!PREV_RE.test(lbl) && !PREV_RE.test(String(btn.className || '')) && Modal.isVisible(btn) && !isDisabled(btn)) {
          return btn;
        }
      }
    }

    // 3. Fallback: URL page parameter increment (?page=N+1)
    const currentUrl = new URL(location.href);
    const currentPageMatch = currentUrl.search.match(/[?&]page=(\d+)/i);
    if (currentPageMatch) {
      const nextPageNum = parseInt(currentPageMatch[1], 10) + 1;
      const paramNext = [...document.querySelectorAll(`a[href*="page=${nextPageNum}"]`)].find(
        (a) => Modal.isVisible(a) && !isDisabled(a) && !a.closest('.modal, [role="dialog"]')
      );
      if (paramNext) return paramNext;
    }

    // 4. Fallback: Any visible Next link outside dialogs
    const any = [...document.querySelectorAll('a, button, [role="button"]')].find((x) => {
      const lbl = labelOf(x);
      return Modal.isVisible(x) && isNextLabel(lbl) && !PREV_RE.test(lbl) && !x.closest('.modal, [role="dialog"]');
    });
    return any && !isDisabled(any) ? any : null;
  }

  /**
   * Generates a robust fingerprint of the current page.
   * Incorporates URL path + active page number + row count + boundary URLs
   * to ensure sticky header listings never cause false positive "same-page" halts.
   */
  function getPageSignature(buttons) {
    const activePage = document.querySelector('.pagination .active, [aria-current="page"]')?.textContent?.trim() || '';
    const totalCount = buttons?.length || 0;
    const lastRowUrl = buttons && buttons.length > 0 ?
      Extractors.urlKey(Extractors.extractRow(buttons[buttons.length - 1].closest('tr') || buttons[buttons.length - 1], buttons[buttons.length - 1]).url) : '';
    const firstRowUrl = buttons && buttons.length > 0 ?
      Extractors.urlKey(Extractors.extractRow(buttons[0].closest('tr') || buttons[0], buttons[0]).url) : '';

    return `url:${location.pathname + location.search}|p:${activePage}|count:${totalCount}|first:${firstRowUrl}|last:${lastRowUrl}`;
  }

  /**
   * Advances to the next page and waits for DOM update or navigation.
   */
  async function goNext(prevSig, auto, signal) {
    const nextBtn = findNextButton();
    if (!nextBtn) return 'none';

    // Persist auto-scrape state so the next page can resume smoothly
    await chrome.storage.local.set({
      [CONFIG.autoKey]: { ...auto, active: true, lastSig: prevSig, updatedAt: Date.now() }
    });

    nextBtn.click();
    const t0 = Date.now();

    while (Date.now() - t0 < 15000) {
      await sleep(100);
      if (signal?.isStopRequested()) return 'stopped';
      if (navigating) return 'navigating';

      const currentButtons = PPScraper.Engine?.findContactButtons() || [];
      if (currentButtons.length > 0 && getPageSignature(currentButtons) !== prevSig) {
        await sleep(200); // Allow DOM settle
        return 'changed';
      }
    }

    return navigating ? 'navigating' : 'stuck';
  }

  return {
    findNextButton,
    getPageSignature,
    goNext
  };
})();
