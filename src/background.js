import { CATALOG_MANIFEST_URL } from "./catalog-config.js";

const CATALOG_URL = "https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json";
const LIVE_SERVERINFO_URL = "https://prod.cloudmatchbeta.nvidiagrid.net/v2/serverinfo";
const LIVE_CATALOG_URL = "https://api-prod.nvidia.com/services/gfngames/v1/gameList";
const CACHE_KEY = "gfnCatalogV4";
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

function collectGames(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectGames(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;

  const title = value.title || value.name || value.gameName || value.displayName;
  if (typeof title === "string" && title.length >= 2) {
    const steamUrl = value.steamUrl || value.steamURL || "";
    output.push({
      title,
      normalizedTitle: normalize(title),
      store: value.store || value.appStore || "",
      status: value.status || "",
      steamAppId: steamUrl.match(/\/app\/(\d+)/)?.[1] || null,
      gfnGameId: value.id || value.gameId || null
    });
  }
  for (const child of Object.values(value)) collectGames(child, output);
  return output;
}

function publishedGames(value, providerId) {
  if (!value || value.provider !== providerId || !Array.isArray(value.games)) return [];
  return value.games.filter((game) => game.status === "available" && game.title).map((game) => ({
    title: game.title,
    normalizedTitle: normalize(game.title),
    aliases: Array.isArray(game.aliases) ? game.aliases.map(normalize).filter(Boolean) : [],
    store: Array.isArray(game.stores) ? game.stores.join(", ") : "",
    status: "AVAILABLE",
    steamAppId: game.metadata?.steamAppId || null,
    gfnGameId: game.metadata?.gfnGameId || game.id || null
  }));
}

async function loadPublishedCatalog() {
  if (CATALOG_MANIFEST_URL.includes("YOUR_GITHUB_OWNER")) return [];
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
  return catalogs.flat();
}

async function loadCatalog(force = false) {
  const cached = await chrome.storage.local.get(CACHE_KEY);
  const cachedEntry = cached[CACHE_KEY];
  if (!force && cachedEntry && Array.isArray(cachedEntry.games)
      && Date.now() - cachedEntry.fetchedAt < CACHE_TTL_MS) {
    return cachedEntry.games;
  }

  try {
    const published = await loadPublishedCatalog();
    const response = published.length ? null : await fetch(CATALOG_URL, { cache: "no-store" });
    if (published.length) {
      await chrome.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), games: published } });
      return published;
    }
    if (!response.ok) throw new Error(`GFN catalog request failed: ${response.status}`);
    const data = await response.json();
    const games = collectGames(data).filter((game) =>
      game.normalizedTitle && (!game.status || game.status === "AVAILABLE")
    );
    const uniqueGames = [...new Map(games.map((game) => [
      `${game.store}:${game.steamAppId || game.normalizedTitle}`,
      game
    ])).values()];
    if (!uniqueGames.length) throw new Error("GFN catalog contained no recognizable games");

    await chrome.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), games: uniqueGames } });
    return uniqueGames;
  } catch (error) {
    // Keep the extension useful during a provider outage. The options page can
    // still be used to retry, while product pages use the last known catalog.
    if (cachedEntry && Array.isArray(cachedEntry.games) && cachedEntry.games.length) {
      return cachedEntry.games;
    }
    throw error;
  }
}

function escapeQueryString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function lookupLiveDirect(searchTitle) {
  const serverInfoResponse = await fetch(LIVE_SERVERINFO_URL, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store"
  });
  if (!serverInfoResponse.ok) throw new Error(`GFN server info request failed: ${serverInfoResponse.status}`);
  const serverInfo = await serverInfoResponse.json();
  const serverId = serverInfo?.requestStatus?.serverId;
  if (!serverId) throw new Error("GFN server info did not include a server ID");

  const query = `{ apps(country:"US" language:"en_US" orderBy:"itemMetadata.relevance:DESC",sortName:ASC after:"" searchQuery:"${escapeQueryString(searchTitle)}" vpcId:"${escapeQueryString(serverId)}" ) { items { title sortName gfn { playType minimumMembershipTierLabel } variants { appStore publisherName minimumSizeInBytes } } } }`;
  const response = await fetch(LIVE_CATALOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: query,
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`GFN live catalog request failed: ${response.status}`);
  const data = await response.json();
  const items = data?.data?.apps?.items;
  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    title: item.title || item.sortName || "",
    normalizedTitle: normalize(item.title || item.sortName || ""),
    status: "AVAILABLE",
    store: (item.variants || []).map((variant) => variant.appStore).filter(Boolean).join(", "),
    steamAppId: null,
    gfnGameId: null
  })).filter((game) => game.normalizedTitle);
}

