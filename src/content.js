// Store adapters only identify product pages and extract titles/IDs. They do
// not know which cloud services exist; provider catalogs make that decision.
const STORE_ADAPTERS = [
  {
    id: "steam",
    matches: /(^|\.)steampowered\.com$/,
    selectors: [".apphub_AppName", "#appHubAppName"],
    isProductPage: () => /^\/app\/\d+/.test(location.pathname),
    getProductId: () => location.pathname.match(/^\/app\/(\d+)/)?.[1] || null,
    title: () => document.querySelector(".apphub_AppName")?.textContent || document.querySelector("#appHubAppName")?.textContent
  },
  {
    id: "loaded",
    matches: /(^|\.)loaded\.com$/,
    selectors: ["h1", "[data-testid*='title']", "meta[property='og:title']"],
    // Loaded product URLs are usually a single root-level slug, optionally
    // preceded by a locale (for example /es_es/ghostrunner-pc-gog).
    isProductPage: () => {
      const path = location.pathname.replace(/^\//, "").replace(/\/$/, "");
      const segments = path.split("/");
      if (segments.length === 1 && /^[a-z]{2}_[a-z]{2}$/i.test(segments[0])) return false;
      if (segments.length === 2 && /^[a-z]{2}_[a-z]{2}$/i.test(segments[0])) segments.shift();
      return segments.length === 1 && Boolean(segments[0]) &&
        !/^(explore|payday|search|cart|account|login|register|gift-ideas|about|help|blog)$/i.test(segments[0]);
    },
    getProductId: () => location.pathname,
    title: () => document.querySelector("h1")?.textContent || document.querySelector("[data-testid*='title']")?.textContent || document.querySelector("meta[property='og:title']")?.content
  },
  {
    id: "gog",
    matches: /(^|\.)gog\.com$/,
    selectors: ["h1", ".productcard-basics__title", "meta[property='og:title']"],
    isProductPage: () => /\/game\//i.test(location.pathname),
    getProductId: () => location.pathname,
    title: () => document.querySelector("h1")?.textContent || document.querySelector(".productcard-basics__title")?.textContent || document.querySelector("meta[property='og:title']")?.content
  },
  {
    id: "epic",
    matches: /(^|\.)store\.epicgames\.com$/,
    selectors: ["h1", "[data-testid*='title']", "meta[property='og:title']"],
    isProductPage: () => /\/p\//i.test(location.pathname),
    getProductId: () => location.pathname,
    title: () => document.querySelector("h1")?.textContent || document.querySelector("[data-testid*='title']")?.textContent || document.querySelector("meta[property='og:title']")?.content || document.title
  },
  {
    id: "humble",
    matches: /(^|\.)humblebundle\.com$/,
    selectors: ["h1", "[data-testid='product-title']", "[class*='product-title']", "[class*='ProductTitle']", "main h1", "meta[property='og:title']"],
    isProductPage: () => /\/(store|games|software)\//i.test(location.pathname),
    getProductId: () => location.pathname,
    title: () => document.querySelector("h1")?.textContent || document.querySelector("[data-testid='product-title']")?.textContent || document.querySelector("[class*='product-title']")?.textContent || document.querySelector("[class*='ProductTitle']")?.textContent || document.querySelector("meta[property='og:title']")?.content || document.title
  }
];

function hasUnsupportedProductType(title) {
  return /\b(dl[cs]|expansion|soundtrack|season pass|currency|points|upgrade bundle|add[- ]?on)\b/i.test(title);
}

function titleCandidates(title) {
  const normalized = normalizeTitle(title);
  const candidates = new Set([normalized]);
  const platformTitle = normalized
    .replace(/\b(pc|windows|mac|linux|steam|gog|epic|ea app|ubisoft connect|xbox|playstation)\b/g, " ")
    .replace(/\b(cd key|digital key|game key|key|download|code)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (platformTitle) candidates.add(platformTitle);

  const base = platformTitle
    .replace(/\b(standard|base|deluxe|premium|ultimate|definitive|complete|enhanced|gold|legendary|game of the year|goty) edition\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (base) candidates.add(base);
  const colonBase = base.split(" : ")[0].trim();
  if (colonBase) candidates.add(colonBase);
  return [...candidates];
}

function currentAdapter() {
  return STORE_ADAPTERS.find((adapter) => adapter.matches.test(location.hostname));
}

function titleFor(adapter) {
  const raw = adapter?.title?.();
  if (!raw) return "";
  return String(raw)
    .replace(/^\s*buy\s+/i, "")
    .replace(/\s+from\s+the\s+Humble\s+Store\s*$/i, "")
    .replace(/\s*[|–—-]\s*Humble\s+Store\s*$/i, "")
    .replace(/\s+Humble\s+Store\s*$/i, "")
    .replace(/\s+\d+%\s+off\b.*$/i, "")
    .replace(/\s*[|–—-]\s*(Steam|GOG|Epic Games Store|Humble Bundle|Loaded).*$/i, "")
    .replace(/\s*\((Standard|Base|PC) Edition\)$/i, "")
    .trim();
}

// Keep the catalog/provider model extensible while exposing only the MVP
// provider in the UI. Enabling another provider later is intentionally a
// small configuration change rather than a rewrite of matching/rendering.
const VISIBLE_PROVIDER_IDS = new Set(["geforce-now"]);
const PROVIDER_LABELS = {
  "geforce-now": "GeForce NOW"
};

function removeExisting() {
  document.querySelectorAll("[data-cloudready-badge]").forEach((node) => node.remove());
}

function addBadges(adapter, title, providerIds) {
  if (!providerIds.length) return;
  removeExisting();
  const target = adapter.selectors
    .map((selector) => document.querySelector(selector))
    .find((element) => element && element.tagName !== "META" && element.getClientRects().length);
  for (const providerId of providerIds) {
    const badge = document.createElement("span");
    badge.dataset.cloudreadyBadge = "true";
    badge.dataset.provider = providerId;
    badge.className = "cloudready-badge is-available";
    badge.textContent = PROVIDER_LABELS[providerId] || providerId;
    badge.title = `${title} is listed in the ${badge.textContent} catalog`;
    if (target?.parentElement) {
      target.parentElement.appendChild(badge);
    } else {
      badge.classList.add("fallback-placement");
      document.body?.appendChild(badge);
    }
  }
}

function gameMatches(game, candidates, adapter, productId) {
  // IDs are preferred because titles can be shared by editions or remakes.
  // Normalized titles and aliases remain the provider-neutral fallback.
  if (productId && game.storeIds?.[adapter.id] === productId) return true;
  const names = [game.normalizedTitle, ...(Array.isArray(game.aliases) ? game.aliases : [])].filter(Boolean);
  return names.some((name) => candidates.has(name));
}

async function render() {
  if (extensionInvalidated) return;
  const renderUrl = location.href;
  const adapter = currentAdapter();
  if (!adapter || !adapter.isProductPage?.()) {
    removeExisting();
    return;
  }
  const title = titleFor(adapter);
  if (!title || hasUnsupportedProductType(title)) {
    removeExisting();
    return;
  }
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "getCatalog" });
  } catch (error) {
    if (/Extension context invalidated/i.test(String(error?.message || error))) {
      extensionInvalidated = true;
      console.debug("Cloud Gaming Finder: reload this page after reloading the extension.");
      return;
    }
    throw error;
  }
  if (!response?.ok) return;
  if (location.href !== renderUrl) return;
  const candidates = new Set(titleCandidates(title));
  const productId = adapter.getProductId?.();
  const providerIds = [...new Set(response.games
    .filter((game) => gameMatches(game, candidates, adapter, productId))
    .map((game) => game.provider || "geforce-now")
    .filter((providerId) => VISIBLE_PROVIDER_IDS.has(providerId)))];
  removeExisting();
  addBadges(adapter, title, providerIds);
}

let lastUrl = location.href;
let renderScheduled = false;
let extensionInvalidated = false;
function scheduleRender() {
  if (extensionInvalidated || renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => {
    renderScheduled = false;
    render();
  }, 500);
}

const observer = new MutationObserver(() => {
  if (extensionInvalidated) return;
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    removeExisting();
    scheduleRender();
    return;
  }
  const adapter = currentAdapter();
  if (adapter?.isProductPage?.() && !document.querySelector("[data-cloudready-badge]")) scheduleRender();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
render();
