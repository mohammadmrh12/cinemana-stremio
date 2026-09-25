# Cinematic+ Catalogs

Standalone **catalog-only** Stremio addon. It serves the 76 existing curated
movie and series collections directly from this public repository. No home hub,
Mac, Cinematic+ backend, account, API key or running Worker is required.

## Install

Paste this URL into Stremio's addon search/install field:

https://raw.githubusercontent.com/mohammadmrh12/cinemana-stremio/main/addon/manifest.json

Remove the old Cinemana/Cinematic addon if it still advertises streams, then
install this URL. This addon declares only `catalog`; it does not supply
playback links. Standard IMDb IDs are preserved for Stremio's normal details
pages and other independently installed addons.

The collections are the checked-in curated lists, not a live search of the
entire Cinemana library. Their titles and order are preserved. The five source
entries without IMDb IDs remain omitted, as they were in the previous static
catalogs; no replacement title is guessed.

## Update collections

Edit `catalogs-source.json`, then run:

```sh
node tools/refresh.mjs
node --test tests/catalog-only.test.mjs
```

Commit the source and regenerated `addon/` files together. The build makes no
network requests and removes obsolete playback files. `worker.js` is an
optional catalog-only hosting adapter using the same source; installing the
static URL above does not depend on its deployment.
