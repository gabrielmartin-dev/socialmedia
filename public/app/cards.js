// Feed cards: articles, Bluesky posts, "N médias en parlent" groups.

import { h, svg, ICONS, openUrl } from './dom.js';
import { postUri } from '../bsky.js';
import { avatar, image } from './media.js';
import { loadHls } from './hls.js';
import { state } from './store.js';
import { actions } from './actions.js';
import { clampAspect, truncateText, domainOf } from './util.js';
import { relativeTime } from '../rank.js';
import { safeUrl } from '../url.js';

const TEXT_LIMIT = 280;
const LINKIFY = /(https?:\/\/[^\s]+)|(#[\p{L}\p{N}_]+)|(@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/giu;

export function linkNode(text, href) {
  const u = safeUrl(href, location.href);
  return u ? h('a', { class: 'link', href: u, target: '_blank', rel: 'noopener', text }) : document.createTextNode(text);
}

/** Plain text → nodes, with URLs, #hashtags and @handles in blue. */
export function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(LINKIFY)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [tok] = m;
    if (m[1]) out.push(linkNode(tok.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + (tok.length > 48 ? '…' : ''), tok));
    else if (m[2]) out.push(linkNode(tok, `https://bsky.app/hashtag/${encodeURIComponent(tok.slice(1))}`));
    else out.push(linkNode(tok, `https://bsky.app/profile/${tok.slice(1)}`));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tweet text with links, plus "Voir plus" when long. */
function tweetText(item) {
  const full = item.text || '';
  if (!full) return null;
  const nodes = item.segments?.length
    ? item.segments.map((s) => (s.href ? linkNode(s.t, s.href) : s.t))
    : linkify(full);
  const el = h('div', { class: 'tweet-text' }, nodes);
  if (full.length > TEXT_LIMIT && !item.segments?.length) {
    const short = h('div', { class: 'tweet-text' }, linkify(full.slice(0, TEXT_LIMIT).replace(/\s+\S*$/, '') + '… '),
      h('button', { class: 'see-more', text: 'Voir plus', onclick: (e) => { e.stopPropagation(); short.replaceWith(el); } }));
    return short;
  }
  return el;
}

function tweetHead(entry, { name, handle, publishedAt, url }) {
  const toProfile = entry.kind !== 'group' && entry.source
    ? (e) => { e.stopPropagation(); actions.openProfile(entry.source); }
    : null;
  const time = h('time', { class: 'time', datetime: publishedAt, text: relativeTime(publishedAt) });
  return h('div', { class: 'tweet-head' },
    // A real button when it opens the profile (keyboard + screen readers), plain text otherwise.
    toProfile
      ? h('button', { class: 'name clickable', type: 'button', text: name, onclick: toProfile })
      : h('span', { class: 'name', text: name }),
    handle ? h('span', { class: 'handle', text: handle }) : null,
    h('span', { class: 'dot', text: '·' }),
    // The timestamp is the permalink, like on X: the keyboard way to open the whole card.
    safeUrl(url, location.href)
      ? h('a', { class: 'time-link', href: url, target: '_blank', rel: 'noopener', title: 'Ouvrir l\'original' }, time, h('span', { class: 'sr-only', text: ' — ouvrir l\'original' }))
      : time,
    h('button', { class: 'more', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); actions.openSheet(entry); } }, svg(ICONS.more, 20)),
  );
}

function photoGrid(images, url) {
  const imgs = images.slice(0, 4);
  const gallery = images.map((i) => ({ src: i.full || i.thumb, alt: i.alt }));
  const zoom = (index) => ({ gallery, index, url });
  if (imgs.length === 1) {
    return h('div', { class: 'media', style: `aspect-ratio:${clampAspect(imgs[0].aspect, 1.5)}` }, image(imgs[0].thumb, imgs[0].alt, zoom(0)));
  }
  return h('div', { class: `media grid n${imgs.length}` }, imgs.map((i, n) => image(i.thumb, i.alt, zoom(n))));
}

// ---- Inline video (Bluesky posts in Actus): muted autoplay while visible ----
let inlineObs = null;
const inlineObserver = () => (inlineObs ||= new IntersectionObserver((entries) => {
  for (const e of entries) {
    const box = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && state.view !== 'videos') startInline(box);
    else stopInline(box);
  }
}, { threshold: [0, 0.6] }));

