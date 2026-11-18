// Feed cards: articles, Bluesky posts, "N médias en parlent" groups.

import { h, svg, ICONS, openUrl } from './dom.js';
import { postUri } from '../bsky.js';
import { avatar, image } from './media.js';
import { loadHls } from './hls.js';
import { formatTime } from './reelcontrols.js';
import { state, isOpened, markOpened } from './store.js';
import { actions } from './actions.js';
import { voteButtons } from './votes.js';
import { clampAspect, truncateText, domainOf } from './util.js';
import { relativeTime, topicsOf } from '../rank.js';
import { exactTime } from '../freshness.js';
import { safeUrl } from '../url.js';
import { paywallLabel, paidDomains, isPaidLink, groupLead } from '../paywall.js';

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

/**
 * An article's description, clamped to 4 lines. When it is cut, « Voir plus » appears and
 * tapping the description unfolds it in place (instead of opening the article).
 */
const clampWatch = typeof ResizeObserver === 'function'
  ? new ResizeObserver((list) => {
    for (const { target } of list) {
      const wrap = target.parentElement;
      if (wrap && !wrap.classList.contains('expanded')) wrap.classList.toggle('clamped', target.scrollHeight > target.clientHeight + 1);
    }
  })
  : null;

function dimText(text) {
  const expand = (e) => {
    if (!wrap.classList.contains('clamped')) return; // fully visible: the tap opens the card as usual
    e.stopPropagation();
    wrap.classList.remove('clamped');
    wrap.classList.add('expanded');
    clampWatch?.unobserve(body);
  };
  const body = h('div', { class: 'tweet-text dim' }, text);
  const wrap = h('div', { class: 'dim-wrap', onclick: expand }, body,
    h('button', { class: 'see-more dim-more', type: 'button', text: 'Voir plus', onclick: expand }));
  // The observer measures the text box once it is laid out and flags the wrapper when it is cut.
  clampWatch?.observe(body);
  return wrap;
}

function tweetHead(entry, { name, handle, publishedAt, url }) {
  const toProfile = entry.kind !== 'group' && entry.source
    ? (e) => { e.stopPropagation(); actions.openProfile(entry.source); }
    : null;
  const time = h('time', { class: 'time', datetime: publishedAt, text: relativeTime(publishedAt), title: exactTime(publishedAt) });
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

// ---- Inline video (Bluesky posts in Actus, Tech, threads) ----
// Muted autoplay while visible, with the time left in a corner. A tap brings the phone's own
// player controls (duration, progress bar to move in the video, full screen, sound).
let inlineObs = null;
const inFullscreen = (box) => !!(document.fullscreenElement || box._video?.webkitDisplayingFullscreen);
const inlineObserver = () => (inlineObs ||= new IntersectionObserver((entries) => {
  for (const e of entries) {
    const box = e.target;
    // « Lire les vidéos automatiquement » off: the ▶ stays until the video is tapped.
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && state.view !== 'videos' && state.settings.autoplay) startInline(box);
    else if (!inFullscreen(box)) stopInline(box); // the full screen player takes the video out of the page
  }
}, { threshold: [0, 0.6] }));

async function startInline(box) {
  if (box._video) return;
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto' });
  video.muted = box._muted !== false;
  if (box._controls) video.controls = true;
  box._video = video;
  box.prepend(video);
  // Time left, like on X ("0:42"), until the controls take over.
  const time = box.querySelector('.vid-time');
  const showTime = () => {
    const left = video.duration - video.currentTime;
    time.textContent = Number.isFinite(left) && left >= 0 ? formatTime(left) : '';
  };
  video.addEventListener('durationchange', showTime);
  video.addEventListener('timeupdate', showTime);
  if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = box._src;
  else {
    try {
      const Hls = await loadHls();
      if (box._video !== video) return;
      if (Hls?.isSupported()) { box._hls = new Hls({ maxBufferLength: 10 }); box._hls.loadSource(box._src); box._hls.attachMedia(video); }
      else video.src = box._src;
    } catch { return; }
  }
  playInline(box);
}

