#!/usr/bin/env node
// GrabX CLI — Playwright-based site DNA extractor
// Usage: node extract.js <url> [options]
//
// Extracts the same data as the Chrome extension but runs headless.
// Uses addInitScript to inject capture logic before page scripts run,
// then scrolls the full page, hovers interactive elements, and exports.

import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { resolve } from "path";

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" || args[i] === "-o") { flags.out = args[++i]; continue; }
  if (args[i] === "--wait" || args[i] === "-w") { flags.wait = parseInt(args[++i], 10); continue; }
  if (args[i] === "--scroll-speed") { flags.scrollSpeed = parseInt(args[++i], 10); continue; }
  if (args[i] === "--no-hover") { flags.noHover = true; continue; }
  if (args[i] === "--viewport") {
    const [w, h] = args[++i].split("x").map(Number);
    flags.viewport = { width: w, height: h };
    continue;
  }
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
GrabX CLI — extract full site DNA from any URL

Usage:
  node extract.js <url> [options]

Options:
  -o, --out <file>       Write JSON to file instead of stdout
  -w, --wait <ms>        Extra wait after load before extraction (default: 3000)
  --scroll-speed <ms>    Pause between scroll steps in ms (default: 150)
  --no-hover             Skip hover pass (faster, misses hover states)
  --viewport <WxH>       Viewport size (default: 1440x900)
  -h, --help             Show this help

Examples:
  node extract.js https://lattice.com -o lattice.json
  node extract.js https://linear.app --viewport 1920x1080
  node extract.js https://stripe.com | jq '.fonts'
