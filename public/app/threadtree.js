// Pure helpers for the replies under a post (thread.js draws them). No DOM here, so that
// the tests can run them in Node.

/** Number of replies under a node of the tree, all levels. */
export const descendants = (node) => node.replies.reduce((n, r) => n + 1 + descendants(r), 0);

/**
 * How many of `count` replies to show at once: all of them when hiding only one or two
 * (a « 2 autres réponses » button saves nothing), `limit` otherwise.
 */
export const firstBatch = (count, limit) => (count <= limit + 2 ? count : limit);

/** Label of the button that shows or hides the replies to a reply. */
export function toggleLabel(n, open) {
  const s = n > 1 ? 's' : '';
  return open ? `Masquer ${n > 1 ? 'les' : 'la'} réponse${s}` : `Afficher ${n} réponse${s}`;
}
