# Cloud Gaming Finder

Initial Chromium MV3 MVP for showing positive cloud-gaming availability on PC product pages at Steam, Loaded, GOG, and Humble Bundle.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the project directory containing `manifest.json`.
4. After clicking the extension's **Reload** button, reload any already-open store tabs as well.

## Architecture

- `src/background.js` owns catalog retrieval and 24-hour local caching; it includes entries marked `AVAILABLE` and keeps using the last successful local copy if a refresh fails.
- `src/content.js` contains store adapters, product-page/platform checks, and positive-only rendering logic.
- Adding a store means registering a hostname matcher, title selectors, and a title extractor in `STORE_ADAPTERS`.
- The current first pass covers PC product pages on Steam, Loaded, GOG, and Humble Bundle. Humble Store pages are treated as PC by default and explicit console-only pages are ignored. DLC/expansion-style products are ignored.

## Catalog integration

The companion `cloud-gaming-finder-catalog` repository is organized around provider-neutral catalog files. Set `CATALOG_MANIFEST_URL` in `src/catalog-config.js` to that repository's raw `catalog/manifest.json`; the extension then loads the provider files listed by the manifest. Until that URL is configured, it falls back to NVIDIA's original public catalog endpoint.

The initial GeForce NOW source is NVIDIA's public supported-game catalog endpoint. The source is not an official API contract and may omit newer games; catalog updates therefore validate the result size before publishing.

The first matcher is intentionally conservative: normalized title matching with platform/launcher and common edition cleanup. A production release should add stronger store IDs, regional availability, confidence scoring, and tests before expanding to search pages. NVIDIA's older locale catalog may not include every newly released game; use the options page refresh when testing.
