// Shared by the collector and the app (no Node API).

/** Run async tasks with at most `limit` in flight. Never rejects: returns settled results. */
export async function pool(tasks, limit = 6) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await tasks[i]() }; }
      catch (error) { results[i] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
