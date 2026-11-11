// Decides whether a collection run is healthy enough to be deployed. A run that
// fails massively (network outage, API down) must exit non-zero so that the
// previous GitHub Pages deployment stays in place instead of being replaced by
// near-empty data.

export const DEFAULT_HEALTH = { maxFailureRatio: 0.5, minTotalItems: 30 };

/**
 * @param {{ok:boolean}[]} status  one entry per source
 * @param {{actus:number,tech:number,videos:number}} counts  items written
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function checkRun(status, counts, settings = {}) {
  const { maxFailureRatio, minTotalItems } = { ...DEFAULT_HEALTH, ...(settings.health || {}) };
  const reasons = [];
  const failed = status.filter((s) => !s.ok).length;
  if (status.length && failed / status.length > maxFailureRatio) {
    reasons.push(`${failed}/${status.length} sources en échec (seuil : ${Math.round(maxFailureRatio * 100)} %)`);
  }
  const total = (counts.actus || 0) + (counts.tech || 0) + (counts.videos || 0);
  if (total < minTotalItems) reasons.push(`${total} éléments collectés (minimum : ${minTotalItems})`);
  return { ok: reasons.length === 0, reasons };
}
