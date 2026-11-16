/**
 * Data extraction utilities: row parsing, URL extraction, email decoding,
 * and instant negative pattern detection (No Contact Info / Login Required).
 */
var PPScraper = window.PPScraper = window.PPScraper || {};

PPScraper.Extractors = (() => {
  const { CONFIG } = PPScraper;

  const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}/gi;
  const OWN_DOMAIN_RE = /@([a-z0-9-]+\.)*prepostseo\.com$/i;
  const PLACEHOLDER_RE = /@(example|domain|email|yourdomain|yoursite|test)\.(com|org|net)$/i;
  const JUNK_RE = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i;
  const SKIP_ATTRS = new Set(['class', 'style', 'placeholder', 'pattern', 'src']);

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const num = (s) => {
    const m = clean(s).match(/\d+(\.\d+)?/);
    return m ? m[0] : '';
  };

  const urlKey = (u) =>
    (u || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');

  const firstEmail = (s) =>
    (String(s || '').split(/[;,\s]+/).find((e) => e.includes('@')) || '').toLowerCase();

  const normText = (t) =>
    (t || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ');

  function deobfuscate(t) {
    return normText(t)
      .replace(/[\uff20\ufe6b]/g, '@')
      .replace(/\s*[\[\(\{<]\s*(?:at|@)\s*[\]\)\}>]\s*/gi, '@')
      .replace(/\s*[\[\(\{<]\s*dot\s*[\]\)\}>]\s*/gi, '.')
      .replace(/\b([a-z0-9._%+\-]+)\s+at\s+((?:[a-z0-9\-]+\s+dot\s+)+[a-z]{2,})\b/gi,
        (m, u, d) => u + '@' + d.replace(/\s+dot\s+/gi, '.'))
      .replace(/([a-z0-9._%+\-]+)\s+@\s+([a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,})/gi, '$1@$2');
  }

  function decodeEntities(s) {
    if (!s || s.indexOf('&') === -1) return s || '';
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  function decodeCf(hex) {
    if (!hex) return '';
    try {
      const key = parseInt(hex.slice(0, 2), 16);
      let out = '';
      for (let i = 2; i < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
      }
      return out;
    } catch {
      return '';
    }
  }

  /**
   * Fast-fail negative detection: checks if the element contains explicit
   * statements that contact details are unavailable or behind a login wall.
   * Runs in < 10ms.
   */
  function checkNegativeInfo(rootNode) {
    if (!rootNode) return null;
    const text = clean(rootNode.innerText || rootNode.textContent || '');
    if (!text) return null;

    for (const item of CONFIG.negativePatterns) {
      if (item.regex.test(text)) {
        return item.reason;
      }
    }
    return null;
  }

  /**
   * Extracts emails from anywhere in a DOM subtree: mailto links, CF tokens,
   * attributes, input fields, and deobfuscated text.
   */
  function extractEmails(root) {
    if (!root) return [];
    const found = new Set();

    const add = (e) => {
      e = (e || '').trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return;
      if (JUNK_RE.test(e) || OWN_DOMAIN_RE.test(e) || PLACEHOLDER_RE.test(e)) return;
      found.add(e);
    };

    const fromString = (s) => {
      if (!s || s.length > 20000) return;
      (deobfuscate(s).match(EMAIL_RE) || []).forEach(add);
    };

    const fromAttr = (v) => {
      if (!v || v.length > 2000) return;
      fromString(decodeEntities(v));
      if (v.indexOf('%') !== -1) {
        try { fromString(decodeURIComponent(v)); } catch { /* ignore */ }
      }
      if (/^[A-Za-z0-9+/=]{12,}$/.test(v)) {
        try { fromString(atob(v)); } catch { /* ignore */ }
      }
    };

    // 1. Scan mailto links
    root.querySelectorAll?.('a[href^="mailto:" i]').forEach((a) => fromAttr(a.getAttribute('href')));

    // 2. Scan Cloudflare protected emails
    root.querySelectorAll?.('[data-cfemail]').forEach((el) => add(decodeCf(el.getAttribute('data-cfemail'))));

    // 3. Scan inputs and text
    const elements = [root, ...(root.querySelectorAll?.('*') || [])];
    for (const el of elements) {
      if (el.attributes) {
        for (const a of el.attributes) {
          if (!SKIP_ATTRS.has(a.name)) fromAttr(a.value);
        }
      }
      if (el.matches?.('input, textarea, select')) {
        fromString(el.value);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      fromString(n.nodeValue);
    }

    if (!found.size && root.innerText) {
      fromString(root.innerText);
    }

    return [...found];
  }

  /**
   * Fast-path check: inspects if the row or button already carries
   * an email or contact info in data-* attributes or embedded links.
   * Runs in 0ms (no modal click needed!).
   */
  function checkDirectData(row, btn) {
    if (!row && !btn) return null;

    // Check data attributes
    const targets = [btn, row].filter(Boolean);
    for (const target of targets) {
      const email = target.dataset?.email ||
                    target.dataset?.contact ||
                    target.getAttribute?.('data-email') ||
                    target.getAttribute?.('data-contact');
      if (email && email.includes('@')) {
        return firstEmail(email);
      }
      const cf = target.getAttribute?.('data-cfemail') || target.querySelector?.('[data-cfemail]');
      if (cf) {
        const decoded = decodeCf(cf.getAttribute?.('data-cfemail') || cf);
        if (decoded && decoded.includes('@')) return firstEmail(decoded);
      }
    }

    // Check for an existing mailto inside the row
    const mailto = row?.querySelector?.('a[href^="mailto:" i]');
    if (mailto) {
      const email = (mailto.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0];
      if (email && email.includes('@')) return firstEmail(email);
    }

    return null;
  }

  // Header and Row extraction
  const headerCache = new WeakMap();

  function buildHeaderMap(row) {
    const table = row.closest('table');
    const map = {};
    if (!table) return map;
    if (headerCache.has(table)) return headerCache.get(table);

    let heads = [...table.querySelectorAll('thead th, thead td')];
    if (!heads.length) heads = [...(table.querySelector('tr')?.children || [])];

    heads.forEach((h, i) => {
      const t = clean(h.textContent).toLowerCase();
      if (/categor|niche|topic/.test(t)) map.category ??= i;
      else if (/page\s*auth|^pa\b/.test(t)) map.pa ??= i;
      else if (/domain\s*auth|^da\b/.test(t)) map.da ??= i;
      else if (/website|url|site|domain|link/.test(t)) map.url ??= i;
    });

    headerCache.set(table, map);
    return map;
  }

  function resolveTargetUrl(href) {
    if (!href) return '';
    try {
      const parsed = new URL(href, location.href);
      for (const param of ['url', 'target', 'dest', 'u', 'link', 'to', 'redirect']) {
        const val = parsed.searchParams.get(param);
        if (val) {
          if (/^https?:\/\//i.test(val)) return val;
          if (/\.[a-z]{2,}/i.test(val)) return 'https://' + val.replace(/^\/+/, '');
        }
      }
      return parsed.href;
    } catch {
      return href;
    }
  }

  function extractUrl(cell, row, contactBtn) {
    const pick = (scope) => {
      if (!scope) return '';
      const links = [...scope.querySelectorAll('a[href]')].filter((a) => {
        if (a === contactBtn || contactBtn?.contains(a) || a.contains(contactBtn)) return false;
        const h = a.getAttribute('href') || '';
        if (/^(javascript:|#|mailto:)/i.test(h)) return false;
        return true;
      });
      if (!links.length) return '';

      // Prefer resolved outbound links
      for (const a of links) {
        const resolved = resolveTargetUrl(a.href);
        try {
          if (new URL(resolved).hostname !== location.hostname) {
            return resolved;
          }
        } catch { /* ignore */ }
      }
      return resolveTargetUrl(links[0].href);
    };

    if (cell) {
      const href = pick(cell);
      if (href) return href;
      const t = clean(cell.textContent);
      if (t) return t;
    }

    const href = pick(row);
    if (href) return href;

    const m = clean(row?.textContent || '').match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/i);
    return m ? m[0] : '';
  }

  function extractRow(row, contactBtn) {
    const cells = row.matches('tr') ? [...row.children] : [];
    const map = buildHeaderMap(row);
    const cell = (k) => (map[k] != null ? cells[map[k]] : null);

    let category = cell('category') ? clean(cell('category').textContent) : '';
    let da = cell('da') ? num(cell('da').textContent) : '';
    let pa = cell('pa') ? num(cell('pa').textContent) : '';

    if ((!da || !pa) && cells.length) {
      const numeric = cells
        .filter((c) => /^\d+(\.\d+)?$/.test(clean(c.textContent)) && (!contactBtn || !c.contains(contactBtn)))
        .map((c) => clean(c.textContent));
      if (!da) da = numeric[0] || '';
      if (!pa) pa = numeric[1] || '';
    }

    if (!category && cells.length) {
      const c = cells.find((c) => {
        const t = clean(c.textContent);
        return t && !/^\d+(\.\d+)?$/.test(t) && !c.querySelector('a, button') && (!contactBtn || !c.contains(contactBtn));
      });
      if (c) category = clean(c.textContent);
    }

    const url = extractUrl(cell('url'), row, contactBtn);
    return { category, url, da, pa };
  }

  return {
    clean,
    num,
    urlKey,
    firstEmail,
    decodeCf,
    checkNegativeInfo,
    extractEmails,
    checkDirectData,
    buildHeaderMap,
    extractUrl,
    extractRow
  };
})();
