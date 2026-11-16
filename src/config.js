/**
 * Configuration and constants for the Prepostseo Scraper.
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.CONFIG = {
  // Storage keys
  recordsKey: 'ppRecords',
  statusKey: 'ppStatus',
  debugKey: 'ppDebug',
  autoKey: 'ppAuto',
  settingsKey: 'ppSettings',

  // Fast, production-tuned timeouts (slashed from 15+ seconds down to under 1.5s max)
  modalWaitMs: 1200,      // Max wait for modal to appear & email to render
  settleMs: 400,          // DOM quiet period before giving up on an open modal
  loadingMaxMs: 1500,     // Max wait if a spinner / "Loading…" is showing
  closeWaitMs: 800,       // Max wait for modal to close
  pollMs: 30,             // Polling interval while waiting for DOM changes
  statusEveryMs: 250,     // Throttle interval for progress writes to storage

  // Pagination safety
  maxPagesHard: 1000,

  // Modal detection selectors
  modalSelector: [
    '.modal.show', '.modal.in', '.modal[style*="display: block"]',
    '[role="dialog"]', '[aria-modal="true"]',
    '.swal2-popup', '.swal-modal', '.ReactModal__Content',
    '.mfp-content', '.fancybox-content', '.remodal-is-opened', '.modal-dialog'
  ].join(','),

  // Modal close selectors
  closeSelectors: [
    '[data-dismiss="modal"]', '[data-bs-dismiss="modal"]', '.btn-close',
    'button.close', '.modal-close', '.close', '.swal2-close',
    '.mfp-close', '.fancybox-close-small', '.swal2-confirm'
  ],

  // Loading/spinner selectors
  loadingSelectors: [
    '.spinner-border', '.spinner-grow', '.spinner', '.loader',
    '.loading', '[class*="spin"]', '[role="progressbar"]', 'progress'
  ].join(','),

  // Negative patterns for fast-fail (< 150ms) detection of rows without contact info
  negativePatterns: [
    { regex: /\b(no\s+(?:contact|email|address|info)|not\s+available|n\/a|none\s+provided)\b/i, reason: 'No Contact Info' },
    { regex: /\b(log\s*in\s+to\s+view|sign\s*in\s+to\s+view|registered\s+users\s+only|members\s+only|subscribe\s+to\s+view)\b/i, reason: 'Login Required' },
    { regex: /\b(contact\s+via\s+web\s*form|contact\s+form\s+only|fill\s+out\s+(?:the\s+)?form)\b/i, reason: 'Web Form Only' },
    { regex: /\b(site\s+closed|domain\s+for\s+sale|website\s+inactive)\b/i, reason: 'Inactive Site' }
  ],

  // Non-destructive transition accelerator
  fastCss: [
    '.modal.fade { transition: opacity 0.05s linear !important; }',
    '.modal-backdrop.fade { transition: opacity 0.05s linear !important; }',
    '.swal2-container { transition: none !important; animation: none !important; }'
  ].join('\n')
};