async function startInline(box) {
  if (box._video) return;
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto' });
  video.muted = box._muted !== false;
  box._video = video;
  box.prepend(video);
  if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = box._src;
  else {
    try {
      const Hls = await loadHls();
      if (box._video !== video) return;
      if (Hls?.isSupported()) { box._hls = new Hls({ maxBufferLength: 10 }); box._hls.loadSource(box._src); box._hls.attachMedia(video); }
      else video.src = box._src;
    } catch { return; }
  }
  video.play().then(() => box.classList.add('playing')).catch(() => {});
}

function stopInline(box) {
  if (!box._video) return;
  box._hls?.destroy();
  box._hls = null;
  box._video.pause();
  box._video.remove();
  box._video = null;
  box.classList.remove('playing');
}

export function stopAllInline() {
  document.querySelectorAll('.media.inline-video').forEach(stopInline);
}

function inlineVideo(v) {
  const muteBtn = h('button', { class: 'vid-mute', 'aria-label': 'Son' }, svg(ICONS.muted, 18));
  const box = h('div', { class: 'media inline-video', style: `aspect-ratio:${clampAspect(v.aspect, 16 / 9)}` },
    v.poster ? image(v.poster) : null,
    muteBtn,
  );
  box._src = safeUrl(v.src, location.href);
  if (!box._src) return box;
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box._muted = box._muted === false;
    if (box._video) { box._video.muted = box._muted; box._video.play().catch(() => {}); }
    muteBtn.replaceChildren(svg(box._muted ? ICONS.muted : ICONS.sound, 18));
  });
  inlineObserver().observe(box);
  return box;
}

/** Link card like X: image with the domain in a pill, or a compact card without image. */
function linkCard(url, { title, description, thumb }) {
  const dom = domainOf(url);
  if (thumb) {
    return h('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener' },
      h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(thumb, title || '', { url })),
      h('span', { class: 'link-pill', text: title ? truncateText(title, 70) : dom }),
      title ? h('div', { class: 'link-from', text: `De ${dom}` }) : null,
    );
  }
  return h('a', { class: 'link-card compact', href: url, target: '_blank', rel: 'noopener' },
    h('div', { class: 'link-from', text: dom }),
    title ? h('div', { class: 'link-title', text: title }) : null,
    description ? h('div', { class: 'link-desc', text: description }) : null,
  );
}

function quoteCard(q) {
  return h('a', { class: 'quote', href: q.url, target: '_blank', rel: 'noopener' },
    h('div', { class: 'quote-head' },
      avatar(q.avatar, q.name),
      h('span', { class: 'name', text: q.name }),
      h('span', { class: 'handle', text: '@' + q.handle }),
      q.publishedAt ? h('span', { class: 'dot', text: '·' }) : null,
      q.publishedAt ? h('time', { class: 'time', datetime: q.publishedAt, text: relativeTime(q.publishedAt) }) : null,
    ),
    q.text ? h('div', { class: 'quote-text', text: q.text }) : null,
    q.image ? h('div', { class: 'media', style: 'aspect-ratio:1.78' }, image(q.image, '', { url: q.url })) : null,
  );
}

function cardShell(entry, avatarNode, mainChildren, url) {
  return h('article', {
    class: 'tweet' + (entry.kind === 'group' ? ' group' : ''),
    dataset: { id: entry.id },
    onclick: (e) => {
      if (e.target.closest('a, button')) return;
      if (entry.kind === 'group') {
        const open = e.currentTarget.classList.toggle('open');
        e.currentTarget.querySelector('.group-toggle')?.setAttribute('aria-expanded', String(open));
      } else if (entry.platform === 'bluesky' && postUri(entry.url)) actions.openThread(entry);
      else openUrl(url);
    },
  },
  entry.kind !== 'group'
    ? h('button', {
      class: 'tweet-avatar clickable', type: 'button', 'aria-label': `Voir le profil de ${entry.source.name}`,
      onclick: (e) => { e.stopPropagation(); actions.openProfile(entry.source); },
    }, avatarNode)
    : h('div', { class: 'tweet-avatar' }, avatarNode),
  h('div', { class: 'tweet-main' }, ...mainChildren));
}

