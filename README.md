# Prepostseo Directory Scraper (Manifest V3 - Speed & Edge-Case Optimised)

High-performance, modular Manifest V3 Chrome Extension that extracts Category, Website URL, DA, PA, and contact emails (or explicit statuses like `No Contact Info`, `Login Required`) from the Prepostseo guest posting sites directory and exports to CSV.

## Key Improvements in v1.1.0

- **Modular Architecture**: Split the monolithic 760-line script into small, single-responsibility modules in `src/`.
- **Fast-Path Preloaded Data (0ms)**: Automatically checks row and button attributes for pre-existing emails before opening any modal.
- **Instant Negative Detection (<150ms)**: Fast regex matching for "No contact info", "Login required", "Web form only", and disabled buttons — eliminating the 15.4-second hang on rows without emails.
- **Slashed Timeouts**: Reduced wait times from 15+ seconds down to under 1.2s max, and eliminated the redundant 9-second retry loop.
- **Safe Bootstrap Modal Management**: Prevents modal state desynchronization and backdrop deadlocks.
- **Stop-Signal Responsiveness**: "Stop" button immediately interrupts active modal polling.
- **Hardened Multi-Page Pagination**: Supports icon-only buttons (FontAwesome, SVGs), numeric active pages, and robust multi-factor page signatures that prevent early termination.
- **Data Protection**: Fixed the "Clear data" race condition so running content scripts cannot resurrect deleted data.

## Project Structure

```
├── manifest.json         # Manifest V3 extension configuration
├── popup.html            # Extension popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup controller, UI events, and CSV export
├── content.js            # Content script entrypoint and messaging router
├── src/
│   ├── config.js         # Centralized configuration, timeouts, and negative regexes
│   ├── storage.js        # Storage queue, caching, and atomic status updates
│   ├── extractors.js     # Row, URL, and email parsing + negative detectors
│   ├── modal.js          # Modal interaction, scoped polling, and clean closing
│   ├── pagination.js     # Robust next-button detection and page fingerprinting
│   └── engine.js         # Core scraping orchestrator loop and auto-resume
└── docs/
    └── SCRAPER_AUDIT_AND_PLAN.md  # Detailed audit, edge-case matrix, and plan
```

## Install

1. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select this directory.
3. Pin the extension to your toolbar.

## Use

1. Open the [Prepostseo Guest Posting Directory](https://www.prepostseo.com/guest-posting-sites) and let the table load.
2. Click the extension icon and press **Start Scraping**.
3. With **Auto-scrape all pages** enabled, the scraper works through pages sequentially, auto-advancing and appending records to `chrome.storage.local`.
4. Click **Export CSV** to download the clean data (`Category, Website URL, DA, PA, Email / Status`).
