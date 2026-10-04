// GrabX v2.0.0 — content script (document_start)
// Full site DNA extraction: animations, design tokens, fonts, layout, assets.
// Only activates on domains flagged by the background worker.

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
    /** @type {Map<string, object>} */
    animations: new Map(),
    /** @type {WeakMap<Element, number>} */
    elementIds: new WeakMap(),
    elementIdCounter: 0,
    /** @type {Array} */
    earlyKeyframes: []
  };

  // ── 3. Selector generation (bug-fixed) ────────────────────────────────────

  /**
   * Assign a stable numeric ID to each element so we can disambiguate
   * elements with identical tag+class selectors.
   */
  function getElementId(el) {
    if (registry.elementIds.has(el)) return registry.elementIds.get(el);
    const id = registry.elementIdCounter++;
    registry.elementIds.set(el, id);
    return id;
  }

  /**
   * Build a CSS selector path for an element.
   * Handles SVG className (SVGAnimatedString), escapes special chars.
   */
  function generateSelector(el) {
    if (!el || !el.tagName) return "unknown";

    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.documentElement && depth < 5) {
      const tag = current.tagName.toLowerCase();
      const id = current.id ? `#${CSS.escape(current.id)}` : "";

      let cls = "";
      let className = current.className;
      // Handle SVGAnimatedString
      if (className && typeof className === "object" && className.baseVal !== undefined) {
        className = className.baseVal;
      }
      if (className && typeof className === "string" && className.trim()) {
        cls = "." + className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
          .map(c => CSS.escape(c)).join(".");
      }

      // Add nth-child for disambiguation when no id
      let nth = "";
      if (!id && current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          nth = `:nth-child(${Array.from(current.parentElement.children).indexOf(current) + 1})`;
        }
      }

      parts.unshift(`${tag}${id}${cls}${nth}`);
      if (id) break; // id is unique, stop traversing up
      current = current.parentElement;
      depth++;
    }

    return parts.join(" > ") || "unknown";
  }

  // ── 4. Animation extraction (bug-fixed) ───────────────────────────────────

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
    } catch (_) {
      return [];
    }
  }

  function registerAnimation(anim) {
    const target = anim.effect?.target;
    if (!target) return;

    const selector = generateSelector(target);
    const elId = getElementId(target);
    const timing = anim.effect?.getTiming ? anim.effect.getTiming() : {};

    // Accurate type detection
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

    const uniqueKey = `el${elId}__${animName}`;
    if (registry.animations.has(uniqueKey)) return;

    const durationMs = typeof timing.duration === "number"
      ? `${timing.duration}ms` : (timing.duration ?? "auto");
    const delayMs = typeof timing.delay === "number"
      ? `${timing.delay}ms` : (timing.delay ?? "0ms");

    // Capture element's resting computed style for context
    let computedSnippet = {};
    try {
      const cs = window.getComputedStyle(target);
      computedSnippet = {
        opacity: cs.opacity,
        transform: cs.transform,
        visibility: cs.visibility
      };
    } catch (_) {}

    // Capture viewport position for scroll-trigger context
    let viewportPosition = null;
    try {
      const rect = target.getBoundingClientRect();
      viewportPosition = {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewportHeight: window.innerHeight,
        triggerRatio: +(rect.top / window.innerHeight).toFixed(3)
      };
    } catch (_) {}

    registry.animations.set(uniqueKey, {
      selector,
      elementId: elId,
      name: animName,
      type: animType,
      duration: durationMs,
      delay: delayMs,
      easing: timing.easing || "linear",
      fill: timing.fill || "none",
      iterations: timing.iterations ?? 1,
      direction: timing.direction || "normal",
      keyframes: extractKeyframes(anim.effect),
      restingState: computedSnippet,
      viewportPosition,
      capturedAt: `${Date.now() - registry.startTime}ms`
    });

    updateHUD();
  }

  function snapshotAnimations() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(registerAnimation);
  }

  // ── 5. Throttled event listeners (fixes jank bug) ─────────────────────────
  let lastSnapshotTime = 0;
  function throttledSnapshot() {
    const now = Date.now();
    if (now - lastSnapshotTime < 200) return;
    lastSnapshotTime = now;
    snapshotAnimations();
  }

  // Animation/transition events — use event target for precision
  ["animationstart", "animationiteration", "transitionrun", "transitionstart"].forEach(evtName => {
    window.addEventListener(evtName, (e) => {
      // Capture target-specific animations first
      try {
        if (e.target && e.target.getAnimations) {
          e.target.getAnimations().forEach(registerAnimation);
        }
      } catch (_) {}
      throttledSnapshot();
    }, { capture: true, passive: true });
  });

  // 12-second polling window for GSAP / JS-driven animations
  const pollInterval = setInterval(snapshotAnimations, 100);
  setTimeout(() => clearInterval(pollInterval), 12_000);

  // Scroll & hover — throttled
  window.addEventListener("scroll", throttledSnapshot, { passive: true });
  window.addEventListener("mouseover", throttledSnapshot, { passive: true });

  // ── 6. Stylesheet scrapers (recursive for nested rules) ───────────────────

  function walkRules(rules, collector) {
    if (!rules) return;
    for (const rule of rules) {
      if (rule instanceof CSSKeyframesRule) {
        collector.keyframes.push({ name: rule.name, cssText: rule.cssText });
      }
      // Transition rules from regular style rules
      if (rule instanceof CSSStyleRule) {
        try {
          const transition = rule.style.transition || rule.style.getPropertyValue("transition");
          if (transition && transition !== "none" && transition !== "" && transition !== "all 0s ease 0s") {
            collector.transitionRules.push({
              selector: rule.selectorText,
              transition,
              properties: rule.style.transitionProperty || "all",
              duration: rule.style.transitionDuration || "",
              easing: rule.style.transitionTimingFunction || "",
              delay: rule.style.transitionDelay || ""
            });
          }
        } catch (_) {}

        // Interaction states (:hover, :focus, :active)
        const selectorText = rule.selectorText || "";
        if (/:hover|:focus|:active|:focus-visible|:focus-within/.test(selectorText)) {
          try {
            collector.interactionStates.push({
              selector: selectorText,
              cssText: rule.cssText
            });
          } catch (_) {}
        }
      }
      // Recurse into @media, @supports, @layer, @container
      if (rule.cssRules) {
        if (rule instanceof CSSMediaRule) {
          collector.mediaQueries.add(rule.conditionText || rule.media?.mediaText || "");
        }
        walkRules(rule.cssRules, collector);
      }
    }
  }

  function scrapeAllStylesheets() {
    const collector = {
      keyframes: [],
      transitionRules: [],
      interactionStates: [],
      mediaQueries: new Set()
    };
    for (const sheet of document.styleSheets) {
      try {
        walkRules(sheet.cssRules || sheet.rules, collector);
      } catch (_) {
        // Cross-origin sheet — skip
      }
    }
    return {
      keyframes: collector.keyframes,
      transitionRules: collector.transitionRules,
      interactionStates: collector.interactionStates,
      breakpoints: [...collector.mediaQueries].filter(Boolean).sort()
    };
  }

  // Capture keyframes early during polling window too (in case sheets are removed later)
  setTimeout(() => {
    try {
      const early = scrapeAllStylesheets();
      registry.earlyKeyframes = early.keyframes;
    } catch (_) {}
  }, 3000);

  // ── 7. Design token extraction ────────────────────────────────────────────

  function extractDesignTokens() {
    const tokens = { cssVariables: [], colors: new Set(), typography: new Set() };

    // CSS custom properties from :root / html / body
    const targets = [document.documentElement, document.body].filter(Boolean);
    for (const el of targets) {
      try {
        const cs = window.getComputedStyle(el);
        // Walk all custom properties via stylesheets
        for (const sheet of document.styleSheets) {
          try {
            const rules = sheet.cssRules || sheet.rules;
            if (!rules) continue;
            for (const rule of rules) {
              if (!(rule instanceof CSSStyleRule)) continue;
              // Only :root, html, body selectors
              if (!/^(:root|html|body)$/i.test(rule.selectorText?.trim())) continue;
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith("--")) {
                  const value = rule.style.getPropertyValue(prop).trim();
                  const computed = cs.getPropertyValue(prop).trim();
                  tokens.cssVariables.push({
                    property: prop,
                    value,
                    computed: computed !== value ? computed : undefined
                  });
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Deduplicate css variables
    const seen = new Set();
    tokens.cssVariables = tokens.cssVariables.filter(v => {
      if (seen.has(v.property)) return false;
      seen.add(v.property);
      return true;
    });

    return { cssVariables: tokens.cssVariables };
  }

  // ── 8. Font extraction ────────────────────────────────────────────────────

  function extractFonts() {
    const fonts = [];
    const seen = new Set();

    try {
      for (const face of document.fonts) {
        const key = `${face.family}|${face.weight}|${face.style}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let src = "";
        try {
          // FontFace.src is not always readable, but try
          if (face.src) src = face.src;
        } catch (_) {}

        fonts.push({
          family: face.family.replace(/^"|"$/g, ""),
          weight: face.weight,
          style: face.style,
          stretch: face.stretch,
          unicodeRange: face.unicodeRange,
          status: face.status,
          src: src || undefined
        });
      }
    } catch (_) {}

    // Also check <link> tags for Google Fonts / external font sheets
    const fontLinks = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.href || "";
      if (href.includes("fonts.googleapis.com") || href.includes("fonts.gstatic.com") ||
          href.includes("use.typekit.net") || href.includes("fast.fonts.net")) {
        fontLinks.push(href);
      }
    });

    // Check preconnects for font services
    document.querySelectorAll('link[rel="preconnect"]').forEach(link => {
      const href = link.href || "";
      if (href.includes("fonts.") || href.includes("typekit")) {
        fontLinks.push(href);
      }
    });

    return { faces: fonts, externalSheets: [...new Set(fontLinks)] };
  }

  // ── 9. Color palette extraction ───────────────────────────────────────────

  function extractColorPalette() {
    const backgrounds = new Set();
    const textColors = new Set();
    const borderColors = new Set();
    const accents = new Set();

    // Sample key structural elements
    const elements = document.querySelectorAll(
      "body, header, main, footer, section, nav, article, aside, " +
      "h1, h2, h3, h4, p, a, button, input, [class*='hero'], [class*='cta'], " +
      "[class*='card'], [class*='btn'], [class*='nav'], [class*='footer']"
    );

    elements.forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundColor;
        const color = cs.color;
        const border = cs.borderColor;

        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") backgrounds.add(bg);
        if (color) textColors.add(color);
        if (border && border !== "rgb(0, 0, 0)" && border !== color) borderColors.add(border);

        // Accent detection: buttons, links, CTAs
        const tag = el.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || el.getAttribute("role") === "button") {
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") accents.add(bg);
        }
      } catch (_) {}
    });

    return {
      backgrounds: [...backgrounds],
      text: [...textColors],
      borders: [...borderColors],
      accents: [...accents]
    };
  }

  // ── 10. Section-by-section DOM structure ──────────────────────────────────

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
    "opacity", "transform", "overflow", "zIndex",
    "transition"
  ];

  function extractComputedStyle(el) {
    const result = {};
    try {
      const cs = window.getComputedStyle(el);
      for (const prop of STYLE_PROPS) {
        const val = cs[prop];
        // Skip defaults / empty
        if (val && val !== "none" && val !== "normal" && val !== "auto" &&
            val !== "0px" && val !== "0px 0px 0px 0px" && val !== "start" &&
            val !== "rgba(0, 0, 0, 0)" && val !== "transparent" && val !== "static" &&
            val !== "visible" && val !== "0" && val !== "1" && val !== "stretch" &&
            val !== "0s" && val !== "baseline") {
          result[prop] = val;
        }
      }
      // Always include these even if "default-ish"
      const cs2 = cs;
      result.display = cs2.display;
      result.position = cs2.position !== "static" ? cs2.position : undefined;
    } catch (_) {}
    return result;
  }

  function walkDOM(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return null;
    const tag = el.tagName?.toLowerCase();
    if (!tag) return null;

    // Skip script, style, noscript, svg internals beyond depth 1
    if (["script", "style", "noscript", "link", "meta"].includes(tag)) return null;
    if (tag === "svg" && depth > 1) {
      return { tag: "svg", hasContent: true };
    }

    const node = {
      tag,
      id: el.id || undefined,
      classes: undefined,
      role: el.getAttribute("role") || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      computedStyle: depth <= 3 ? extractComputedStyle(el) : undefined,
      textPreview: undefined,
      children: undefined
    };

    // Classes
    let className = el.className;
    if (className && typeof className === "object" && className.baseVal !== undefined) {
      className = className.baseVal;
    }
    if (className && typeof className === "string" && className.trim()) {
      node.classes = className.trim().split(/\s+/).filter(Boolean);
    }

    // Text preview (direct text only, not children's text)
    if (depth >= 2) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (directText) node.textPreview = directText.slice(0, 200);
    }

    // For headings, always capture full text
    if (/^h[1-6]$/.test(tag)) {
      node.textPreview = (el.textContent || "").trim().slice(0, 300);
    }

    // Recurse children
    const children = Array.from(el.children)
      .map(child => walkDOM(child, depth + 1, maxDepth))
      .filter(Boolean);
    if (children.length) node.children = children;

    // Clean up undefined fields
    Object.keys(node).forEach(k => { if (node[k] === undefined) delete node[k]; });

    return node;
  }

  function extractSections() {
    const sections = [];

    // Identify top-level structural elements
    const topLevel = document.querySelectorAll(
      "body > header, body > nav, body > main, body > footer, body > aside, " +
      "body > section, body > article, body > div, " +
      "main > section, main > div, main > article"
    );

    // Fallback: if no structure found, use body's direct children
    const elements = topLevel.length > 0
      ? topLevel
      : document.body ? document.body.children : [];

    for (const el of elements) {
      const tag = el.tagName?.toLowerCase();
      if (!tag || ["script", "style", "noscript", "link"].includes(tag)) continue;

      // Derive a section label
      let label = "";
      if (tag === "header") label = "Header";
      else if (tag === "nav") label = "Navigation";
      else if (tag === "footer") label = "Footer";
      else if (tag === "aside") label = "Sidebar";
      else {
        // Try to get label from heading, aria-label, or id
        const heading = el.querySelector("h1, h2, h3");
        label = el.getAttribute("aria-label") ||
                el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent ||
                heading?.textContent?.trim()?.slice(0, 80) ||
                el.id ||
                `${tag}-section`;
      }

      const section = {
        label,
        selector: generateSelector(el),
        tag,
        id: el.id || undefined,
        classes: undefined,
        computedStyle: extractComputedStyle(el),
        tree: walkDOM(el, 0, 4),
        boundingBox: undefined
      };

      // Classes
      let className = el.className;
      if (className && typeof className === "object" && className.baseVal !== undefined) {
        className = className.baseVal;
      }
      if (className && typeof className === "string" && className.trim()) {
        section.classes = className.trim().split(/\s+/).filter(Boolean);
      }

      // Bounding box
      try {
        const rect = el.getBoundingClientRect();
        section.boundingBox = {
          top: Math.round(rect.top + window.scrollY),
          height: Math.round(rect.height),
          width: Math.round(rect.width)
        };
      } catch (_) {}

      // Clean
      Object.keys(section).forEach(k => { if (section[k] === undefined) delete section[k]; });
      sections.push(section);
    }

    return sections;
  }

  // ── 11. Asset inventory ───────────────────────────────────────────────────

  function extractAssets() {
    const images = [];
    const svgs = [];
    const backgroundImages = [];
    const seen = new Set();

    // <img> tags
    document.querySelectorAll("img").forEach(img => {
      const src = img.src || img.dataset.src || img.getAttribute("data-lazy-src") || "";
      if (!src || seen.has(src)) return;
      seen.add(src);
      images.push({
        src,
        alt: img.alt || "",
        width: img.naturalWidth || img.width || undefined,
        height: img.naturalHeight || img.height || undefined,
        loading: img.loading || undefined,
        selector: generateSelector(img)
      });
    });

    // <picture> / <source> tags
    document.querySelectorAll("picture source").forEach(source => {
      const srcset = source.srcset || "";
      if (srcset && !seen.has(srcset)) {
        seen.add(srcset);
        images.push({ src: srcset, type: source.type || "picture-source" });
      }
    });

    // Inline SVGs (keep first 20, skip tiny icons < 24px)
    let svgCount = 0;
    document.querySelectorAll("svg").forEach(svg => {
      if (svgCount >= 20) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 24 && rect.height < 24) return; // skip tiny icons
      try {
        svgs.push({
          selector: generateSelector(svg),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewBox: svg.getAttribute("viewBox") || undefined,
          outerHTML: svg.outerHTML.slice(0, 5000) // cap size
        });
        svgCount++;
      } catch (_) {}
    });

    // Background images from computed styles
    const bgElements = document.querySelectorAll(
      "section, div, header, footer, main, aside, [class*='hero'], [class*='banner'], [class*='bg']"
    );
    bgElements.forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (bg && bg !== "none") {
          const urls = bg.match(/url\(["']?(.+?)["']?\)/g);
          if (urls) {
            urls.forEach(u => {
              const url = u.replace(/url\(["']?|["']?\)/g, "");
              if (!seen.has(url)) {
                seen.add(url);
                backgroundImages.push({ selector: generateSelector(el), url });
              }
            });
          }
        }
      } catch (_) {}
    });

    return { images, svgs, backgroundImages };
  }

  // ── 12. Head meta extraction ──────────────────────────────────────────────

  function extractHeadMeta() {
    const meta = {
      title: document.title || "",
      description: "",
      viewport: "",
      charset: document.characterSet || "",
      favicon: "",
      ogImage: "",
      ogTitle: "",
      ogDescription: "",
      themeColor: "",
      preconnects: [],
      stylesheetUrls: []
    };

    // Meta tags
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

    // Favicon
    const iconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (iconLink) meta.favicon = iconLink.href || "";

    // Preconnects
    document.querySelectorAll('link[rel="preconnect"]').forEach(link => {
      meta.preconnects.push(link.href || "");
    });

    // Stylesheet URLs (for reference)
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      meta.stylesheetUrls.push(link.href || "");
    });

    // Clean empty strings
    Object.keys(meta).forEach(k => {
      if (meta[k] === "" || (Array.isArray(meta[k]) && meta[k].length === 0)) {
        delete meta[k];
      }
    });

    return meta;
  }

  // ── 13. HUD (Shadow DOM isolated) ─────────────────────────────────────────

  let hudRoot = null;
  let hudBtn = null;

  function updateHUD() {
    if (hudBtn) {
      hudBtn.textContent = `⚡ GrabX  (${registry.animations.size})`;
    }
  }

  function mountHUD() {
    if (hudRoot) return;
    if (!document.body) return;

    const host = document.createElement("div");
    host.id = "grabx-hud-host";
    host.style.cssText = "all: initial !important; position: fixed !important; bottom: 0 !important; right: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;";
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "closed" });
    hudRoot = shadow;

    const style = document.createElement("style");
    style.textContent = `
      button {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #090d16;
        color: #38bdf8;
        border: 1.5px solid #38bdf8;
        border-radius: 9999px;
        padding: 10px 20px;
        font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.02em;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(56,189,248,0.15);
        outline: none;
        transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        user-select: none;
        white-space: nowrap;
      }
      button:hover {
        transform: translateY(-2px) scale(1.03);
        background-color: #111827;
      }
      button:active {
        transform: translateY(0) scale(0.97);
      }
      button.success {
        border-color: #4ade80;
        color: #4ade80;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(74,222,128,0.2);
      }
      button.error {
        border-color: #f87171;
        color: #f87171;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(248,113,113,0.2);
      }
      .fallback-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        pointer-events: auto;
      }
      .fallback-box {
        background: #0f1729;
        border: 1px solid #38bdf8;
        border-radius: 12px;
        padding: 24px;
        max-width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .fallback-box textarea {
        width: 600px;
        max-width: 80vw;
        height: 400px;
        background: #060a14;
        color: #e2e8f0;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 12px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        resize: vertical;
      }
      .fallback-box .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .fallback-box .actions button {
        position: static;
        padding: 8px 16px;
        font-size: 12px;
        border-radius: 8px;
      }
      .close-btn {
        background: #1e293b !important;
        color: #94a3b8 !important;
        border-color: #334155 !important;
      }
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
      } catch (err) {
        console.warn("[GrabX] Clipboard failed, showing fallback:", err);
        showFallbackModal(jsonStr);
      }
    });

    shadow.appendChild(btn);
  }

  function showFallbackModal(jsonStr) {
    if (!hudRoot) return;

    const overlay = document.createElement("div");
    overlay.className = "fallback-overlay";

    const box = document.createElement("div");
    box.className = "fallback-box";

    const textarea = document.createElement("textarea");
    textarea.value = jsonStr;
    textarea.readOnly = true;

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "📋 Select All & Copy";
    copyBtn.addEventListener("click", () => {
      textarea.select();
      document.execCommand("copy");
      copyBtn.textContent = "✔ Copied!";
      copyBtn.className = "success";
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ Close";
    closeBtn.className = "close-btn";
    closeBtn.addEventListener("click", () => overlay.remove());

    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    box.appendChild(textarea);
    box.appendChild(actions);
    overlay.appendChild(box);
    hudRoot.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── 14. Full payload builder ──────────────────────────────────────────────

  function buildPayload() {
    const sheets = scrapeAllStylesheets();

    // Merge early-captured keyframes with current ones
    const allKeyframes = [...registry.earlyKeyframes, ...sheets.keyframes];
    const seenKf = new Set();
    const dedupedKeyframes = allKeyframes.filter(kf => {
      if (seenKf.has(kf.name)) return false;
      seenKf.add(kf.name);
      return true;
    });

    return {
      meta: {
        tool: "GrabX v2.0.0",
        domain: registry.domain,
        url: registry.url,
        title: document.title || "",
        exportedAt: new Date().toISOString(),
        captureWindowMs: Date.now() - registry.startTime,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio
        },
        totalAnimations: registry.animations.size
      },
      designTokens: {
        ...extractDesignTokens(),
        colorPalette: extractColorPalette()
      },
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

  // ── 15. Mount HUD when DOM is ready ───────────────────────────────────────

  function ensureHUD() {
    if (!document.body) return;
    mountHUD();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureHUD);
  } else {
    ensureHUD();
  }

  // Safety: re-check after a short delay in case DOMContentLoaded already fired
  setTimeout(ensureHUD, 500);
  setTimeout(ensureHUD, 2000);

  // Initial snapshot
  snapshotAnimations();

  // ── 16. Message listener (background can query state) ─────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "grabx:export") {
      sendResponse(buildPayload());
    } else if (msg.type === "grabx:status") {
      sendResponse({
        active: true,
        animationCount: registry.animations.size,
        captureWindowMs: Date.now() - registry.startTime
      });
    }
  });
})();
