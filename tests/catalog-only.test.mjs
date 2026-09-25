import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = read('addon/manifest.json');

test('every advertised catalog is static, usable, and contains no playback fields', () => {
  assert.deepEqual(manifest.resources, ['catalog']);
  assert.deepEqual(manifest.types, ['movie', 'series']);
  assert.equal(manifest.catalogs.length, 76);
  assert.equal(fs.existsSync(path.join(root, 'addon/stream')), false);
  const keys = new Set();
  let entries = 0;
  for (const catalog of manifest.catalogs) {
    const key = `${catalog.type}/${catalog.id}`;
    assert.equal(keys.has(key), false, `duplicate ${key}`);
    keys.add(key);
    assert.equal(catalog.extra, undefined, 'static catalogs must not advertise unavailable search/pagination');
    const payload = read(`addon/catalog/${key}.json`);
    assert.ok(payload.metas.length > 0, `empty ${key}`);
    for (const meta of payload.metas) {
      assert.match(meta.id, /^tt\d{5,12}$/);
      assert.equal(meta.type, catalog.type);
      assert.ok(meta.name);
      assert.match(meta.poster, /^https:\/\//);
      for (const field of ['streams', 'url', 'externalUrl', 'infoHash', 'sources', 'videos']) {
        assert.equal(meta[field], undefined, `${key} contains ${field}`);
      }
    }
    entries += payload.metas.length;
  }
  assert.equal(entries, 748, 'preserve all existing catalog entries');
});

test('optional Worker works with outbound networking disabled and has no playback routes', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('network disabled: no hub or upstream is available');
  };
  try {
    const { default: worker } = await import('../worker.js');
    const request = pathname => worker.fetch(new Request(`https://catalog.test${pathname}`));
    const response = await request('/manifest.json');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await response.json(), manifest);
    for (const c of manifest.catalogs) {
      const pathname = `/catalog/${c.type}/${c.id}.json`;
      const result = await request(pathname);
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), read(`addon${pathname}`));
    }
    for (const pathname of [
      '/stream/movie/tt1190080.json',
      '/stream/series/tt0903747:1:1.json',
      '/stream/movie/cine:1:123.json',
      '/catalog/movie/cine-all-movies.json',
      '/catalog/movie/cine-search-movie/search=test.json',
    ]) assert.equal((await request(pathname)).status, 404, pathname);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
