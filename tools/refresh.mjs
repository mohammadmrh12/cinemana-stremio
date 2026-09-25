import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogPayload, createManifest } from '../lib/catalogs.mjs';

// Build the checked-in collections locally. A hub, Cinemana connection,
// API key and media/episode downloads are deliberately unnecessary.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'addon');
const catalogs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogs-source.json'), 'utf8'));
const keys = new Set();
for (const c of catalogs) {
  if (!['movie', 'series'].includes(c.type) || !/^[a-z0-9-]+$/.test(c.id) || !c.title || !Array.isArray(c.members)) {
    throw new Error('Invalid catalog definition');
  }
  const key = `${c.type}/${c.id}`;
  if (keys.has(key)) throw new Error(`Duplicate catalog: ${key}`);
  keys.add(key);
}

const payloads = catalogs.map(c => ({ catalog: c, payload: catalogPayload(c) }));
// All output is generated. Rebuild it so old stream files cannot survive.
fs.rmSync(OUT, { recursive: true, force: true });
function writeJson(relativePath, data) {
  const target = path.join(OUT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
}
writeJson('manifest.json', createManifest(catalogs));
for (const { catalog: c, payload } of payloads) {
  writeJson(`catalog/${c.type}/${c.id}.json`, payload);
}
fs.writeFileSync(path.join(OUT, 'index.html'), 'Cinematic+ Catalogs — install manifest.json in Stremio. Catalogs only.\n');
const metas = payloads.flatMap(x => x.payload.metas);
const stats = {
  version: '3.0.0',
  catalogOnly: true,
  catalogs: catalogs.length,
  movieCatalogs: catalogs.filter(c => c.type === 'movie').length,
  seriesCatalogs: catalogs.filter(c => c.type === 'series').length,
  entries: metas.length,
  uniqueTitles: new Set(metas.map(m => `${m.type}/${m.id}`)).size,
  unresolvedEntries: catalogs.reduce((n, c) => n + c.members.length, 0) - metas.length,
};
writeJson('stats.json', stats);
console.log(JSON.stringify(stats));
