// Defence in depth: whatever a feed, RSSHub or Bluesky hands us, only http(s)
// URLs reach the generated JSON (and therefore href / src in the app).

import { safeUrl } from '../../public/url.js';

const clean = (obj, key) => {
  if (!obj || obj[key] == null) return;
  const u = safeUrl(obj[key]);
  if (u) obj[key] = u; else obj[key] = null;
};

/** Mutates and returns the item, or null when it has no usable link. */
export function sanitizeItem(item) {
  item.url = safeUrl(item.url);
  if (!item.url) return null;
  clean(item, 'image');
  if (item.source) { clean(item.source, 'avatar'); clean(item.source, 'url'); }
  if (item.images) {
    item.images = item.images
      .map((i) => ({ ...i, thumb: safeUrl(i.thumb), full: safeUrl(i.full) }))
      .filter((i) => i.thumb || i.full)
      .map((i) => ({ ...i, thumb: i.thumb || i.full, full: i.full || i.thumb }));
    if (!item.images.length) item.images = undefined;
  }
  if (item.external) {
    const url = safeUrl(item.external.url);
    item.external = url ? { ...item.external, url, thumb: safeUrl(item.external.thumb) } : undefined;
  }
  if (item.video) {
    const src = item.video.type === 'hls' ? safeUrl(item.video.src) : item.video.src;
    // YouTube / TikTok ids are interpolated into fixed embed URLs by the client.
    if (!src) item.video = undefined;
    else item.video = { ...item.video, src, poster: safeUrl(item.video.poster) };
  }
  if (item.quote) {
    const url = safeUrl(item.quote.url);
    item.quote = url ? { ...item.quote, url, avatar: safeUrl(item.quote.avatar), image: safeUrl(item.quote.image) } : undefined;
  }
  if (item.segments) {
    item.segments = item.segments.map((s) => {
      if (!s.href) return s;
      const href = safeUrl(s.href);
      return href ? { ...s, href } : { t: s.t };
    });
  }
  if (!item.image && !item.images) item.image = null;
  return item;
}
