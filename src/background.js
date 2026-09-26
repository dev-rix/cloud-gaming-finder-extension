import { CATALOG_MANIFEST_URL } from "./catalog-config.js";
import "./normalize.js";

// The service worker is deliberately catalog-only. It never contacts a game
// provider directly and never opens helper tabs; the catalog repository owns
// provider discovery and publishing.
const CACHE_KEY = "publishedCatalogV1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Sanity bounds on published data. The real catalog is far below these; they
// only stop a broken or tampered catalog from filling local storage.
const MAX_GAMES_PER_PROVIDER = 50000;
const MAX_TITLE_LENGTH = 300;

// Provider files must live next to the manifest in the catalog repository.
const CATALOG_BASE_URL = new URL("./", CATALOG_MANIFEST_URL).href;

function providerFileUrl(provider) {
  const url = new URL(provider.file, CATALOG_MANIFEST_URL);
  if (typeof provider.file !== "string" || !url.href.startsWith(CATALOG_BASE_URL)) {
    throw new Error(`Published ${provider.id} catalog path is outside the catalog: ${provider.file}`);
  }
  return url;
}

function publishedGames(value, providerId) {
  if (!value || value.provider !== providerId || !Array.isArray(value.games)) return [];
  if (value.games.length > MAX_GAMES_PER_PROVIDER) {
    throw new Error(`Published ${providerId} catalog is too large: ${value.games.length} games`);
  }
  return value.games
    .filter((game) => game.status === "available" && typeof game.title === "string" &&
      game.title && game.title.length <= MAX_TITLE_LENGTH)
    .map((game) => ({
      title: game.title,
      normalizedTitle: normalizeTitle(game.title),
      aliases: Array.isArray(game.aliases) ? game.aliases.map(normalizeTitle).filter(Boolean) : [],
      provider: providerId,
      store: Array.isArray(game.stores) ? game.stores.join(", ") : "",
      storeIds: game.storeIds || {},
      status: "AVAILABLE",
      metadata: game.metadata || {}
    }));
}

async function loadPublishedCatalog() {
  // The manifest is the extension's provider registry. Each provider can be
  // updated independently while keeping the extension's data contract stable.
  const manifestResponse = await fetch(CATALOG_MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Published catalog manifest failed: ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (manifest?.schemaVersion !== "1" || !Array.isArray(manifest.providers)) {
    throw new Error("Published catalog manifest has an unsupported schema");
  }

  const catalogs = await Promise.all(manifest.providers
    .filter((provider) => provider.status === "available" && provider.file)
    .map(async (provider) => {
      const url = providerFileUrl(provider);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Published ${provider.id} catalog failed: ${response.status}`);
      return publishedGames(await response.json(), provider.id);
    }));
  const games = catalogs.flat();
  if (!games.length) throw new Error("Published catalog contained no available games");
  return games;
}

async function loadCatalog(force = false) {
  const cached = await chrome.storage.local.get(CACHE_KEY);
  const cachedEntry = cached[CACHE_KEY];
  if (!force && cachedEntry && Array.isArray(cachedEntry.games)
      && Date.now() - cachedEntry.fetchedAt < CACHE_TTL_MS) {
    return cachedEntry.games;
  }

  try {
    const games = await loadPublishedCatalog();
    await chrome.storage.local.set({
      [CACHE_KEY]: { fetchedAt: Date.now(), games }
    });
    return games;
  } catch (error) {
    // A temporary GitHub/provider outage should not remove already-known
    // positive badges. A first install still fails cleanly with ok: false.
    if (cachedEntry && Array.isArray(cachedEntry.games) && cachedEntry.games.length) {
      return cachedEntry.games;
    }
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "getCatalog") return;
  loadCatalog(Boolean(message.force))
    .then((games) => sendResponse({ ok: true, games, fetchedAt: Date.now() }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
