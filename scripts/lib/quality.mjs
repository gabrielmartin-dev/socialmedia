// Per-source quality of what a feed gives (status.json and the collection log): share of
// items with a picture, average summary length, entries without date (dropped, unless the
// archive dates them). Measured before any og:image enrichment, i.e. what the feed itself gives.

export function quality(items) {
  const n = items.length;
  if (!n) return { withImage: 0, avgText: 0, undated: 0 };
  const withImage = items.filter((i) => i.image).length;
  const textLen = items.reduce((s, i) => s + (i.text || '').length, 0);
  return {
    withImage: Math.round((withImage / n) * 100),
    avgText: Math.round(textLen / n),
    undated: items.filter((i) => !i.publishedAt).length,
  };
}
