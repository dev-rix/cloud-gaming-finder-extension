// Shared title normalization for the service worker (imported as a module)
// and the content script (loaded first in content_scripts). Both sides must
// normalize identically or catalog titles silently stop matching.
globalThis.normalizeTitle = function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
};
