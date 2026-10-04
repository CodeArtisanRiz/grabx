# GrabX

Extract complete design DNA from any website: CSS keyframes, WAAPI animations, transitions, design tokens, color palette, typography, responsive breakpoints, recursive DOM layout with computed styles, assets, and interaction states.

Two ways to use:
1. Chrome Extension (interactive browser capture with frame-0 reload support)
2. CLI Tool (headless Playwright automation for scripts and agents)

## Data Captured

Category | Details
--- | ---
Animations | CSS animations, WAAPI instances, and transitions with durations, delays, easing curves, iteration counts, and keyframe offsets.
Design Tokens | CSS custom properties defined on :root, html, and body with computed values.
Color Palette | Background colors, text colors, border colors, and accent colors grouped by role.
Typography | Loaded font faces via FontFace API, font families, weights, styles, and external stylesheet links.
DOM Structure | Recursive section-by-section component tree up to 4 levels deep with bounding boxes and semantic labels.
Computed Styles | 40 visual and layout CSS properties per structural node (display, flexbox, grid, spacing, borders, shadows, transforms).
Breakpoints | Media query conditions parsed from all accessible style sheets.
Stylesheet Rules | Declared keyframe blocks, transition properties, and pseudo-class rules (:hover, :focus, :active).
Assets | Image URLs with dimensions, inline SVG markup, and background image URLs.
Document Meta | Title, meta description, viewport, OpenGraph tags, favicon, preconnect URLs, and linked stylesheets.

## Method 1: Chrome Extension

### Installation

1. Download grabx-v2.0.0.zip from Releases or clone this repository.
2. Open Chrome and navigate to chrome://extensions.
3. Enable Developer mode via the top-right toggle.
4. Click "Load unpacked" and select the grabx directory containing manifest.json.

### Usage

1. Open the target website in Chrome.
2. Click the GrabX icon in the toolbar. The extension sets a green REC badge and reloads the tab to capture frame-0 entrance animations at document_start.
3. Scroll through the page and hover over interactive elements to trigger scroll and hover animations.
4. Click the floating GrabX button in the bottom-right corner.
5. The full site JSON is copied to the clipboard. If clipboard access is blocked, a modal appears with the raw JSON for manual copy.
6. Click the extension icon again to deactivate recording for that domain.

## Method 2: CLI (Playwright)

Headless automation tool to capture site DNA directly from terminal or inside CI/CD and AI agent workflows.

### Prerequisites

Node.js 18+ and npm.

```bash
npm install
npx playwright install chromium
```

### Usage

```bash
# Basic extraction to stdout
node extract.js https://example.com

# Save to JSON file
node extract.js https://lattice.com -o lattice.json

# Custom wait duration and viewport
node extract.js https://linear.app -o linear.json --wait 5000 --viewport 1920x1080

# Skip hover pass for faster extraction
node extract.js https://stripe.com -o stripe.json --no-hover
```

### CLI Options

Option | Description | Default
--- | --- | ---
-o, --out <file> | Output JSON file path | stdout
-w, --wait <ms> | Milliseconds to wait post-load for entrance animations | 3000
--scroll-speed <ms> | Pause between scroll steps in milliseconds | 150
--no-hover | Skip hovering interactive elements | false
--viewport <WxH> | Browser viewport dimension | 1440x900
-h, --help | Display help menu | 

## JSON Output Structure

