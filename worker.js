import catalogs from './catalogs-source.json' with { type: 'json' };
import { catalogPayload, createManifest } from './lib/catalogs.mjs';

// Optional hosting adapter. The published static addon needs no Worker or hub.
const manifest = createManifest(catalogs);
const payloads = new Map(catalogs.map(c => [`${c.type}/${c.id}`, catalogPayload(c)]));
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'cache-control': 'public, max-age=300',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD, OPTIONS' } });
    }
    const pathname = new URL(request.url).pathname;
    const reply = (data, status = 200) => new Response(
      request.method === 'HEAD' ? null : JSON.stringify(data), { status, headers },
    );
    if (pathname === '/manifest.json') return reply(manifest);
    if (pathname === '/health') return reply({ ok: true, version: manifest.version, catalogOnly: true });
    if (pathname === '/') return reply({ name: manifest.name, manifest: '/manifest.json' });
    const match = pathname.match(/^\/catalog\/(movie|series)\/([a-z0-9-]+)\.json$/);
    const payload = match && payloads.get(`${match[1]}/${match[2]}`);
    if (payload) return reply(payload);
    // No stream, subtitle, live-search or proxy routes are exposed.
    return reply({ error: 'not_found' }, 404);
  },
};
