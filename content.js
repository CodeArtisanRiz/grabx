// GrabX v2.1.0 — content script (document_start)
// Full site DNA extraction: animations, design tokens, fonts, layout, assets.
// Complete AST traversal (depth 14) + computed styles + bounding rects on all visual nodes.

(async () => {
  // ── 1. Guard: only run if domain is active ────────────────────────────────
  const currentDomain = window.location.hostname;
  let activeDomains = {};
  try {
    ({ activeDomains = {} } = await chrome.storage.local.get("activeDomains"));
  } catch (_) {
    return;
  }
  if (!activeDomains[currentDomain]) return;

  // ── 2. Registry ───────────────────────────────────────────────────────────
  const registry = {
    domain: currentDomain,
    url: window.location.href,
    startTime: Date.now(),
    animations: new Map(),
    elementIds: new WeakMap(),
    elementIdCounter: 0,
    earlyKeyframes: []
  };

  // ── 3. Selector Generation ────────────────────────────────────────────────

  function getElementId(el) {
    if (registry.elementIds.has(el)) return registry.elementIds.get(el);
    const id = registry.elementIdCounter++;
    registry.elementIds.set(el, id);
    return id;
  }

  function generateSelector(el) {
    if (!el || !el.tagName) return "unknown";
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 6) {
      const tag = current.tagName.toLowerCase();
      const idAttr = current.id ? "#" + CSS.escape(current.id) : "";
      let cls = "";
      let className = current.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) {
        className = className.baseVal;
      }
      if (className && typeof className === "string" && className.trim()) {
        cls = "." + className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
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

  // ── 4. Animation Extraction ───────────────────────────────────────────────

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
    if (registry.animations.has(uniqueKey)) return;

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

    registry.animations.set(uniqueKey, {
      selector, elementId: elId, name: animName, type: animType,
      duration: durationMs, delay: delayMs,
      easing: timing.easing || "linear", fill: timing.fill || "none",
      iterations: timing.iterations ?? 1, direction: timing.direction || "normal",
      keyframes: extractKeyframes(anim.effect),
      restingState, viewportPosition,
      capturedAt: (Date.now() - registry.startTime) + "ms"
    });

    updateHUD();
  }

  function snapshotAnimations() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(registerAnimation);
  }

  let lastSnapshot = 0;
  function throttledSnapshot() {
    const now = Date.now();
    if (now - lastSnapshot < 150) return;
    lastSnapshot = now;
    snapshotAnimations();
  }

  ["animationstart", "animationiteration", "transitionrun", "transitionstart"].forEach(evtName => {
    window.addEventListener(evtName, (e) => {
      try { if (e.target?.getAnimations) e.target.getAnimations().forEach(registerAnimation); } catch (_) {}
      throttledSnapshot();
    }, { capture: true, passive: true });
  });

  const pollInterval = setInterval(snapshotAnimations, 100);
  setTimeout(() => clearInterval(pollInterval), 12000);

  window.addEventListener("scroll", throttledSnapshot, { passive: true });
  window.addEventListener("mouseover", throttledSnapshot, { passive: true });

  // ── 5. Stylesheets Scraper ────────────────────────────────────────────────

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
        const selectorText = rule.selectorText || "";
        if (/:hover|:focus|:active|:focus-visible|:focus-within/.test(selectorText)) {
          try { collector.interactionStates.push({ selector: selectorText, cssText: rule.cssText }); } catch (_) {}
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

  function scrapeAllStylesheets() {
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

  setTimeout(() => {
    try {
      const early = scrapeAllStylesheets();
      registry.earlyKeyframes = early.keyframes;
    } catch (_) {}
  }, 3000);

  // ── 6. Design Tokens & Colors ─────────────────────────────────────────────

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

  // ── 7. Fonts & Typography ─────────────────────────────────────────────────

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

  // ── 8. Deep DOM Extraction ────────────────────────────────────────────────

  const STYLE_PROPS = [
    "display", "flexDirection", "justifyContent", "alignItems", "gap",
    "gridTemplateColumns", "gridTemplateRows",
    "position", "top", "right", "bottom", "left", "zIndex",
    "width", "height", "maxWidth", "minWidth", "maxHeight", "minHeight",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "backgroundColor", "background", "color",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform", "textAlign",
    "borderRadius", "border", "borderColor", "borderWidth", "boxShadow",
    "opacity", "transform", "overflow", "transition", "cursor", "aspectRatio"
  ];

  function extractComputedStyle(el) {
    const result = {};
    try {
      const cs = window.getComputedStyle(el);
      for (const prop of STYLE_PROPS) {
        const val = cs[prop];
        if (val !== undefined && val !== null && val !== "") {
          result[prop] = val;
        }
      }
    } catch (_) {}
    return result;
  }

  function walkDOM(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return null;
    const tag = el.tagName?.toLowerCase();
    if (!tag || ["script", "style", "noscript", "link", "meta"].includes(tag)) return null;

    if (tag === "svg" && depth > 2) {
      const rect = el.getBoundingClientRect();
      return {
        tag: "svg",
        rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
        outerHTML: el.outerHTML.slice(0, 4000)
      };
    }

    const rect = el.getBoundingClientRect();
    const node = {
      tag,
      selector: generateSelector(el),
      rect: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      computedStyle: extractComputedStyle(el)
    };

    if (el.id) node.id = el.id;

    let className = el.className;
    if (className && typeof className === "object" && className.baseVal !== undefined) className = className.baseVal;
    if (className && typeof className === "string" && className.trim()) {
      node.classes = className.trim().split(/\s+/).filter(Boolean);
    }

    const attrs = {};
    ["src", "srcset", "alt", "href", "target", "type", "loading", "title", "role", "aria-label", "viewBox"].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) attrs[attr] = val;
    });
    if (Object.keys(attrs).length) node.attributes = attrs;

    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(" ");
    if (directText) node.directText = directText;

    if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "button" || tag === "a" || tag === "span") {
      const fullText = el.textContent?.trim();
      if (fullText) node.text = fullText.slice(0, 1000);
    }

    const children = Array.from(el.children)
      .map(child => walkDOM(child, depth + 1, maxDepth))
      .filter(Boolean);
    if (children.length) node.children = children;

    return node;
  }

  function extractSections() {
    const sections = [];
    let topLevel = document.querySelectorAll(
      "body > header, body > nav, body > main, body > footer, body > aside, " +
      "body > section, body > article, body > div, " +
      "main > header, main > section, main > div, main > article, main > footer"
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

      const rect = el.getBoundingClientRect();
      const section = {
        label,
        selector: generateSelector(el),
        tag,
        rect: {
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left + window.scrollX),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        computedStyle: extractComputedStyle(el),
        tree: walkDOM(el, 0, 14)
      };
      if (el.id) section.id = el.id;

      let className = el.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) className = className.baseVal;
      if (className && typeof className === "string" && className.trim()) {
        section.classes = className.trim().split(/\s+/).filter(Boolean);
      }

      sections.push(section);
    }
    return sections;
  }

  // ── 9. Assets & Meta ──────────────────────────────────────────────────────

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
      if (svgCount >= 40) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 16 && rect.height < 16) return;
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

  // ── 10. HUD Mounting ──────────────────────────────────────────────────────

  let hudRoot = null;
  let hudBtn = null;

  function updateHUD() {
    if (hudBtn) hudBtn.textContent = `⚡ GrabX  (${registry.animations.size})`;
  }

  function mountHUD() {
    if (hudRoot || !document.body) return;
    const host = document.createElement("div");
    host.id = "grabx-hud-host";
    host.style.cssText = "all: initial !important; position: fixed !important; bottom: 0 !important; right: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;";
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "closed" });
    hudRoot = shadow;

    const style = document.createElement("style");
    style.textContent = `
      button {
        position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background-color: #090d16; color: #38bdf8; border: 1.5px solid #38bdf8;
        border-radius: 9999px; padding: 10px 20px; font-family: ui-monospace, monospace;
        font-size: 13px; font-weight: 700; cursor: pointer; pointer-events: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6); outline: none; user-select: none;
      }
      button.success { border-color: #4ade80; color: #4ade80; }
      button.error { border-color: #f87171; color: #f87171; }
    `;
    shadow.appendChild(style);

    const btn = document.createElement("button");
    btn.textContent = `⚡ GrabX  (${registry.animations.size})`;
    hudBtn = btn;

    btn.addEventListener("click", async () => {
      const payload = buildPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      try {
        await navigator.clipboard.writeText(jsonStr);
        btn.textContent = "✔ Copied!";
        btn.className = "success";
        setTimeout(() => { btn.className = ""; updateHUD(); }, 2000);
      } catch (_) {
        btn.textContent = "✖ Copy Failed";
        btn.className = "error";
        setTimeout(() => { btn.className = ""; updateHUD(); }, 2000);
      }
    });

    shadow.appendChild(btn);
  }

  function buildPayload() {
    const sheets = scrapeAllStylesheets();
    const allKeyframes = [...registry.earlyKeyframes, ...sheets.keyframes];
    const seenKf = new Set();
    const dedupedKeyframes = allKeyframes.filter(kf => {
      if (seenKf.has(kf.name)) return false;
      seenKf.add(kf.name);
      return true;
    });

    return {
      meta: {
        tool: "GrabX v2.1.0",
        domain: registry.domain,
        url: registry.url,
        title: document.title || "",
        exportedAt: new Date().toISOString(),
        captureWindowMs: Date.now() - registry.startTime,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        totalAnimations: registry.animations.size
      },
      designTokens: { ...extractDesignTokens(), colorPalette: extractColorPalette() },
      fonts: extractFonts(),
      sections: extractSections(),
      animations: Array.from(registry.animations.values()),
      stylesheetKeyframes: dedupedKeyframes,
      transitionRules: sheets.transitionRules,
      interactionStates: sheets.interactionStates,
      breakpoints: sheets.breakpoints,
      assets: extractAssets(),
      headMeta: extractHeadMeta()
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountHUD);
  } else {
    mountHUD();
  }

  snapshotAnimations();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "grabx:export") sendResponse(buildPayload());
  });
})();
