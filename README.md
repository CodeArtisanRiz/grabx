# GrabX

A Chrome Extension (Manifest V3) that extracts all UI animations, transitions,
easing curves, and CSS keyframes from any website — starting from frame 0
(initial page load). Built for developers and designers who want to clone or
study how a site animates.

---

## What it captures

- CSS keyframe animations (@keyframes rules from all accessible stylesheets)
- CSS transitions (transitionrun / transitionstart events)
- Web Animations API (WAAPI) animations — including GSAP and JS-driven motion
- Entrance animations from frame 0 (before any scripts run, on reload)
- Scroll-triggered and hover-triggered animations (captured as you browse)
- Duration, delay, easing, fill mode, iteration count, direction per animation
- Full keyframe steps with offset values

---

## How it works

GrabX is passive by default. It does not run on every site automatically.

1. You navigate to any site
2. You click the GrabX icon in the Chrome toolbar
3. The extension sets an active flag for that domain and reloads the tab
4. On reload, the content script runs at document_start — before the DOM
   renders and before any site scripts execute — to capture frame-0 entrance
   animations
5. It continues capturing as you scroll and hover for the lifetime of the tab
6. A floating HUD button appears at the bottom-right showing the live count
7. Click the HUD button to copy a clean JSON payload to your clipboard

---

## Installation (manual / unpacked)

GrabX is not on the Chrome Web Store. Load it as an unpacked extension:

1. Download or clone this repository to your local machine
2. Open Chrome and go to:  chrome://extensions
3. Enable Developer mode (toggle in the top-right corner)
4. Click "Load unpacked"
5. Select the grabx folder (the one containing manifest.json)
6. GrabX appears in your extensions list

To pin it to the toolbar: click the puzzle piece icon next to the address bar,
then click the pin icon next to GrabX.

---

## Usage

    Navigate to any website
    Click the GrabX icon in the toolbar
      → A green REC badge appears on the icon
      → The tab reloads to start capture from frame 0
    Wait a moment — the ⚡ GrabX (N) button appears bottom-right
    Browse normally — scroll, hover, interact with the page
    When ready, click the ⚡ GrabX (N) button
      → The full animation payload is copied to your clipboard as JSON

To deactivate recording for the domain: click the GrabX icon again. The REC
badge clears and the extension goes silent on that domain.

---

## Output format

The clipboard JSON has this shape:

    {
      "meta": {
        "domain": "example.com",
        "exportedAt": "2025-01-01T00:00:00.000Z",
        "captureWindowMs": 12000,
        "totalRecorded": 14
      },
      "animations": [
        {
          "selector": "div#hero.fade-in",
          "name": "fadeUp",
          "type": "CSS Keyframe Animation",
          "duration": "600ms",
          "delay": "0ms",
          "easing": "cubic-bezier(0.16, 1, 0.3, 1)",
          "fill": "both",
          "iterations": 1,
          "direction": "normal",
          "keyframes": [
            { "offset": 0, "opacity": "0", "transform": "translateY(20px)" },
            { "offset": 1, "opacity": "1", "transform": "translateY(0px)" }
          ],
          "capturedAt": "342ms"
        }
      ],
      "stylesheetKeyframes": [
        {
          "name": "fadeUp",
          "cssText": "@keyframes fadeUp { from { ... } to { ... } }"
        }
      ]
    }

---

## Capture details

Capture method       What it catches
---------------------------------------------------------------------------
document_start       Frame-0 entrance animations before any scripts run
Event listeners      animationstart, animationiteration, transitionrun,
                     transitionstart — all on capture phase
100ms polling        12-second window after load — catches GSAP, JS-driven,
                     deferred, and intersection-observer animations
Scroll listener      Scroll-triggered entrance animations
Mouseover listener   Hover-state transitions
Stylesheet scraper   All @keyframes rules in accessible stylesheets
                     (cross-origin sheets are skipped by browser security)

---

## Permissions

Permission       Why it is needed
--------------------------------------------------------------
storage          Store the active-domain flag between page loads
activeTab        Read the current tab's URL on icon click
tabs             Reload the tab after activating a domain
clipboardWrite   Write the JSON export to the clipboard

No data ever leaves your browser. Everything is local.

---

## File structure

    grabx/
    ├── manifest.json    MV3 manifest — permissions, content script config
    ├── background.js    Service worker — icon click handler, badge, reload
    ├── content.js       Capture logic — events, polling, HUD button
    └── styles.css       HUD button styling

---

## Known limitations

- Cross-origin stylesheets (loaded from a different domain, CDN, etc.) cannot
  be read due to browser CORS policy. Their @keyframes are not captured.
- GSAP animations that use JS-only tweens (not mapped to WAAPI) appear as
  WAAPI entries with limited keyframe data.
- The clipboard write requires a user gesture (clicking the HUD button). This
  is a browser security requirement and cannot be worked around.
- Sites that use Shadow DOM may have animations on elements not reachable by
  document.getAnimations() at the top level.

---

## License

MIT — Copyright (C) 2025 CodeArtisanRiz.
