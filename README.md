# GrabX

A Chrome Extension (Manifest V3) that extracts the complete design DNA from any
website — animations, design tokens, fonts, color palette, layout structure,
assets, and interaction states — starting from frame 0. Built so you can paste
the output into an AI agent (Claude, Antigravity, GPT) and get a pixel-perfect
clone or a style-matched rebuild with different content.

---

## What it captures

GrabX extracts 11 categories of data from any site:

    Category               What you get
    ─────────────────────  ──────────────────────────────────────────
    Animations             CSS keyframes, WAAPI, transitions with
                           full timing, easing, keyframe steps
    Design Tokens          All CSS custom properties from :root with
                           computed values
    Color Palette          Backgrounds, text, borders, accents — auto
                           grouped by role
    Fonts                  Every loaded font face with family, weight,
                           style, source URLs, plus Google Fonts links
    Section Layout         Recursive DOM tree (4 levels deep) with
                           computed styles per element, heading text,
                           semantic labels
    Computed Styles        Top 40 CSS properties per element —
                           layout, spacing, typography, colors, shadows
    Breakpoints            All @media query breakpoints from stylesheets
    Transition Rules       Declared CSS transitions that may not have
                           fired during capture
    Interaction States     :hover, :focus, :active rules from stylesheets
    Assets                 Images (src, alt, dimensions), inline SVGs,
                           background-image URLs
    Head Meta              Title, description, viewport, OG tags,
                           favicon, preconnects, stylesheet URLs

---

## How it works

