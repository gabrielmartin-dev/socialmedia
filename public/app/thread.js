// Thread view: the conversation around a Bluesky post (what it answers to, the author's own
// follow-ups, then the replies), fetched from the public AppView when a post is opened.

import { getThread } from '../bsky.js';
import { $, h, svg, ICONS } from './dom.js';
import { renderEntry, stopAllInline } from './cards.js';
import { deactivateReel } from './reels.js';
import { switchView } from './tabs.js';
import { viewerPop } from './viewer.js';
import { actions } from './actions.js';
import { state, isFeed } from './store.js';

const MAX_DEPTH = 3; // deeper replies are shown at the third indentation level
const MAX_REPLIES = 150;

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
  const from = state.view;
  if (isFeed(from)) state.feeds[from].scroll = window.scrollY;
  frames.push({ item, prev: from, scroll: window.scrollY });
  history.pushState({ thread: item.id }, '');
  show();
  window.scrollTo({ top: 0 });
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
  const card = renderEntry(item);
  card.classList.add(...cls.split(' '));
  return card;
}

function flatten(nodes, depth, out) {
  for (const n of nodes) {
    if (out.length >= MAX_REPLIES) return;
    out.push({ item: n.item, own: n.own, depth: Math.min(depth, MAX_DEPTH) });
    flatten(n.replies, depth + 1, out);
  }
}

function paint(root, thread) {
  const nodes = [];
  for (const p of thread.parents) nodes.push(postNode(p, 'thread-parent'));
  nodes.push(postNode(thread.item, 'thread-focus'));
  const replies = [];
  flatten(thread.replies, 1, replies);
  if (replies.length) {
    const count = thread.item.stats.replies;
    nodes.push(h('h2', { class: 'thread-section', text: count > 1 ? `${count} réponses` : '1 réponse' }));
    for (const r of replies) nodes.push(postNode(r.item, `thread-reply depth-${r.depth}${r.own ? ' own' : ''}`));
  } else {
    nodes.push(h('div', { class: 'empty' }, h('strong', { text: 'Aucune réponse' }), 'Personne n\'a encore répondu à ce post.'));
  }
  root.replaceChildren(...nodes);
  // Land on the post itself when it answers to others (parents are above it).
  if (thread.parents.length) root.querySelector('.thread-focus')?.scrollIntoView({ block: 'start' });
}

function bar() {
  return h('div', { class: 'thread-bar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: () => history.back() }, svg(ICONS.back, 22)),
    h('h1', { class: 'thread-title', text: 'Fil de discussion' }),
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
  window.addEventListener('popstate', (e) => {
    if (viewerPop(e)) return;
    if (state.view === 'thread') onBack();
  });
  // Leaving through the tab bar abandons the whole stack of threads.
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { frames.length = 0; }));
}
