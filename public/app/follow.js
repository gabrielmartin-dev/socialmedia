// Follow / unfollow.

import { state, saveFollows, FEED_KEYS } from './store.js';
import { toast } from './dom.js';
import { actions } from './actions.js';
import { loadLive } from './live.js';

export async function setFollow(account, follow) {
  const f = state.follows;
  if (follow) {
    f.unfollowed.delete(account.id);
    f.followed.add(account.id);
    if (account.kind === 'bluesky' && !state.accounts.has(account.id)) {
      f.live[account.id] = {
        name: account.name, handle: account.handle, avatar: account.avatar, description: account.description || '', url: account.url,
        feed: account.feed === 'tech' ? 'tech' : 'actus',
      };
    }
  } else {
    f.followed.delete(account.id);
    delete f.live[account.id];
    if (!account.suggested) f.unfollowed.add(account.id);
  }
  saveFollows();
  toast(follow ? `Tu suis ${account.name}` : `Tu ne suis plus ${account.name}`);
  if (follow && f.live[account.id]) await loadLive();
  FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
  state.reels.built = false;
  actions.afterFollow();
}
