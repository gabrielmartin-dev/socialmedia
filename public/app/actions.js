// Late-bound entry points, assigned once in app.js. They let the feed cards, the reels
// and the account lists open a profile / the options sheet without importing the
// modules that render those (which would make the import graph circular).

const unset = (name) => () => { throw new Error(`actions.${name} is not wired`); };

export const actions = {
  openProfile: unset('openProfile'),
  openSheet: unset('openSheet'),
  /** Called after a follow / unfollow, to refresh the screens that show it. */
  afterFollow: () => {},
  /** Switch tab / refresh the feeds (used by the empty-state buttons). */
  switchView: unset('switchView'),
  refresh: unset('refresh'),
  /** Called when the app comes back after a long absence. */
  afterLongAbsence: () => {},
};
