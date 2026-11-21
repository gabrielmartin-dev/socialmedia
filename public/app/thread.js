// Thread view: the conversation around a Bluesky post (what it answers to, the author's own
// follow-ups, then the replies), fetched from the public AppView when a post is opened.

import { getThread } from '../bsky.js';
import { $, h, svg, ICONS, playEnter } from './dom.js';
import { renderEntry, stopAllInline } from './cards.js';
import { deactivateReel } from './reels.js';
import { switchView } from './tabs.js';
import { viewerPop } from './viewer.js';
import { actions } from './actions.js';
import { state, isFeed } from './store.js';
import { descendants, firstBatch, toggleLabel } from './threadtree.js';

const MAX_DEPTH = 3;   // levels drawn under the post; deeper, « Continuer la discussion » opens the reply
const FIRST_LEVEL = 12; // first-level replies shown before « Afficher plus de réponses »
const PER_LEVEL = 3;    // answers to a reply shown before « Afficher N autres réponses »

// One frame per opened thread, oldest first. `prev` is the view it was opened from
// ('thread' when opened from another thread), so Back can return exactly there.
const frames = [];
const cache = new Map(); // post url → thread, so that Back and re-opening are instant
let seq = 0;

const top = () => frames[frames.length - 1];

function show() {
  deactivateReel();
  stopAllInline();
  state.view = 'thread';
  document.body.classList.remove('videos-mode');
  document.body.classList.add('profile-mode'); // hides the top bar; the thread has its own
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-thread'));
  render(top().item);
}

export function openThread(item) {
  // Already on this post's thread (tap on the post itself): nothing to open again.
  if (state.view === 'thread' && top()?.item.id === item.id) return;
  const from = state.view;
  if (isFeed(from)) state.feeds[from].scroll = window.scrollY;
  frames.push({ item, prev: from, scroll: window.scrollY });
  history.pushState({ thread: item.id }, '');
  show();
  window.scrollTo({ top: 0 });
  playEnter(document.getElementById('view-thread'));
}

/** Back from a profile opened on top of the thread: show the thread again. */
export function resumeThread() {
  if (top()) show();
}

function leave(frame) {
  document.body.classList.remove('profile-mode');
  state.view = null;
  if (frame.prev === 'profile') actions.resumeProfile();
  else switchView(frame.prev);
  window.scrollTo({ top: frame.scroll || 0 });
}

function onBack() {
  const frame = frames.pop();
  if (!frame) return;
  if (frame.prev === 'thread') { show(); window.scrollTo({ top: frame.scroll || 0 }); } else leave(frame);
}

/** One post of the conversation. Tapping it opens its own thread (unless it is the current one). */
function postNode(item, cls) {
  const card = renderEntry(item, { votes: false });
  card.classList.add(...cls.split(' '));
  return card;
}

/**
 * A reply and, below it, the replies to it, joined to it by a line from its avatar (like on
 * Bluesky). Its « Voir le fil » button becomes « Masquer / Afficher N réponses ».
 */
function replyNode(node, depth) {
  const card = postNode(node.item, `thread-reply compact${node.own ? ' own' : ''}`);
  const wrap = h('div', { class: 'rt', dataset: { depth } }, card);
  if (node.own) {
    card.querySelector('.tweet-head .name')?.after(h('span', { class: 'author-badge', text: 'Auteur' }));
  }
  const actionsRow = card.querySelector('.tweet-actions');
  const total = descendants(node);
  if (!total) { actionsRow?.remove(); return wrap; }
  wrap.classList.add('has-kids');
  if (depth >= MAX_DEPTH) {
    // Too deep to indent again on a phone: the rest of the branch opens as its own thread.
    actionsRow?.remove();
    wrap.append(h('div', { class: 'rt-kids' },
      h('button', {
        class: 'rt-more rt-deeper', type: 'button',
        onclick: () => actions.openThread(node.item),
      }, h('span', { text: `Continuer la discussion (${total})` }), svg(ICONS.back, 16))));
    return wrap;
  }
  const kids = h('div', { class: 'rt-kids' });
  appendReplies(kids, node.replies, depth + 1, PER_LEVEL);
  const toggle = h('button', {
    class: 'thread-btn rt-toggle', type: 'button', 'aria-expanded': 'true',
    onclick: (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('collapsed') === false;
      toggle.setAttribute('aria-expanded', String(open));
      label.textContent = toggleLabel(total, open);
      // Folding a long branch from its bottom: keep its post in sight.
      if (!open && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
    },
  }, svg(ICONS.reply, 18));
  const label = h('span', { text: toggleLabel(total, true) });
  toggle.append(label);
  if (actionsRow) actionsRow.replaceChildren(toggle); else card.querySelector('.tweet-main')?.append(h('div', { class: 'tweet-actions' }, toggle));
  wrap.append(kids);
  return wrap;
}

/** Draws `list` into `box`, the first ones only, then a button for the rest. */
function appendReplies(box, list, depth, limit, from = 0) {
  const shown = from + firstBatch(list.length - from, limit);
  for (let i = from; i < shown; i++) {
    const n = replyNode(list[i], depth);
    if (i === list.length - 1) n.classList.add('last');
    box.append(n);
  }
  const left = list.length - shown;
  if (!left) return;
  const more = h('button', {
    class: 'rt-more', type: 'button',
    onclick: () => { more.remove(); appendReplies(box, list, depth, depth === 1 ? FIRST_LEVEL : 10, shown); updateNext(); },
  }, depth === 1 ? `Afficher plus de réponses (${left})` : `Afficher ${left} autre${left > 1 ? 's' : ''} réponse${left > 1 ? 's' : ''}`);
  box.append(more);
}

/** « ↓ » button: jumps to the next first-level reply, so a long conversation is quick to skim. */
let nextBtn = null;
function nextTarget() {
  const barH = document.querySelector('.thread-bar')?.getBoundingClientRect().bottom || 0;
  return [...document.querySelectorAll('#thread-root .rt[data-depth="1"]')]
    .find((el) => el.getBoundingClientRect().top > barH + 4);
}
function updateNext() {
  if (!nextBtn?.isConnected) return;
  const count = document.querySelectorAll('#thread-root .rt[data-depth="1"]').length;
  nextBtn.hidden = count < 3 || !nextTarget() || window.scrollY < 40;
}
function nextButton() {
  nextBtn = h('button', {
    class: 'thread-next', type: 'button', hidden: true, 'aria-label': 'Réponse suivante', title: 'Réponse suivante',
    onclick: () => {
      const el = nextTarget();
      if (!el) return;
      const barH = document.querySelector('.thread-bar')?.getBoundingClientRect().bottom || 0;
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - barH, behavior: 'smooth' });
    },
  }, svg(ICONS.back, 22));
  return nextBtn;
}

