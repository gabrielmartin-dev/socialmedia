// 👍 / 👎 buttons of the cards (feeds, profile, saved list) and of the videos.
// A tap changes the preferences and re-ranks what comes next at once (retune); tapping the same
// button again takes the vote back. 👎 also keeps that post from coming back after a refresh,
// and dims it where it is (it does not jump off the screen under the finger).

import { setVote } from '../votes.js';
import { h, svg, toast } from './dom.js';
import { state } from './store.js';
import { prefsChanged } from './retune.js';

const ICON = {
  up: 'M9 21h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2Zm0-12 4.34-4.34L12 10h9v2l-3 7H9V9ZM1 9h4v12H1V9Z',
  upOn: 'M1 21h4V9H1v12Zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2Z',
  down: 'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2Zm0 12-4.34 4.34L12 14H3v-2l3-7h9v10Zm4-12h4v12h-4V3Z',
  downOn: 'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2Zm4 0v12h4V3h-4Z',
};

export const voteOf = (id) => state.votes[id]?.v || 0;

/** Puts every copy of the buttons of `id` on screen (feed, video, profile…) in step. */
function paint(id) {
  const v = voteOf(id);
  for (const box of document.querySelectorAll(`.votes[data-id="${CSS.escape(id)}"]`)) {
    const [up, down] = box.querySelectorAll('button');
    up.setAttribute('aria-pressed', String(v > 0));
    down.setAttribute('aria-pressed', String(v < 0));
    up.replaceChildren(svg(v > 0 ? ICON.upOn : ICON.up, box._size));
    down.replaceChildren(svg(v < 0 ? ICON.downOn : ICON.down, box._size));
    box.closest('.tweet')?.classList.toggle('disliked', v < 0);
  }
}

function vote(entry, v) {
  const next = voteOf(entry.id) === v ? 0 : v;
  setVote(state, entry, next);
  paint(entry.id);
  prefsChanged();
  toast(next > 0 ? 'C’est noté : plus de ça dans la suite' : next < 0 ? 'C’est noté : moins de ça dans la suite' : 'Vote retiré');
}

/**
 * The two buttons for `entry`. `reel`: big round buttons of the Vidéos tab.
 */
export function voteButtons(entry, { reel = false } = {}) {
  const size = reel ? 24 : 18;
  const btn = (v, label) => h('button', {
    class: reel ? 'reel-btn vote' : 'vote', type: 'button', 'aria-label': label, 'aria-pressed': 'false',
    onclick: (e) => { e.stopPropagation(); vote(entry, v); },
  });
  const box = h('span', { class: reel ? 'votes reel-votes' : 'votes', dataset: { id: entry.id } },
    btn(1, 'J’aime : plus de ça'), btn(-1, 'Je n’aime pas : moins de ça'));
  box._size = size;
  const v = voteOf(entry.id);
  const [up, down] = box.children;
  up.setAttribute('aria-pressed', String(v > 0));
  down.setAttribute('aria-pressed', String(v < 0));
  up.append(svg(v > 0 ? ICON.upOn : ICON.up, size));
  down.append(svg(v < 0 ? ICON.downOn : ICON.down, size));
  return box;
}

/** Dims a card / video that was disliked before (called when it is built). */
export const markDisliked = (node, id) => { if (voteOf(id) < 0) node.classList.add('disliked'); return node; };