/** Plays and shows it; when the browser refuses (autoplay blocked, low power mode), the ▶ stays. */
function playInline(box) {
  box._video?.play().then(() => box.classList.add('playing')).catch(() => box.classList.remove('playing'));
}

/**
 * Tap on the video (never opens the post behind it): the phone's player controls appear and
 * the sound comes on; from then on, the controls handle the taps.
 */
function tapInline(e, box) {
  e.stopPropagation();
  if (box._controls && box._video) return;
  box._controls = true;
  box.classList.add('controls');
  box._muted = false;
  if (!box._video) { startInline(box); return; } // the tap counts as the gesture that allows playback
  box._video.controls = true;
  box._video.muted = false;
  playInline(box);
}

function stopInline(box) {
  if (!box._video) return;
  box._hls?.destroy();
  box._hls = null;
  box._video.pause();
  box._video.remove();
  box._video = null;
  box._controls = false;
  box._muted = true;
  box.classList.remove('playing', 'controls');
  const time = box.querySelector('.vid-time');
  if (time) time.textContent = '';
}

export function stopAllInline() {
  document.querySelectorAll('.media.inline-video').forEach(stopInline);
}

function inlineVideo(v) {
  const muteBtn = h('button', { class: 'vid-mute', 'aria-label': 'Son' }, svg(ICONS.muted, 18));
  const box = h('div', { class: 'media inline-video', style: `aspect-ratio:${clampAspect(v.aspect, 16 / 9)}` },
    v.poster ? image(v.poster) : null,
    h('span', { class: 'vid-time', 'aria-hidden': 'true' }),
    muteBtn,
  );
  box._src = safeUrl(v.src, location.href);
  if (!box._src) return box;
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', 'Lire la vidéo avec les commandes');
  box.tabIndex = 0;
  box.addEventListener('click', (e) => { if (!e.target.closest('.vid-mute')) tapInline(e, box); });
  box.addEventListener('keydown', (e) => {
    if (e.target === box && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tapInline(e, box); }
  });
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box._muted = box._muted === false;
    if (box._video) { box._video.muted = box._muted; playInline(box); }
    muteBtn.replaceChildren(svg(box._muted ? ICONS.muted : ICONS.sound, 18));
  });
  inlineObserver().observe(box);
  return box;
}

// Sites whose articles are mostly paid (from the sources flagged in config/sources.json),
// so that a Bluesky post sharing a Mediapart link says « Payant » on its link card too.
let paidCache = { key: null, set: new Set() };
function paidSites() {
  const key = [state.data.actus, state.data.tech];
  if (paidCache.key?.[0] !== key[0] || paidCache.key?.[1] !== key[1]) {
    paidCache = { key, set: paidDomains([...(key[0]?.entries || []), ...(key[1]?.entries || [])]) };
  }
  return paidCache.set;
}

const lockBadge = (label = 'Payant') => h('span', {
  class: 'pay-badge' + (label === 'Payant' ? '' : ' maybe'),
  title: label === 'Payant' ? 'Article réservé aux abonnés' : 'Une partie des articles de ce site est réservée aux abonnés',
}, svg(ICONS.lock, 13), label);