function articleCard(item) {
  const dom = domainOf(item.url);
  return cardShell(item, avatar(item.source.avatar, item.source.name, { square: true }), [
    tweetHead(item, { name: item.source.name, handle: dom, publishedAt: item.publishedAt, url: item.url }),
    h('div', { class: 'tweet-text' }, item.title),
    item.text ? h('div', { class: 'tweet-text dim' }, item.text) : null,
    item.image ? linkCard(item.url, { thumb: item.image, title: '' }) : null,
  ], item.url);
}

/** "💬 N" under a Bluesky post: opens its thread (the whole card does too, this is the keyboard path). */
function threadButton(item) {
  if (item.platform !== 'bluesky' || !postUri(item.url)) return null;
  const n = item.stats?.replies || 0;
  return h('div', { class: 'tweet-actions' },
    h('button', {
      class: 'thread-btn', type: 'button', 'aria-label': n ? `Voir le fil, ${n} réponse${n > 1 ? 's' : ''}` : 'Voir le fil',
      onclick: (e) => { e.stopPropagation(); actions.openThread(item); },
    }, svg(ICONS.reply, 18), n ? h('span', { text: String(n) }) : null));
}

function postCard(item) {
  let media = null;
  if (item.video && item.video.type !== 'hls') {
    media = h('a', { class: 'media ext-video', href: item.url, target: '_blank', rel: 'noopener', style: `aspect-ratio:${clampAspect(item.video.aspect, 16 / 9)}` },
      item.video.poster ? image(item.video.poster) : null);
    item = { ...item, text: item.title || item.text, segments: undefined };
  } else if (item.video?.type === 'hls') media = inlineVideo(item.video);
  else if (item.images?.length) media = photoGrid(item.images, item.url);
  else if (item.external?.url) media = linkCard(item.external.url, item.external);
  return cardShell(item, avatar(item.source.avatar, item.source.name), [
    tweetHead(item, { name: item.source.name, handle: item.source.handle ? '@' + item.source.handle : '', publishedAt: item.publishedAt, url: item.url }),
    tweetText(item),
    media,
    item.quote ? quoteCard(item.quote) : null,
    threadButton(item),
  ], item.url);
}

function groupCard(entry) {
  const items = entry.items;
  const lead = items.find((i) => i.image) || items[0];
  const newest = items.reduce((a, b) => (Date.parse(a.publishedAt) > Date.parse(b.publishedAt) ? a : b));
  return cardShell(entry, h('div', { class: 'stack' }, items.slice(0, 3).map((i) => avatar(i.source.avatar, i.source.name, { square: true }))), [
    tweetHead(entry, { name: `${items.length} médias en parlent`, publishedAt: newest.publishedAt }),
    h('div', { class: 'tweet-text' }, lead.title),
    lead.text ? h('div', { class: 'tweet-text dim' }, lead.text) : null,
    lead.image ? h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(lead.image, lead.title, { url: lead.url })) : null,
    h('div', { class: 'group-list' }, items.map((i) =>
      h('a', { class: 'group-item', href: i.url, target: '_blank', rel: 'noopener' },
        avatar(i.source.avatar, i.source.name, { square: true }),
        h('div', {},
          h('div', { class: 'gi-src', text: `${i.source.name} · ${relativeTime(i.publishedAt)}` }),
          h('div', { text: i.title }),
        ),
      ))),
    h('button', { class: 'group-toggle', type: 'button', 'aria-expanded': 'false', text: `Voir les ${items.length} articles`, onclick: (e) => {
      e.stopPropagation();
      const card = e.currentTarget.closest('.tweet');
      card.classList.add('open');
      e.currentTarget.setAttribute('aria-expanded', 'true');
      card.querySelector('.group-item')?.focus(); // the toggle just disappeared: keep the focus in the card
    } }),
  ]);
}

export function renderEntry(entry) {
  if (entry.kind === 'group') return groupCard(entry);
  if (entry.kind === 'article') return articleCard(entry);
  return postCard(entry);
}