async function waitForTabComplete(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out loading NVIDIA games page"));
    }, 20000);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function lookupLiveInNvidiaPage(searchTitle) {
  const tab = await chrome.tabs.create({
    url: "https://www.nvidia.com/en-us/geforce-now/games/",
    active: false
  });
  try {
    await waitForTabComplete(tab.id);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (title) => {
        const normalize = (value) => String(value || "")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .replace(/\s+/g, " ");
        const escape = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        try {
          const serverResponse = await fetch("https://prod.cloudmatchbeta.nvidiagrid.net/v2/serverinfo", {
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            cache: "no-store"
          });
          if (!serverResponse.ok) throw new Error(`GFN server info request failed: ${serverResponse.status}`);
          const serverInfo = await serverResponse.json();
          const serverId = serverInfo?.requestStatus?.serverId;
          if (!serverId) throw new Error("GFN server info did not include a server ID");
          const query = `{ apps(country:"US" language:"en_US" orderBy:"itemMetadata.relevance:DESC",sortName:ASC after:"" searchQuery:"${escape(title)}" vpcId:"${escape(serverId)}" ) { items { title sortName variants { appStore publisherName minimumSizeInBytes } } } }`;
          const response = await fetch("https://api-prod.nvidia.com/services/gfngames/v1/gameList", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: query,
            cache: "no-store"
          });
          if (!response.ok) throw new Error(`GFN page catalog request failed: ${response.status}`);
          const data = await response.json();
          const items = data?.data?.apps?.items;
          if (Array.isArray(items) && items.length) return items;
        } catch (_error) {
          // Fall through to the visible page's own search UI.
        }

        const searchInput = [...document.querySelectorAll("input")].find((input) =>
          /search|game|title/i.test(`${input.placeholder} ${input.getAttribute("aria-label") || ""}`)
        );
        if (!searchInput) return [];
        const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        inputSetter?.call(searchInput, title);
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const pageText = normalize(document.body?.innerText || "");
        const normalizedTitle = normalize(title);
        if (!pageText.includes(normalizedTitle)) return [];
        return [{ title, variants: [] }];
      },
      args: [searchTitle]
    });
    return (result?.result || []).map((item) => ({
      title: item.title || item.sortName || "",
      normalizedTitle: normalize(item.title || item.sortName || ""),
      status: "AVAILABLE",
      store: (item.variants || []).map((variant) => variant.appStore).filter(Boolean).join(", "),
      steamAppId: null,
      gfnGameId: null
    })).filter((game) => game.normalizedTitle);
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function lookupLive(titles) {
  const searchTitles = [...new Set(titles.map(normalize).filter(Boolean))];
  if (!searchTitles.length) return [];
  let lastError;
  for (const searchTitle of searchTitles) {
    try {
      const directGames = await lookupLiveDirect(searchTitle);
      if (directGames.length) return directGames;
    } catch (error) {
      lastError = error;
    }
    try {
      const pageGames = await lookupLiveInNvidiaPage(searchTitle);
      if (pageGames.length) return pageGames;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

function isTrustedStoreSender(sender) {
  try {
    const hostname = new URL(sender?.url || sender?.tab?.url || "").hostname;
    return /(^|\.)steampowered\.com$|(^|\.)loaded\.com$|(^|\.)gog\.com$|(^|\.)humblebundle\.com$/i.test(hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getCatalog") {
    loadCatalog(Boolean(message.force))
    .then((games) => sendResponse({ ok: true, games, fetchedAt: Date.now() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "lookupLive" && isTrustedStoreSender(_sender)) {
    lookupLive(Array.isArray(message.titles) ? message.titles : [])
      .then((games) => sendResponse({ ok: true, games }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