function paint(root, thread) {
  const nodes = [];
  for (const p of thread.parents) nodes.push(postNode(p, 'thread-parent'));
  nodes.push(postNode(thread.item, 'thread-focus'));
  if (thread.replies.length) {
    const count = Math.max(thread.item.stats.replies, thread.replies.reduce((n, r) => n + 1 + descendants(r), 0));
    nodes.push(h('h2', { class: 'thread-section' },
      h('span', { text: count > 1 ? `${count} réponses` : '1 réponse' }),
      h('span', { class: 'thread-sort', text: thread.replies.length > 1 ? 'Les plus aimées d’abord' : '' })));
    const list = h('div', { class: 'thread-replies' });
    appendReplies(list, thread.replies, 1, FIRST_LEVEL);
    nodes.push(list, nextButton());
    const sub = document.querySelector('.thread-count');
    if (sub) sub.textContent = count > 1 ? `${count} réponses` : '1 réponse';
  } else {
    nodes.push(h('div', { class: 'empty' }, h('strong', { text: 'Aucune réponse' }), 'Personne n\'a encore répondu à ce post.'));
  }
  root.replaceChildren(...nodes);
  // Land on the post itself when it answers to others (parents are above it).
  if (thread.parents.length) root.querySelector('.thread-focus')?.scrollIntoView({ block: 'start' });
  updateNext();
}

function bar() {
  return h('div', { class: 'thread-bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: () => history.back() }, svg(ICONS.back, 22)),
    // Tapping the title goes back up to the post, like tapping the top bar on a phone.
    h('button', {
      class: 'thread-heading', type: 'button', title: 'Revenir au post',
      onclick: () => {
        const focus = document.querySelector('#thread-root .thread-focus');
        const barH = document.querySelector('.thread-bar')?.getBoundingClientRect().bottom || 0;
        window.scrollTo({ top: focus ? Math.max(0, window.scrollY + focus.getBoundingClientRect().top - barH) : 0, behavior: 'smooth' });
      },
    }, h('h1', { class: 'thread-title', text: 'Fil de discussion' }), h('span', { class: 'thread-count' })),
  );
}

async function render(item) {
  const mine = ++seq;
  const body = h('div', { class: 'thread-body' }, postNode(item, 'thread-focus'));
  $('#thread-root').replaceChildren(bar(), body);
  const cached = cache.get(item.url);
  if (cached) { paint(body, cached); return; }
  const status = h('div', { class: 'thread-status', role: 'status', text: 'Chargement des réponses…' });
  body.append(status);
  try {
    const thread = await getThread(item.url);
    if (mine !== seq) return;
    if (!thread) throw new Error('empty');
    cache.set(item.url, thread);
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    paint(body, thread);
  } catch {
    if (mine !== seq) return;
    status.replaceChildren('Impossible de charger le fil. ',
      h('button', { class: 'see-more', type: 'button', text: 'Réessayer', onclick: () => render(item) }));
  }
}

export function initThread() {
  window.addEventListener('scroll', () => { if (state.view === 'thread') updateNext(); }, { passive: true });
  window.addEventListener('popstate', (e) => {
    if (viewerPop(e)) return;
    if (state.view === 'thread') onBack();
  });
  // Leaving through the tab bar abandons the whole stack of threads.
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { frames.length = 0; }));
}