/** Link card like X: image with the domain in a pill, or a compact card without image. */
function linkCard(url, { title, description, thumb }, { article = false } = {}) {
  const dom = domainOf(url);
  const paid = !article && isPaidLink(url, paidSites()) ? lockBadge() : null;
  if (thumb) {
    return h('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener' },
      h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(thumb, title || '', { url })),
      h('span', { class: 'link-pill', text: title ? truncateText(title, 70) : dom }),
      title || paid ? h('div', { class: 'link-from' }, title ? `De ${dom}` : dom, paid) : null,
    );
  }
  return h('a', { class: 'link-card compact', href: url, target: '_blank', rel: 'noopener' },
    h('div', { class: 'link-from' }, dom, paid),
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

/**
 * Small labels under a card: the topics found in it (Politique, IA…), « EN » for a source flagged
 * so in config/sources.json, « Short », the author and the feed's categories. (« Payant » is on
 * the article's own footer line, next to « Lire sur … ».)
 */
function badgeRow(entry) {
  const topics = topicsOf(entry, state.data.topics?.topicMinScore ?? 1).map((t) => state.data.topics?.topics?.[t]?.label).filter(Boolean);
  const src = entry.kind === 'group' ? null : entry.source;
  const tags = [
    ...topics.map((t) => h('span', { class: 'tag topic', text: t })),
    src?.lang && src.lang !== 'fr' ? h('span', { class: 'tag lang', text: src.lang.toUpperCase(), title: 'Source en langue étrangère' }) : null,
    entry.platform === 'youtube' && (entry.video?.aspect ?? 1) < 1 ? h('span', { class: 'tag', text: 'Short' }) : null,
    ...(entry.categories || []).slice(0, 2).map((c) => h('span', { class: 'tag cat', text: c })),
  ].filter(Boolean);
  const byline = entry.author ? h('span', { class: 'byline', text: `Par ${entry.author}` }) : null;
  return tags.length || byline ? h('div', { class: 'tags' }, byline, tags) : null;
}

/** Opens / closes the list of articles of a group, and keeps the toggle's label in step. */
function setGroupOpen(card, open) {
  card.classList.toggle('open', open);
  const btn = card.querySelector('.group-toggle');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Masquer' : `Voir les ${btn.dataset.count} articles`;
}

/** « Mediapart · Politis · Blast +2 »: the outlets of a group, readable without opening it. */
export function outletNames(items, max = 3) {
  const names = [...new Set(items.map((i) => i.source.name))];
  return names.slice(0, max).join(' · ') + (names.length > max ? ` +${names.length - max}` : '');
}

/** Remembers that an article was opened (its title is dimmed from now on). */
function openedArticle(card, id) {
  markOpened(id);
  if (card.dataset.id === id) card.classList.add('opened'); // a group only dims the article that was opened
  card.querySelector(`[data-open-id="${CSS.escape(id)}"]`)?.classList.add('opened');
}

function cardShell(entry, avatarNode, mainChildren, url) {
  const opened = entry.kind === 'article' && isOpened(entry.id);
  return h('article', {
    class: 'tweet' + (entry.kind === 'group' ? ' group' : '') + (opened ? ' opened' : ''),
    dataset: { id: entry.id },
    onclick: (e) => {
      const link = e.target.closest('a');
      if (link) {
        // The permalink, the image card and the articles of a group count as "opened"
        // (a hashtag or a @mention inside the text does not).
        if (link.matches('.time-link, .link-card, .group-item, .open-link')) {
          const id = link.dataset.openId || (entry.kind === 'article' ? entry.id : null);
          if (id) openedArticle(e.currentTarget, id);
        }
        return;
      }
      if (e.target.closest('button')) return;
      if (entry.kind === 'article') openedArticle(e.currentTarget, entry.id);
      if (entry.kind === 'group') setGroupOpen(e.currentTarget, !e.currentTarget.classList.contains('open'));
      else if (entry.platform === 'bluesky' && postUri(entry.url)) actions.openThread(entry);
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

function articleCard(item, votes) {
  const dom = domainOf(item.url);
  return cardShell(item, avatar(item.source.avatar, item.source.name, { square: true }), [
    tweetHead(item, { name: item.source.name, handle: dom, publishedAt: item.publishedAt, url: item.url }),
    h('div', { class: 'tweet-text title' }, item.title),
    item.text ? dimText(item.text) : null,
    item.image ? linkCard(item.url, { thumb: item.image, title: '' }, { article: true }) : null,
    articleFoot(item, dom, votes),
    badgeRow(item),
  ], item.url);
}

/**
 * « ↗ Lire sur mediapart.fr · 🔒 Payant »: says that the card is a web article (it opens the
 * site, there is no thread to read here), and whether the site will ask for a subscription.
 */
function articleFoot(item, dom, votes) {
  const label = paywallLabel(item);
  return h('div', { class: 'card-foot' },
    h('a', { class: 'open-link', href: item.url, target: '_blank', rel: 'noopener' },
      svg(ICONS.open, 15), h('span', { text: `Lire sur ${dom || 'le site'}` })),
    label ? lockBadge(label) : null,
    votes ? voteButtons(item) : null);
}

/**
 * « 💬 12 réponses · Voir le fil » under a Bluesky post: the visible difference with an article
 * (which opens a website). Opens the thread; the whole card does too, this is the keyboard path.
 */
function threadButton(item, votes) {
  const vb = votes ? voteButtons(item) : null;
  if (item.platform !== 'bluesky' || !postUri(item.url)) return vb && h('div', { class: 'tweet-actions' }, vb);
  const n = item.stats?.replies || 0;
  return h('div', { class: 'tweet-actions' },
    h('button', {
      class: 'thread-btn', type: 'button', 'aria-label': n ? `Voir le fil, ${n} réponse${n > 1 ? 's' : ''}` : 'Voir le fil',
      onclick: (e) => { e.stopPropagation(); actions.openThread(item); },
    }, svg(ICONS.reply, 18), h('span', { text: n ? `${n} réponse${n > 1 ? 's' : ''} · Voir le fil` : 'Voir le fil' })),
    vb);
}

function postCard(item, votes) {
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
    threadButton(item, votes),
    badgeRow(item),
  ], item.url);
}

function groupCard(entry, votes) {
  const items = entry.items;
  const lead = groupLead(items);
  const newest = items.reduce((a, b) => (Date.parse(a.publishedAt) > Date.parse(b.publishedAt) ? a : b));
  return cardShell(entry, h('div', { class: 'stack' }, items.slice(0, 3).map((i) => avatar(i.source.avatar, i.source.name, { square: true }))), [
    tweetHead(entry, { name: `${items.length} médias en parlent`, publishedAt: newest.publishedAt }),
    h('div', { class: 'tweet-text' }, lead.title),
    lead.text ? dimText(lead.text) : null,
    lead.image ? h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(lead.image, lead.title, { url: lead.url })) : null,
    badgeRow(entry),
    h('div', { class: 'group-names', text: outletNames(items) }),
    h('div', { class: 'group-list' }, items.map((i) =>
      h('a', { class: 'group-item' + (isOpened(i.id) ? ' opened' : ''), href: i.url, target: '_blank', rel: 'noopener', dataset: { openId: i.id } },
        avatar(i.source.avatar, i.source.name, { square: true }),
        h('div', {},
          h('div', { class: 'gi-src' }, `${i.source.name} · ${relativeTime(i.publishedAt)}`, paywallLabel(i) ? lockBadge(paywallLabel(i)) : null),
          h('div', { text: i.title }),
        ),
      ))),
    h('div', { class: 'group-foot' },
      h('button', { class: 'group-toggle', type: 'button', 'aria-expanded': 'false', dataset: { count: items.length }, text: `Voir les ${items.length} articles`, onclick: (e) => {
        e.stopPropagation();
        const card = e.currentTarget.closest('.tweet');
        setGroupOpen(card, !card.classList.contains('open'));
      } }),
      votes ? voteButtons(entry) : null),
  ]);
}

/** `votes: false` leaves out the 👍 / 👎 buttons (the posts of a conversation). */
export function renderEntry(entry, { votes = true } = {}) {
  if (entry.kind === 'group') return groupCard(entry, votes);
  if (entry.kind === 'article') return articleCard(entry, votes);
  return postCard(entry, votes);
}