GrabX is passive by default. It does not run on any site automatically.

    1. Navigate to any site
    2. Click the GrabX icon in the Chrome toolbar
       → green REC badge appears
       → tab reloads to capture from frame 0
    3. Content script runs at document_start — before DOM renders
       and before any site scripts execute
    4. 12-second polling window captures GSAP and JS-driven animations
    5. Scroll and hover listeners capture post-load animations
    6. The ⚡ GrabX (N) button appears bottom-right inside Shadow DOM
       (isolated from page CSS, can't be hidden or styled by the site)
    7. Click the button → full site DNA payload copied to clipboard
    8. Paste into your AI agent of choice

To stop recording: click the GrabX icon again. Badge clears, extension
goes silent on that domain.

---

## Installation

GrabX is not on the Chrome Web Store. Load as an unpacked extension:

    1. Download grabx-v2.0.0.zip from the Releases page
       (or clone this repo)
    2. Extract the zip
    3. Open Chrome → chrome://extensions
    4. Enable "Developer mode" (top-right toggle)
    5. Click "Load unpacked"
    6. Select the grabx folder (the one with manifest.json)

Pin it: click the puzzle-piece icon next to the address bar, then
pin GrabX.

---

## Output format

The clipboard JSON has this structure. Every section is designed to give
an AI agent enough context to clone the site or build a different app
with the same visual language.

    {
      "meta": {
        "tool": "GrabX v2.0.0",
        "domain": "example.com",
        "url": "https://example.com/",
        "title": "Example Site",
        "exportedAt": "2025-01-01T00:00:00.000Z",
        "captureWindowMs": 15000,
        "viewport": { "width": 1440, "height": 900, "devicePixelRatio": 2 },
        "totalAnimations": 14
      },

      "designTokens": {
        "cssVariables": [
          { "property": "--primary", "value": "#6366f1", "computed": "rgb(99, 102, 241)" },
          { "property": "--radius", "value": "0.5rem" },
          { "property": "--font-sans", "value": "Inter, system-ui, sans-serif" }
        ],
        "colorPalette": {
          "backgrounds": ["rgb(255, 255, 255)", "rgb(15, 23, 42)"],
          "text": ["rgb(15, 23, 42)", "rgb(148, 163, 184)"],
          "borders": ["rgb(226, 232, 240)"],
          "accents": ["rgb(99, 102, 241)", "rgb(16, 185, 129)"]
        }
      },

      "fonts": {
        "faces": [
          {
            "family": "Inter",
            "weight": "400",
            "style": "normal",
            "status": "loaded"
          }
        ],
        "externalSheets": [
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"
        ]
      },

      "sections": [
        {
          "label": "Header",
          "selector": "header",
          "tag": "header",
          "computedStyle": {
            "display": "flex",
            "justifyContent": "space-between",
            "padding": "16px 32px",
            "backgroundColor": "rgb(255, 255, 255)"
          },
          "tree": {
            "tag": "header",
            "children": [
              { "tag": "nav", "classes": ["main-nav"], "children": [...] },
              { "tag": "div", "classes": ["logo"], "children": [...] }
            ]
          },
          "boundingBox": { "top": 0, "height": 72, "width": 1440 }
        },
        {
          "label": "Transform your workflow",
          "selector": "section#hero",
          "tag": "section",
          "id": "hero",
          "computedStyle": {
            "display": "flex",
            "flexDirection": "column",
            "alignItems": "center",
            "gap": "24px",
            "padding": "96px 32px",
            "background": "linear-gradient(135deg, #0f172a, #1e1b4b)"
          },
          "tree": {
            "tag": "section",
            "id": "hero",
            "children": [
              {
                "tag": "h1",
                "textPreview": "Transform your workflow",
                "computedStyle": {
                  "fontSize": "64px",
                  "fontWeight": "700",
                  "lineHeight": "1.1",
                  "color": "rgb(255, 255, 255)",
                  "letterSpacing": "-0.02em"
                }
              },
              { "tag": "p", "textPreview": "The fastest way to...", "computedStyle": {...} },
              { "tag": "div", "classes": ["cta-group"], "children": [...] }
            ]
          },
          "boundingBox": { "top": 72, "height": 680, "width": 1440 }
        }
      ],

      "animations": [
        {
          "selector": "section#hero > h1",
          "elementId": 4,
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
          "restingState": { "opacity": "1", "transform": "none", "visibility": "visible" },
          "viewportPosition": {
            "top": 120,
            "left": 200,
            "width": 1040,
            "height": 76,
            "viewportHeight": 900,
            "triggerRatio": 0.133
          },
          "capturedAt": "342ms"
        }
      ],

      "stylesheetKeyframes": [
        {
          "name": "fadeUp",
          "cssText": "@keyframes fadeUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }"
        }
      ],

      "transitionRules": [
        {
          "selector": ".btn",
          "transition": "all 0.2s ease",
          "properties": "all",
          "duration": "0.2s",
          "easing": "ease",
          "delay": "0s"
        }
      ],

      "interactionStates": [
        {
          "selector": ".btn:hover",
          "cssText": ".btn:hover { background-color: #4f46e5; transform: translateY(-1px); }"
        },
        {
          "selector": "a:focus-visible",
          "cssText": "a:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }"
        }
      ],

      "breakpoints": [
        "(max-width: 640px)",
        "(max-width: 768px)",
        "(max-width: 1024px)",
        "(max-width: 1280px)"
      ],

      "assets": {
        "images": [
          { "src": "https://example.com/hero.webp", "alt": "Dashboard", "width": 1200, "height": 800 }
        ],
        "svgs": [
          { "selector": "header > nav > svg", "width": 32, "height": 32, "outerHTML": "<svg ...>...</svg>" }
        ],
        "backgroundImages": [
          { "selector": "section#hero", "url": "https://example.com/grain.png" }
        ]
      },

      "headMeta": {
        "title": "Example Site — Transform your workflow",
        "description": "The fastest way to build products.",
        "viewport": "width=device-width, initial-scale=1",
        "favicon": "https://example.com/favicon.ico",
        "ogImage": "https://example.com/og.png",
        "themeColor": "#0f172a",
        "preconnects": ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        "stylesheetUrls": ["https://example.com/styles.css"]
      }
    }

---

## How to use the export with AI agents

Paste the JSON into Claude, Antigravity, GPT, or any coding AI agent with
one of these prompts:

    Clone mode (exact replica):
    "Here is the full design DNA of [site]. Build me an exact visual
    replica as a React/Next.js app. Use the same fonts, colors, spacing,
    animations, and layout. Replace images with placeholders of the same
    dimensions."

    Style-match mode (different content):
    "Here is the design DNA of [site]. I'm building [my app] with
    different content. Use the same design system — fonts, color palette,
    spacing scale, animation style, and interaction patterns — but with
    my content: [describe your app]."

    Animation-only mode:
    "Here are the animations and transitions from [site]. Apply the same
    motion language to my existing app: entrance animations, hover states,
    scroll-triggered reveals, and easing curves."

---

## Capture methods

    Method               What it catches           When
    ───────────────────  ────────────────────────  ────────────────
    document_start       Frame-0 entrance anims    Before scripts run
    Event listeners      animationstart,           Real-time
                         transitionrun, etc.
                         (capture phase)
    100ms polling        GSAP, JS-driven,          First 12 seconds
                         deferred animations
    Scroll listener      Scroll-triggered           On scroll
                         entrance animations        (throttled 200ms)
    Mouseover listener   Hover-state transitions    On hover
                                                    (throttled 200ms)
    Stylesheet scraper   @keyframes, transitions,   At export time
                         :hover/:focus rules,       (+ early snapshot
                         @media breakpoints          at 3 seconds)
    Font API             Loaded font faces          At export time
    Computed styles      40 CSS properties per      At export time
                         structural element
    DOM walker           Section tree (4 levels)    At export time

---

## Permissions

    Permission    Why
    ──────────    ────────────────────────────────────────────────
    storage       Store the active-domain flag between page loads
    activeTab     Read the current tab's URL on icon click
    tabs          Reload the tab after activating, re-apply badge

No data ever leaves your browser. Everything is local. No analytics.
No network requests. No telemetry.

---

## File structure

    grabx/
    ├── manifest.json    MV3 manifest — permissions, content script config
    ├── background.js    Service worker — toggle, badge, message handler
    ├── content.js       Full extraction engine — 16 modules
    └── styles.css       HUD host isolation (button styles in Shadow DOM)

---

## Bugs fixed in v2.0.0 (from v1.0.0)

    - Selector collision: elements with same tag+classes no longer collide
      (now uses nth-child + DOM path + element ID)
    - SVG className: handles SVGAnimatedString correctly
    - Throttled scroll/hover: 200ms throttle prevents jank on heavy pages
    - Accurate animation types: CSSAnimation vs CSSTransition vs WAAPI
      properly distinguished
    - Shadow DOM HUD: button isolated from page CSS, can't be hidden
    - Clipboard fallback: shows modal with textarea if clipboard API fails
    - Nested @keyframes: scraper now recurses into @media/@layer/@supports
    - Background race condition: storage access serialized with lock
    - Badge flash: single source of truth in onUpdated, no set-before-reload
    - Removed dead clipboardWrite permission (MV2-only, does nothing in MV3)
    - Event target precision: animation events use e.target.getAnimations()
    - Early keyframe snapshot: captures stylesheet keyframes at 3s in case
      sheets are dynamically removed before export

---

## Known limitations

    - Cross-origin stylesheets cannot be read (browser CORS restriction).
      Their @keyframes, transitions, and :hover rules are not captured.
    - GSAP tweens that don't use WAAPI internally appear with limited
      keyframe data (start/end states only).
    - Shadow DOM components: animations inside closed Shadow DOM roots
      are not reachable by document.getAnimations().
    - Computed styles are captured at export time, not at animation start.
      If an element's style changes between capture and export, the
      resting state reflects the later value.
    - Maximum 20 inline SVGs captured to keep payload size reasonable.
    - Background images using CSS gradients are captured as the full
      gradient string, not as image URLs.

---

## Changelog

### v2.0.0

    - Full site DNA extraction: 11 data categories
    - Section-by-section DOM structure with recursive tree (4 levels)
    - Computed styles per element (40 CSS properties)
    - Font extraction (document.fonts API + external sheet detection)
    - Color palette extraction (grouped by role)
    - CSS custom property / design token extraction
    - Responsive breakpoint detection
    - Transition rule scraping from stylesheets
    - Interaction state capture (:hover, :focus, :active rules)
    - Asset inventory (images, SVGs, background-images)
    - Head meta extraction (OG, favicon, preconnects)
    - Scroll-trigger context (viewport position at capture time)
    - Shadow DOM HUD isolation
    - Clipboard fallback modal
    - 12 bug fixes from v1.0.0 code review
    - Background-to-content message channel

### v1.0.0

    - Initial release — animation-only capture

---

## License

MIT — Copyright (C) 2025 CodeArtisanRiz.
