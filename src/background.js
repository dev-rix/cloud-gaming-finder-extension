import { CATALOG_MANIFEST_URL } from "./catalog-config.js";

const CACHE_KEY = "publishedCatalogV1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function publishedGames(value, providerId) {
  if (!value || value.provider !== providerId || !Array.isArray(value.games)) return [];
  return value.games
    .filter((game) => game.status === "available" && game.title)
    .map((game) => ({
      title: game.title,
      normalizedTitle: normalize(game.title),
      aliases: Array.isArray(game.aliases) ? game.aliases.map(normalize).filter(Boolean) : [],
      provider: providerId,
      store: Array.isArray(game.stores) ? game.stores.join(", ") : "",
      storeIds: game.storeIds || {},
      status: "AVAILABLE",
      metadata: game.metadata || {}
    }));
}

async function loadPublishedCatalog() {
  const manifestResponse = await fetch(CATALOG_MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Published catalog manifest failed: ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (manifest?.schemaVersion !== "1" || !Array.isArray(manifest.providers)) {
    throw new Error("Published catalog manifest has an unsupported schema");
  }

  const catalogs = await Promise.all(manifest.providers
    .filter((provider) => provider.status === "available" && provider.file)
    .map(async (provider) => {
      const url = new URL(provider.file, CATALOG_MANIFEST_URL);
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
