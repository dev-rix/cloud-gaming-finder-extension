# Cloud Gaming Finder

Chromium MV3 extension that shows positive cloud-gaming availability on product pages at Steam, Loaded, GOG, Humble Bundle, and Epic Games Store.

## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the project directory containing `manifest.json`.
4. After clicking the extension's **Reload** button, reload any already-open store tabs as well.

## Architecture

- `src/background.js` owns published catalog retrieval and 24-hour local caching; it includes entries marked `available` and keeps using the last successful local copy if a refresh fails.
- `src/catalog-config.js` contains the single published catalog manifest URL.
- `src/content.js` contains store adapters, title normalization, provider matching, and positive-only rendering logic.
- Adding a store means registering a hostname matcher, product-page detector, title selectors, and a title extractor in `STORE_ADAPTERS`.
- Store adapters identify the product and title; provider catalogs decide whether to show service badges. Matching prefers provider/store IDs when available, then canonical titles and aliases. DLC/expansion-style products are ignored.

The extension intentionally does not call NVIDIA, open hidden tabs, or run provider discovery. The catalog repository does that work. This keeps browser permissions small and makes the extension a deterministic catalog consumer.

## Adding a store

Add one adapter to `STORE_ADAPTERS` in `src/content.js`, then add its match pattern to `content_scripts.matches` in `manifest.json`. An adapter should provide:

- `id`: stable store identifier, such as `epic`.
- `matches`: hostname regular expression.
- `isProductPage()`: URL-level product-page check.
- `selectors`: ordered visible title selectors, with metadata selectors last.
- `title()`: title extraction function.
- `getProductId()`: optional store-specific ID for stronger matching.

Do not put cloud-provider logic in a store adapter.

## Adding a provider later

The extension already loads every available provider listed in the catalog manifest. `VISIBLE_PROVIDER_IDS` and `PROVIDER_LABELS` in `src/content.js` control which providers are currently shown; the MVP enables only `geforce-now`. Provider records can carry aliases, `storeIds`, and metadata without changing store adapters.

## Catalog integration

The companion `cloud-gaming-finder-catalog` repository is organized around provider-neutral catalog files. `src/catalog-config.js` points to its raw `catalog/manifest.json`; the extension then loads the provider files listed by the manifest. The extension caches the last successful catalog locally.

The GeForce NOW provider is refreshed by a Playwright job that reads NVIDIA's live games page. The extension does not contact NVIDIA directly; it only consumes the published GitHub catalog.

The matcher is intentionally conservative: store/provider IDs when available, then normalized title matching with platform/launcher cleanup and provider aliases. A production release should add regional availability, confidence scoring, and automated fixtures for each store before expanding to search pages.

## Local development

After editing the extension, reload it at `chrome://extensions` and refresh open store tabs. The options page can force a catalog refresh. The companion catalog repository owns the daily provider update and publishes the files consumed by this extension.
