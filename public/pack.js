// Compact on-disk format of public/data/{actus,tech,videos}.json, shared by the
// collector (packFeed) and the app (unpackFeed). No Node API here.
//
// What is factored out (all of it is restored by unpackFeed, so the rest of the app
// keeps working on plain items):
//  - `source` objects repeated on every item   → file-level `sources` table + item.s
//  - keywords [{k,w,t}] repeated on every item → file-level `kw` table + item.kw (names)
//  - `text` when it is exactly the concatenation of `segments`
//  - `image` when it is the first image / link thumbnail, `images[].full` when it is the
//    usual Bluesky thumbnail → fullsize rewrite, YouTube `video.poster`.

export const PACK_VERSION = 2;

const THUMB = '/feed_thumbnail/';
const FULL = '/feed_fullsize/';
const fullOf = (thumb) => (typeof thumb === 'string' ? thumb.replace(THUMB, FULL) : thumb);
const ytPoster = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const derivedImage = (it) => it.images?.[0]?.thumb || it.external?.thumb || null;

const eachItem = (entries, fn) => {
  for (const e of entries) {
    if (e.kind === 'group') e.items.forEach(fn); else fn(e);
  }
};

/** Returns a new, compact copy of a feed document ({ entries, ...meta }). */
export function packFeed(doc) {
  const sources = {};
  const kw = {};
  const clone = structuredClone(doc);
  eachItem(clone.entries, (it) => {
    const src = it.source;
    if (src) {
      const known = sources[src.id];
      if (!known) { const { id, ...rest } = src; sources[id] = rest; it.s = id; delete it.source; }
      else if (JSON.stringify(known) === JSON.stringify((({ id, ...rest }) => rest)(src))) { it.s = src.id; delete it.source; }
    }
    if (it.keywords) {
      it.kw = it.keywords.map((k) => {
        const cur = kw[k.k];
        if (!cur) { kw[k.k] = [k.w, k.t]; return k.k; }
        return cur[0] === k.w && cur[1] === k.t ? k.k : k;
      });
      delete it.keywords;
    }
    if (it.segments?.length && it.text === it.segments.map((s) => s.t).join('')) delete it.text;
    if (it.image && it.image === derivedImage(it)) delete it.image;
    if (it.images) for (const i of it.images) if (i.full === fullOf(i.thumb) && i.full !== i.thumb) delete i.full;
    if (it.video?.type === 'youtube' && it.video.poster === ytPoster(it.video.src)) delete it.video.poster;
  });
  return { ...clone, v: PACK_VERSION, sources, kw };
}

/** Restores plain items in place (no-op on documents without `v`). Returns the document. */
export function unpackFeed(doc) {
  if (!doc || doc.v !== PACK_VERSION || !Array.isArray(doc.entries)) return doc;
  const { sources = {}, kw = {} } = doc;
  eachItem(doc.entries, (it) => {
    if (it.s !== undefined) { it.source = { id: it.s, ...sources[it.s] }; delete it.s; }
    if (it.kw) {
      it.keywords = it.kw.map((k) => (typeof k === 'string' ? { k, w: kw[k]?.[0], t: kw[k]?.[1] } : k)).filter((k) => k.w !== undefined);
      delete it.kw;
    }
    if (it.text === undefined && it.segments) it.text = it.segments.map((s) => s.t).join('');
    if (it.image === undefined) it.image = derivedImage(it);
    if (it.images) for (const i of it.images) if (i.full === undefined) i.full = fullOf(i.thumb);
    if (it.video?.type === 'youtube' && it.video.poster === undefined) it.video.poster = ytPoster(it.video.src);
  });
  delete doc.sources; delete doc.kw; delete doc.v;
  return doc;
}
