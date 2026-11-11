// What the app needs from the config, exported in public/data/topics.json so that the
// client never hard-codes values that already live in config/.

/** topics config + the freshness windows (hours) the collector applies per feed. */
export function topicsForClient(topicsCfg, settings = {}) {
  return {
    ...topicsCfg,
    settings: {
      actusMaxAgeHours: settings.actusMaxAgeHours ?? 72,
      techMaxAgeHours: settings.techMaxAgeHours ?? 168,
      videosMaxAgeHours: settings.videosMaxAgeHours ?? 168,
    },
  };
}