```json
{
  "meta": {
    "tool": "GrabX CLI v2.0.0 (Playwright)",
    "domain": "lattice.com",
    "url": "https://lattice.com/",
    "title": "Lattice | The HR platform that people love",
    "exportedAt": "2026-10-04T21:20:50.511Z",
    "captureWindowMs": 70502,
    "viewport": {
      "width": 1440,
      "height": 900,
      "devicePixelRatio": 2
    },
    "totalAnimations": 335
  },
  "designTokens": {
    "cssVariables": [
      {
        "property": "--color-primary",
        "value": "#155EEF",
        "computed": "rgb(21, 94, 239)"
      }
    ],
    "colorPalette": {
      "backgrounds": ["rgb(255, 255, 255)", "rgb(15, 23, 42)"],
      "text": ["rgb(17, 24, 39)", "rgb(75, 85, 99)"],
      "borders": ["rgb(229, 231, 235)"],
      "accents": ["rgb(21, 94, 239)"]
    }
  },
  "fonts": {
    "faces": [
      {
        "family": "Matter",
        "weight": "400",
        "style": "normal",
        "status": "loaded"
      }
    ],
    "externalSheets": []
  },
  "sections": [
    {
      "label": "People + AI: Succeeding Together",
      "selector": "main > section:nth-child(2)",
      "tag": "section",
      "computedStyle": {
        "display": "flex",
        "flexDirection": "column",
        "padding": "96px 24px",
        "backgroundColor": "rgb(255, 255, 255)"
      },
      "tree": {
        "tag": "section",
        "children": []
      },
      "boundingBox": {
        "top": 720,
        "height": 640,
        "width": 1440
      }
    }
  ],
  "animations": [
    {
      "selector": "div.hero-badge",
      "elementId": 12,
      "name": "fadeUp",
      "type": "CSS Keyframe Animation",
      "duration": "600ms",
      "delay": "100ms",
      "easing": "cubic-bezier(0.16, 1, 0.3, 1)",
      "fill": "both",
      "iterations": 1,
      "direction": "normal",
      "keyframes": [
        { "offset": 0, "opacity": "0", "transform": "translateY(16px)" },
        { "offset": 1, "opacity": "1", "transform": "translateY(0px)" }
      ],
      "restingState": {
        "opacity": "1",
        "transform": "none",
        "visibility": "visible"
      },
      "viewportPosition": {
        "top": 240,
        "left": 120,
        "width": 200,
        "height": 36,
        "viewportHeight": 900,
        "triggerRatio": 0.267
      },
      "capturedAt": "420ms"
    }
  ],
  "stylesheetKeyframes": [
    {
      "name": "fadeUp",
      "cssText": "@keyframes fadeUp { 0% { opacity: 0; transform: translateY(16px); } 100% { opacity: 1; transform: translateY(0); } }"
    }
  ],
  "transitionRules": [],
  "interactionStates": [],
  "breakpoints": ["(max-width: 768px)", "(min-width: 1024px)"],
  "assets": {
    "images": [
      {
        "src": "https://lattice.com/images/hero.webp",
        "alt": "Platform Preview",
        "width": 1280,
        "height": 720,
        "selector": "img.hero-image"
      }
    ],
    "svgs": [],
    "backgroundImages": []
  },
  "headMeta": {
    "title": "Lattice | The HR platform that people love",
    "description": "Grow your people, teams, and business.",
    "viewport": "width=device-width, initial-scale=1",
    "favicon": "https://lattice.com/favicon.ico"
  }
}
```

## Rebuilding with AI Agents

When feeding GrabX exports to an AI agent (Claude, Antigravity, ChatGPT), specify the target stack and use case:

### Exact Visual Clone (React + Vite + TypeScript + GSAP)

```text
Here is the GrabX JSON export of [site]. Build a pixel-perfect replica in React + Vite + TypeScript.
- Use GSAP with ScrollTrigger for scroll-driven animations and transitions matching the export timing and easing.
- Map the designTokens and colorPalette to Tailwind CSS variables or standard CSS variables.
- Recreate the section layout using the sections hierarchy and computedStyle values.
- Load typography matching the fonts section.
- Use image and SVG placeholders with identical dimensions from the assets section.
```

### Style Matching / Design System Adaptation

```text
Here is the GrabX design DNA of [site]. Build a new [application type] adhering to this exact design system.
- Reuse the typography, spacing, color palette, and design tokens.
- Apply the same animation language and hover state transitions to my custom UI components.
```

## Technical Architecture

### Chrome Extension
- `manifest.json`: Manifest V3 configuration with storage and tabs permissions.
- `background.js`: Service worker handling domain state toggles, badge updates, and communication.
- `content.js`: Injected at `document_start` to intercept zero-frame initial animations, poll WAAPI instances, listen to capture events, scrape stylesheets, and render the Shadow DOM HUD.
- `styles.css`: Styles for the isolated HUD container.

### Playwright CLI
- `extract.js`: Automates browser lifecycle via `addInitScript` (frame-0 injection), smooth scroll sequencing, synthetic element hovering, and evaluation of extraction logic.

## Security & Limitations

- Cross-origin stylesheets without CORS headers cannot expose rule definitions via `cssRules` due to browser security restrictions.
- WebGL / Canvas animations cannot be converted to CSS/WAAPI rules.
- Closed Shadow DOM internals cannot be traversed by top-level query selectors.
- No network requests, telemetry, or external data transmission. All operations occur locally.

## License

MIT - Copyright (C) 2025 CodeArtisanRiz.
