// GrabX — content script (runs at document_start on all URLs)
// Only activates if the current domain has been flagged by the background worker.

(async () => {
  // ── 1. Guard: only run if this domain is active ───────────────────────────
  const currentDomain = window.location.hostname;
  let activeDomains = {};
  try {
    ({ activeDomains = {} } = await chrome.storage.local.get("activeDomains"));
  } catch (_) {
    return; // extension context not available (e.g. about:blank inside iframe)
  }
  if (!activeDomains[currentDomain]) return;

  // ── 2. Registry ───────────────────────────────────────────────────────────
  const registry = {
    domain: currentDomain,
    startTime: Date.now(),
    /** @type {Map<string, object>} */
    animations: new Map()
  };

  // ── 3. Helpers ────────────────────────────────────────────────────────────

  /**
   * Build a short CSS selector string for an element.
   * Keeps id + up to 3 classes to stay readable inside the JSON export.
   */
  function generateSelector(el) {
    if (!el || !el.tagName) return "unknown";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    let cls = "";
    if (el.className && typeof el.className === "string") {
      cls =
        "." +
        el.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(".");
    }
    return `${tag}${id}${cls}` || tag;
  }

  /**
   * Extract keyframe steps from a KeyframeEffect.
   * Strips composite / easing meta-keys that aren't useful for cloning.
   */
  function extractKeyframes(effect) {
    if (!effect || typeof effect.getKeyframes !== "function") return [];
    try {
      return effect.getKeyframes().map((frame) => {
        const clean = {};
        for (const [k, v] of Object.entries(frame)) {
          // Keep only concrete CSS property values
          if (
            k !== "composite" &&
            k !== "computedOffset" &&
            v !== null &&
            v !== undefined &&
            v !== ""
          ) {
            clean[k] = v;
          }
        }
        return clean;
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Register a single Web Animation (CSS or WAAPI) into the registry.
   * De-duplicates by selector + animation name.
   */
  function registerAnimation(anim) {
    const target = anim.effect?.target;
    if (!target) return;

    const selector = generateSelector(target);
    const timing = anim.effect?.getTiming ? anim.effect.getTiming() : {};
    const animName =
      anim.animationName ||
      (anim.id && anim.id !== "" ? anim.id : "waapi_or_transition");
    const uniqueKey = `${selector}__${animName}`;

    if (registry.animations.has(uniqueKey)) return;

    const durationMs =
      typeof timing.duration === "number"
        ? `${timing.duration}ms`
        : timing.duration ?? "unknown";
    const delayMs =
      typeof timing.delay === "number"
        ? `${timing.delay}ms`
        : timing.delay ?? "0ms";

    registry.animations.set(uniqueKey, {
      selector,
      name: animName,
      type: anim.animationName
        ? "CSS Keyframe Animation"
        : "WAAPI / CSS Transition",
      duration: durationMs,
      delay: delayMs,
      easing: timing.easing || "linear",
      fill: timing.fill || "none",
      iterations: timing.iterations ?? 1,
      direction: timing.direction || "normal",
      keyframes: extractKeyframes(anim.effect),
      capturedAt: Date.now() - registry.startTime + "ms"
    });

    updateHUD();
  }

  /** Snapshot all currently running animations via WAAPI. */
  function snapshotAnimations() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(registerAnimation);
  }

  // ── 4. Event listeners (capture phase so we see everything) ───────────────
  [
    "animationstart",
    "animationiteration",
    "transitionrun",
    "transitionstart"
  ].forEach((evtName) => {
    window.addEventListener(
      evtName,
      () => snapshotAnimations(),
      { capture: true, passive: true }
    );
  });

  // ── 5. 12-second polling window (catches GSAP / JS-driven animations) ─────
  const pollInterval = setInterval(snapshotAnimations, 100);
  setTimeout(() => clearInterval(pollInterval), 12_000);

  // ── 6. Scroll & hover capture (post-load entrance animations) ─────────────
  window.addEventListener("scroll", snapshotAnimations, { passive: true });
  window.addEventListener("mouseover", snapshotAnimations, { passive: true });

  // ── 7. Stylesheet @keyframes scraper ─────────────────────────────────────
  /**
   * Walk all accessible document.styleSheets and pull out @keyframes text.
   * Cross-origin sheets are silently skipped (CORS restriction).
   */
  function extractDeclaredKeyframes() {
    const keyframes = [];
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule) {
            keyframes.push({
              name: rule.name,
              cssText: rule.cssText
            });
          }
        }
      } catch (_) {
        // Cross-origin sheet — cannot read cssRules; skip gracefully
      }
    }
    return keyframes;
  }

  // ── 8. HUD ────────────────────────────────────────────────────────────────
  function updateHUD() {
    const btn = document.getElementById("grabx-hud-btn");
    if (btn) {
      btn.textContent = `⚡ GrabX  (${registry.animations.size})`;
    }
  }

  function mountHUD() {
    if (document.getElementById("grabx-hud-btn")) return;

    const btn = document.createElement("button");
    btn.id = "grabx-hud-btn";
    btn.textContent = `⚡ GrabX  (${registry.animations.size})`;

    btn.addEventListener("click", async () => {
      const payload = {
        meta: {
          domain: registry.domain,
          exportedAt: new Date().toISOString(),
          captureWindowMs: Date.now() - registry.startTime,
          totalRecorded: registry.animations.size
        },
        animations: Array.from(registry.animations.values()),
        stylesheetKeyframes: extractDeclaredKeyframes()
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      try {
        await navigator.clipboard.writeText(jsonStr);
        btn.textContent = "✔ Copied!";
        btn.dataset.state = "success";
        setTimeout(() => {
          delete btn.dataset.state;
          updateHUD();
        }, 2000);
      } catch (err) {
        console.error("[GrabX] Clipboard write failed:", err);
        btn.textContent = "✖ Copy Failed";
        btn.dataset.state = "error";
        setTimeout(() => {
          delete btn.dataset.state;
          updateHUD();
        }, 2000);
      }
    });

    // Mount as soon as body is available
    (document.body || document.documentElement).appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountHUD);
  } else {
    mountHUD();
  }

  // Initial snapshot right away (frame 0 — before any scripts have run)
  snapshotAnimations();
})();
