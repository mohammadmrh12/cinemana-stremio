// Shared by the offline builder and the optional Worker. No network requests.
export function catalogPayload(catalog) {
  return {
    metas: (catalog.members || []).flatMap(member => {
      const id = String(member.imdb || '').match(/^tt\d{5,12}$/i)?.[0]?.toLowerCase();
      // Keep the existing IMDb IDs so Stremio can open its normal details page.
      if (!id) return [];
      return [{
        id,
        type: catalog.type,
        name: String(member.title || id),
        poster: `https://images.metahub.space/poster/medium/${id}/img`,
        background: `https://images.metahub.space/background/medium/${id}/img`,
        ...(member.year ? { releaseInfo: String(member.year) } : {}),
      }];
    }),
  };
}

export function createManifest(catalogs) {
  return {
    id: 'com.mohammad.cinemana.stremio.static',
    version: '3.0.0',
    name: 'Cinematic+ Catalogs',
    description: 'كاتلوكات Cinematic+ للأفلام والمسلسلات فقط. بدون روابط تشغيل وبدون الحاجة إلى هب أو سيرفر منزلي.',
    types: ['movie', 'series'],
    resources: ['catalog'],
    catalogs: catalogs.map(c => ({ type: c.type, id: c.id, name: c.title })),
    behaviorHints: { configurable: false, p2p: false, adult: false },
  };
}