`);
    process.exit(0);
  }
  positional.push(args[i]);
}

const url = positional[0];
if (!url) {
  console.error("Error: URL is required. Run with --help for usage.");
  process.exit(1);
}

const WAIT_MS = flags.wait || 3000;
const SCROLL_SPEED = flags.scrollSpeed || 150;
const VIEWPORT = flags.viewport || { width: 1440, height: 900 };

// ── Init script — injected before page scripts run ──────────────────────────
// This is the equivalent of the extension's document_start content script.
// It captures animations from frame 0.

const INIT_SCRIPT = `
(() => {
  window.__grabx = {
    startTime: Date.now(),
    animations: new Map(),
    elementIds: new WeakMap(),
    elementIdCounter: 0
  };

  const gx = window.__grabx;

  function getElementId(el) {
    if (gx.elementIds.has(el)) return gx.elementIds.get(el);
    const id = gx.elementIdCounter++;
    gx.elementIds.set(el, id);
    return id;
  }

  function generateSelector(el) {
    if (!el || !el.tagName) return "unknown";
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 5) {
      const tag = current.tagName.toLowerCase();
      const idAttr = current.id ? "#" + CSS.escape(current.id) : "";
      let cls = "";
      let className = current.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) {
        className = className.baseVal;
      }
      if (className && typeof className === "string" && className.trim()) {
        cls = "." + className.trim().split(/\\s+/).filter(Boolean).slice(0, 3)
          .map(c => CSS.escape(c)).join(".");
      }
      let nth = "";
      if (!idAttr && current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          nth = ":nth-child(" + (Array.from(current.parentElement.children).indexOf(current) + 1) + ")";
        }
      }
      parts.unshift(tag + idAttr + cls + nth);
      if (idAttr) break;
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ") || "unknown";
  }

  function extractKeyframes(effect) {
    if (!effect || typeof effect.getKeyframes !== "function") return [];
    try {
      return effect.getKeyframes().map(frame => {
        const clean = {};
        for (const [k, v] of Object.entries(frame)) {
          if (k !== "composite" && k !== "computedOffset" && v !== null && v !== undefined && v !== "") {
            clean[k] = v;
          }
        }
        return clean;
      });
    } catch (_) { return []; }
  }

  function registerAnimation(anim) {
    const target = anim.effect?.target;
    if (!target) return;
    const selector = generateSelector(target);
    const elId = getElementId(target);
    const timing = anim.effect?.getTiming ? anim.effect.getTiming() : {};

    let animName, animType;
    if (anim instanceof CSSAnimation) {
      animName = anim.animationName;
      animType = "CSS Keyframe Animation";
    } else if (anim instanceof CSSTransition) {
      animName = anim.transitionProperty;
      animType = "CSS Transition";
    } else {
      animName = anim.id && anim.id !== "" ? anim.id : "waapi";
      animType = "WAAPI Animation";
    }

    const uniqueKey = "el" + elId + "__" + animName;
    if (gx.animations.has(uniqueKey)) return;

    const durationMs = typeof timing.duration === "number"
      ? timing.duration + "ms" : (timing.duration || "auto");
    const delayMs = typeof timing.delay === "number"
      ? timing.delay + "ms" : (timing.delay || "0ms");

    let restingState = {};
    try {
      const cs = window.getComputedStyle(target);
      restingState = { opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility };
    } catch (_) {}

    let viewportPosition = null;
    try {
      const rect = target.getBoundingClientRect();
      viewportPosition = {
        top: Math.round(rect.top), left: Math.round(rect.left),
        width: Math.round(rect.width), height: Math.round(rect.height),
        viewportHeight: window.innerHeight,
        triggerRatio: +(rect.top / window.innerHeight).toFixed(3)
      };
    } catch (_) {}

    gx.animations.set(uniqueKey, {
      selector, elementId: elId, name: animName, type: animType,
      duration: durationMs, delay: delayMs,
      easing: timing.easing || "linear", fill: timing.fill || "none",
      iterations: timing.iterations ?? 1, direction: timing.direction || "normal",
      keyframes: extractKeyframes(anim.effect),
      restingState, viewportPosition,
      capturedAt: (Date.now() - gx.startTime) + "ms"
    });
  }

  function snapshot() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(registerAnimation);
  }

  let lastSnapshot = 0;
  function throttledSnapshot() {
    const now = Date.now();
    if (now - lastSnapshot < 150) return;
    lastSnapshot = now;
    snapshot();
  }

  ["animationstart", "animationiteration", "transitionrun", "transitionstart"].forEach(evt => {
    window.addEventListener(evt, (e) => {
      try { if (e.target?.getAnimations) e.target.getAnimations().forEach(registerAnimation); } catch (_) {}
      throttledSnapshot();
    }, { capture: true, passive: true });
  });

  window.addEventListener("scroll", throttledSnapshot, { passive: true });
  window.addEventListener("mouseover", throttledSnapshot, { passive: true });

  // 12-second polling window
  const poll = setInterval(snapshot, 100);
  setTimeout(() => clearInterval(poll), 12000);
  snapshot();
})();
`;

// ── Extraction script — runs after scrolling/hovering is done ───────────────
// This is the equivalent of buildPayload() in content.js.

const EXTRACT_SCRIPT = `
(() => {
  const gx = window.__grabx || { animations: new Map(), startTime: Date.now() };

  // ── Style properties to capture ──
  const STYLE_PROPS = [
    "display", "flexDirection", "justifyContent", "alignItems", "gap",
    "gridTemplateColumns", "gridTemplateRows",
    "position", "top", "right", "bottom", "left",
    "width", "height", "maxWidth", "minHeight",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "backgroundColor", "background", "color",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform", "textAlign",
    "borderRadius", "border", "borderColor", "boxShadow",
    "opacity", "transform", "overflow", "zIndex", "transition"
  ];

  function extractComputedStyle(el) {
    const result = {};
    try {
      const cs = window.getComputedStyle(el);
      for (const prop of STYLE_PROPS) {
        const val = cs[prop];
        if (val && val !== "none" && val !== "normal" && val !== "auto" &&
            val !== "0px" && val !== "0px 0px 0px 0px" && val !== "start" &&
            val !== "rgba(0, 0, 0, 0)" && val !== "transparent" && val !== "static" &&
            val !== "visible" && val !== "0" && val !== "stretch" && val !== "0s" &&
            val !== "baseline") {
          result[prop] = val;
        }
      }
      result.display = cs.display;
      if (cs.position !== "static") result.position = cs.position;
    } catch (_) {}
    return result;
  }

  function generateSelector(el) {
    if (!el || !el.tagName) return "unknown";
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 5) {
      const tag = current.tagName.toLowerCase();
      const idAttr = current.id ? "#" + CSS.escape(current.id) : "";
      let cls = "";
      let className = current.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) className = className.baseVal;
      if (className && typeof className === "string" && className.trim()) {
        cls = "." + className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).map(c => CSS.escape(c)).join(".");
      }
      let nth = "";
      if (!idAttr && current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) nth = ":nth-child(" + (Array.from(current.parentElement.children).indexOf(current) + 1) + ")";
      }
      parts.unshift(tag + idAttr + cls + nth);
      if (idAttr) break;
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ") || "unknown";
  }

  // ── DOM walker ──
  function walkDOM(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return null;
    const tag = el.tagName?.toLowerCase();
    if (!tag || ["script", "style", "noscript", "link", "meta"].includes(tag)) return null;
    if (tag === "svg" && depth > 1) return { tag: "svg", hasContent: true };

    const node = { tag };
    if (el.id) node.id = el.id;

    let className = el.className;
    if (className && typeof className === "object" && className.baseVal !== undefined) className = className.baseVal;
    if (className && typeof className === "string" && className.trim()) {
      node.classes = className.trim().split(/\\s+/).filter(Boolean);
    }

    const role = el.getAttribute("role");
    if (role) node.role = role;
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) node.ariaLabel = ariaLabel;

    if (depth <= 3) node.computedStyle = extractComputedStyle(el);

    if (/^h[1-6]$/.test(tag)) {
      node.textPreview = (el.textContent || "").trim().slice(0, 300);
    } else if (depth >= 2) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (directText) node.textPreview = directText.slice(0, 200);
    }

    const children = Array.from(el.children)
      .map(child => walkDOM(child, depth + 1, maxDepth))
      .filter(Boolean);
    if (children.length) node.children = children;

    return node;
  }

  // ── Sections ──
  function extractSections() {
    const sections = [];
    let topLevel = document.querySelectorAll(
      "body > header, body > nav, body > main, body > footer, body > aside, " +
      "body > section, body > article, body > div, " +
      "main > section, main > div, main > article"
    );
    const elements = topLevel.length > 0 ? topLevel : (document.body ? document.body.children : []);

    for (const el of elements) {
      const tag = el.tagName?.toLowerCase();
      if (!tag || ["script", "style", "noscript", "link"].includes(tag)) continue;

      let label = "";
      if (tag === "header") label = "Header";
      else if (tag === "nav") label = "Navigation";
      else if (tag === "footer") label = "Footer";
      else if (tag === "aside") label = "Sidebar";
      else {
        const heading = el.querySelector("h1, h2, h3");
        const labelledby = el.getAttribute("aria-labelledby");
        label = el.getAttribute("aria-label") ||
                (labelledby && document.getElementById(labelledby)?.textContent) ||
                heading?.textContent?.trim()?.slice(0, 80) ||
                el.id || (tag + "-section");
      }

      const section = {
        label,
        selector: generateSelector(el),
        tag
      };
      if (el.id) section.id = el.id;

      let className = el.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) className = className.baseVal;
      if (className && typeof className === "string" && className.trim()) {
        section.classes = className.trim().split(/\\s+/).filter(Boolean);
      }

      section.computedStyle = extractComputedStyle(el);
      section.tree = walkDOM(el, 0, 4);

      try {
        const rect = el.getBoundingClientRect();
        section.boundingBox = {
          top: Math.round(rect.top + window.scrollY),
          height: Math.round(rect.height),
          width: Math.round(rect.width)
        };
      } catch (_) {}

      sections.push(section);
    }
    return sections;
  }

  // ── Stylesheet scraper (recursive) ──
  function walkRules(rules, collector) {
    if (!rules) return;
    for (const rule of rules) {
      if (rule instanceof CSSKeyframesRule) {
        collector.keyframes.push({ name: rule.name, cssText: rule.cssText });
      }
      if (rule instanceof CSSStyleRule) {
        try {
          const transition = rule.style.transition || rule.style.getPropertyValue("transition");
          if (transition && transition !== "none" && transition !== "" && transition !== "all 0s ease 0s") {
            collector.transitionRules.push({
              selector: rule.selectorText, transition,
              properties: rule.style.transitionProperty || "all",
              duration: rule.style.transitionDuration || "",
              easing: rule.style.transitionTimingFunction || "",
              delay: rule.style.transitionDelay || ""
            });
          }
        } catch (_) {}
        const sel = rule.selectorText || "";
        if (/:hover|:focus|:active|:focus-visible|:focus-within/.test(sel)) {
          try { collector.interactionStates.push({ selector: sel, cssText: rule.cssText }); } catch (_) {}
        }
      }
      if (rule.cssRules) {
        if (rule instanceof CSSMediaRule) {
          collector.mediaQueries.add(rule.conditionText || rule.media?.mediaText || "");
        }
        walkRules(rule.cssRules, collector);
      }
    }
  }

  function scrapeStylesheets() {
    const collector = { keyframes: [], transitionRules: [], interactionStates: [], mediaQueries: new Set() };
    for (const sheet of document.styleSheets) {
      try { walkRules(sheet.cssRules || sheet.rules, collector); } catch (_) {}
    }
    return {
      keyframes: collector.keyframes,
      transitionRules: collector.transitionRules,
      interactionStates: collector.interactionStates,
      breakpoints: [...collector.mediaQueries].filter(Boolean).sort()
    };
  }

  // ── Design tokens ──
  function extractDesignTokens() {
    const vars = [];
    const seen = new Set();
    const cs = window.getComputedStyle(document.documentElement);
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of rules) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (!/^(:root|html|body)$/i.test(rule.selectorText?.trim())) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (!prop.startsWith("--") || seen.has(prop)) continue;
            seen.add(prop);
            const value = rule.style.getPropertyValue(prop).trim();
            const computed = cs.getPropertyValue(prop).trim();
            const entry = { property: prop, value };
            if (computed !== value) entry.computed = computed;
            vars.push(entry);
          }
        }
      } catch (_) {}
    }
    return { cssVariables: vars };
  }

  // ── Color palette ──
  function extractColorPalette() {
    const backgrounds = new Set(), textColors = new Set(), borderColors = new Set(), accents = new Set();
    const elements = document.querySelectorAll(
      "body, header, main, footer, section, nav, article, aside, " +
      "h1, h2, h3, h4, p, a, button, input, [class*='hero'], [class*='cta'], " +
      "[class*='card'], [class*='btn'], [class*='nav'], [class*='footer']"
    );
    elements.forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundColor, color = cs.color, border = cs.borderColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") backgrounds.add(bg);
        if (color) textColors.add(color);
        if (border && border !== "rgb(0, 0, 0)" && border !== color) borderColors.add(border);
        const tag = el.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || el.getAttribute("role") === "button") {
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") accents.add(bg);
        }
      } catch (_) {}
    });
    return { backgrounds: [...backgrounds], text: [...textColors], borders: [...borderColors], accents: [...accents] };
  }

  // ── Fonts ──
  function extractFonts() {
    const fonts = [], seen = new Set();
    try {
      for (const face of document.fonts) {
        const key = face.family + "|" + face.weight + "|" + face.style;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = {
          family: face.family.replace(/^"|"$/g, ""),
          weight: face.weight, style: face.style,
          stretch: face.stretch, status: face.status
        };
        if (face.unicodeRange && face.unicodeRange !== "U+0-10FFFF") entry.unicodeRange = face.unicodeRange;
        fonts.push(entry);
      }
    } catch (_) {}

    const fontLinks = new Set();
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.href || "";
      if (href.includes("fonts.googleapis.com") || href.includes("fonts.gstatic.com") ||
          href.includes("use.typekit.net") || href.includes("fast.fonts.net")) fontLinks.add(href);
    });
    document.querySelectorAll('link[rel="preconnect"]').forEach(link => {
      const href = link.href || "";
      if (href.includes("fonts.") || href.includes("typekit")) fontLinks.add(href);
    });

    return { faces: fonts, externalSheets: [...fontLinks] };
  }

  // ── Assets ──
  function extractAssets() {
    const images = [], svgs = [], backgroundImages = [], seen = new Set();

    document.querySelectorAll("img").forEach(img => {
      const src = img.src || img.dataset.src || img.getAttribute("data-lazy-src") || "";
      if (!src || seen.has(src)) return;
      seen.add(src);
      const entry = { src, alt: img.alt || "" };
      if (img.naturalWidth) entry.width = img.naturalWidth;
      if (img.naturalHeight) entry.height = img.naturalHeight;
      if (img.loading && img.loading !== "auto") entry.loading = img.loading;
      entry.selector = generateSelector(img);
      images.push(entry);
    });

    document.querySelectorAll("picture source").forEach(source => {
      const srcset = source.srcset || "";
      if (srcset && !seen.has(srcset)) {
        seen.add(srcset);
        images.push({ src: srcset, type: source.type || "picture-source" });
      }
    });

    let svgCount = 0;
    document.querySelectorAll("svg").forEach(svg => {
      if (svgCount >= 20) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 24 && rect.height < 24) return;
      try {
        svgs.push({
          selector: generateSelector(svg),
          width: Math.round(rect.width), height: Math.round(rect.height),
          viewBox: svg.getAttribute("viewBox") || undefined,
          outerHTML: svg.outerHTML.slice(0, 5000)
        });
        svgCount++;
      } catch (_) {}
    });

    document.querySelectorAll("section, div, header, footer, main, aside, [class*='hero'], [class*='banner'], [class*='bg']").forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (bg && bg !== "none") {
          const urls = bg.match(/url\\(["']?(.+?)["']?\\)/g);
          if (urls) urls.forEach(u => {
            const extracted = u.replace(/url\\(["']?|["']?\\)/g, "");
            if (!seen.has(extracted)) { seen.add(extracted); backgroundImages.push({ selector: generateSelector(el), url: extracted }); }
          });
        }
      } catch (_) {}
    });

    return { images, svgs, backgroundImages };
  }

  // ── Head meta ──
  function extractHeadMeta() {
    const meta = { title: document.title || "" };
    document.querySelectorAll("meta").forEach(m => {
      const name = (m.getAttribute("name") || "").toLowerCase();
      const property = (m.getAttribute("property") || "").toLowerCase();
      const content = m.getAttribute("content") || "";
      if (name === "description") meta.description = content;
      if (name === "viewport") meta.viewport = content;
      if (name === "theme-color") meta.themeColor = content;
      if (property === "og:image") meta.ogImage = content;
      if (property === "og:title") meta.ogTitle = content;
      if (property === "og:description") meta.ogDescription = content;
    });
    const iconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (iconLink) meta.favicon = iconLink.href || "";
    const preconnects = [];
    document.querySelectorAll('link[rel="preconnect"]').forEach(link => { if (link.href) preconnects.push(link.href); });
    if (preconnects.length) meta.preconnects = preconnects;
    const stylesheetUrls = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => { if (link.href) stylesheetUrls.push(link.href); });
    if (stylesheetUrls.length) meta.stylesheetUrls = stylesheetUrls;
    return meta;
  }

  // ── Build final payload ──
  const sheets = scrapeStylesheets();
  return {
    meta: {
      tool: "GrabX CLI v2.0.0 (Playwright)",
      domain: window.location.hostname,
      url: window.location.href,
      title: document.title || "",
      exportedAt: new Date().toISOString(),
      captureWindowMs: Date.now() - gx.startTime,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      totalAnimations: gx.animations.size
    },
    designTokens: { ...extractDesignTokens(), colorPalette: extractColorPalette() },
    fonts: extractFonts(),
    sections: extractSections(),
    animations: Array.from(gx.animations.values()),
    stylesheetKeyframes: sheets.keyframes,
    transitionRules: sheets.transitionRules,
    interactionStates: sheets.interactionStates,
    breakpoints: sheets.breakpoints,
    assets: extractAssets(),
    headMeta: extractHeadMeta()
  };
})()
`;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  process.stderr.write(`[GrabX] Launching browser...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  // Inject animation capture script before anything runs (frame-0)
  await page.addInitScript(INIT_SCRIPT);

  process.stderr.write(`[GrabX] Navigating to ${url}\n`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    process.stderr.write(`[GrabX] Navigation warning: ${err.message}\n`);
  }

  // Wait for network to settle
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    process.stderr.write(`[GrabX] Network didn't fully settle, continuing...\n`);
  }

  // Extra wait for JS-driven animations to start
  process.stderr.write(`[GrabX] Waiting ${WAIT_MS}ms for animations...\n`);
  await page.waitForTimeout(WAIT_MS);

  // Scroll the full page slowly to trigger scroll-based animations
  process.stderr.write(`[GrabX] Scrolling page...\n`);
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = VIEWPORT.height;
  const steps = Math.ceil(scrollHeight / (viewportHeight * 0.6));

  for (let i = 0; i <= steps; i++) {
    const y = Math.min(i * viewportHeight * 0.6, scrollHeight);
    await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: "smooth" }), y);
    await page.waitForTimeout(SCROLL_SPEED);
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(500);

  // Hover pass: hit buttons, links, cards, nav items
  if (!flags.noHover) {
    process.stderr.write(`[GrabX] Hovering interactive elements...\n`);
    const hoverSelectors = [
      "button", "a", "nav a", "nav button",
      "[class*='card']", "[class*='btn']", "[class*='cta']",
      "[role='button']", "[role='link']", "[role='tab']"
    ];
    for (const sel of hoverSelectors) {
      try {
        const elements = await page.$$(sel);
        const toHover = elements.slice(0, 5); // first 5 per selector type
        for (const el of toHover) {
          try {
            await el.hover({ timeout: 1000 });
            await page.waitForTimeout(100);
          } catch (_) {}
        }
      } catch (_) {}
    }
    // Move mouse away to reset hover states
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
  }

  // Run the extraction
  process.stderr.write(`[GrabX] Extracting site DNA...\n`);
  const payload = await page.evaluate(EXTRACT_SCRIPT);

  await browser.close();

  const json = JSON.stringify(payload, null, 2);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (flags.out) {
    const outPath = resolve(flags.out);
    writeFileSync(outPath, json, "utf-8");
    process.stderr.write(`[GrabX] Done in ${elapsed}s. Written to ${outPath}\n`);
    process.stderr.write(`[GrabX] ${payload.meta.totalAnimations} animations, ${payload.sections.length} sections, ${payload.fonts.faces.length} fonts\n`);
  } else {
    process.stdout.write(json);
    process.stderr.write(`[GrabX] Done in ${elapsed}s. ${payload.meta.totalAnimations} animations, ${payload.sections.length} sections, ${payload.fonts.faces.length} fonts\n`);
  }
}

main().catch(err => {
  console.error("[GrabX] Fatal error:", err);
  process.exit(1);
});
