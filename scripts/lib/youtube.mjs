// YouTube channels via their free RSS feed. Channel IDs are resolved from
// the channel page when only a URL / handle is configured.

import { fetchText } from './http.mjs';
import { parseFeed } from './rss.mjs';
import { truncate, decodeEntities } from './text.mjs';

export function extractChannelInfo(html) {
  const id =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ||
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ||
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1] ||
    /channel_id=(UC[\w-]{22})/.exec(html)?.[1] ||
    null;
  const avatar = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] || null;
  const title = /<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] || null;
  const description = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] || '';
  return { id, avatar: avatar && decodeEntities(avatar), title: title && decodeEntities(title), description: decodeEntities(description) };
}

export async function resolveChannel(channel) {
  if (channel.channelId && channel.avatar) return { id: channel.channelId, avatar: channel.avatar };
  const pageUrl = channel.url || `https://www.youtube.com/channel/${channel.channelId}`;
  // CONSENT cookie avoids the EU consent interstitial.
  const { text } = await fetchText(pageUrl, { headers: { Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
  const info = extractChannelInfo(text);
  const id = channel.channelId || info.id;
  if (!id) throw new Error(`ID de chaîne introuvable pour ${pageUrl}`);
  return { id, avatar: info.avatar, description: info.description };
}

export async function channelVideos(channel, resolved) {
  const { text } = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${resolved.id}`);
  const feed = parseFeed(text);
  return feed.entries.map((e) => {
    const videoId = e.raw['yt:videoId'] || /v=([\w-]{11})/.exec(e.link)?.[1];
    const isShort = /\/shorts\//.test(e.link);
    return {
      id: 'y-' + videoId,
      kind: 'video',
      platform: 'youtube',
      source: {
        id: 'yt:' + resolved.id,
        name: channel.name,
        avatar: resolved.avatar || null,
        url: `https://www.youtube.com/channel/${resolved.id}`,
        ...(channel.suggested ? { suggested: true } : {}),
      },
      title: truncate(e.title, 200),
      // The channel feed carries the description (media:group/media:description): shown when the reel is expanded.
      text: truncate(e.text, 500),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      image: e.image || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      video: { type: 'youtube', src: videoId, poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, aspect: isShort ? 9 / 16 : 16 / 9 },
      publishedAt: e.publishedAt,
    };
  });
}
