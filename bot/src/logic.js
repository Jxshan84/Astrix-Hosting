function trimOld(entries, cutoff) {
  while (entries.length && entries[0] < cutoff) entries.shift();
}

function createDetectionTracker() {
  const spamWindows = new Map();
  const abuseWindows = new Map();

  function observe({ userId, content, now, config, exempt = false }) {
    if (!config?.enabled || exempt || !userId) return [];
    const observations = [];
    const windowMs = config.spamWindowSeconds * 1000;
    const spam = spamWindows.get(userId) || [];
    trimOld(spam, now - windowMs);
    spam.push(now);
    spamWindows.set(userId, spam);

    if (
      spam.length === config.spamThreshold ||
      spam.length === config.spamThreshold * 2
    ) {
      observations.push({
        type: "spam",
        count: spam.length,
        action: spam.length >= config.spamThreshold * 2 ? "timeout" : "warn",
      });
    }

    const normalized = content.toLocaleLowerCase();
    const hasConfiguredTerm = config.abusiveTerms.some((term) =>
      term && normalized.includes(term.toLocaleLowerCase())
    );
    if (hasConfiguredTerm) {
      const abuse = abuseWindows.get(userId) || [];
      trimOld(abuse, now - windowMs);
      abuse.push(now);
      abuseWindows.set(userId, abuse);
      if (abuse.length === 1 || abuse.length === config.abusiveLanguageRepeatThreshold) {
        observations.push({
          type: "abusive_language",
          count: abuse.length,
          action: abuse.length >= config.abusiveLanguageRepeatThreshold ? "timeout" : "review",
        });
      }
    }

    for (const [id, values] of spamWindows) {
      if (!values.length || values[values.length - 1] < now - 5 * windowMs) spamWindows.delete(id);
    }
    for (const [id, values] of abuseWindows) {
      if (!values.length || values[values.length - 1] < now - 5 * windowMs) abuseWindows.delete(id);
    }
    return observations;
  }

  return { observe };
}

function makeEvidenceReference(type, guildId, channelId, objectId) {
  if (!["message", "auditlog", "interaction"].includes(type)) {
    throw new TypeError("Unsupported Discord evidence reference type.");
  }
  const values = [guildId, channelId, objectId];
  if (values.some((value) => !/^\d{17,20}$/.test(String(value)))) {
    throw new TypeError("Discord evidence references must contain valid snowflakes.");
  }
  return `discord-${type}:${values.join(":")}`;
}

function formatSecurityAlert(event) {
  const payload = event?.payload || {};
  return {
    title: "Astrix security review required",
    description: String(payload.eventType || "security event").slice(0, 120),
    fields: [
      { name: "Outbox event", value: String(event.id), inline: true },
      { name: "Target account", value: payload.targetUserId ? String(payload.targetUserId) : "Not linked", inline: true },
    ],
  };
}

module.exports = { createDetectionTracker, makeEvidenceReference, formatSecurityAlert };
