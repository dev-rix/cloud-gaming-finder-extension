# Cloud Gaming Finder

Initial Chromium MV3 MVP for showing positive cloud-gaming availability on product pages at Steam, Loaded, GOG, and Humble Bundle.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the project directory containing `manifest.json`.
4. After clicking the extension's **Reload** button, reload any already-open store tabs as well.

## Architecture

- `src/background.js` owns published catalog retrieval and 24-hour local caching; it includes entries marked `available` and keeps using the last successful local copy if a refresh fails.
- `src/content.js` contains store adapters, product-page/platform checks, and positive-only rendering logic.
- Adding a store means registering a hostname matcher, title selectors, and a title extractor in `STORE_ADAPTERS`.
- The current first pass covers product pages on Steam, Loaded, GOG, and Humble Bundle. Store adapters identify the product and title; provider catalogs decide whether to show service badges. DLC/expansion-style products are ignored.

## Catalog integration

The companion `cloud-gaming-finder-catalog` repository is organized around provider-neutral catalog files. `src/catalog-config.js` points to its raw `catalog/manifest.json`; the extension then loads the provider files listed by the manifest. The extension caches the last successful catalog locally.

The GeForce NOW provider is refreshed by a Playwright job that reads NVIDIA's live games page. The extension does not contact NVIDIA directly; it only consumes the published GitHub catalog.

The first matcher is intentionally conservative: normalized title matching with platform/launcher and common edition cleanup. A production release should add stronger store IDs, regional availability, confidence scoring, and tests before expanding to search pages. NVIDIA's older locale catalog may not include every newly released game; use the options page refresh when testing.
