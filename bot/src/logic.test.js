const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createDetectionTracker,
  formatSecurityAlert,
  makeEvidenceReference,
} = require("./logic");

const config = {
  enabled: true,
  spamThreshold: 3,
  spamWindowSeconds: 10,
  abusiveLanguageRepeatThreshold: 3,
  abusiveTerms: ["example-bad-phrase"],
};

test("spam detection warns at its configured threshold and proposes only a temporary timeout after repeated threshold", () => {
  const tracker = createDetectionTracker();
  const observed = [];
  for (let index = 0; index < 6; index += 1) {
    observed.push(...tracker.observe({
      userId: "discord-user",
      content: "repeated ordinary text",
      now: 1_000 + index * 500,
      config,
    }));
  }
  assert.deepEqual(observed, [
    { type: "spam", count: 3, action: "warn" },
    { type: "spam", count: 6, action: "timeout" },
  ]);
});

test("a single abusive-language match is review-only; only repeated matches reach timeout threshold", () => {
  const tracker = createDetectionTracker();
  const observations = [];
  for (let index = 0; index < 3; index += 1) {
    observations.push(...tracker.observe({
      userId: "discord-user",
      content: `message ${index} contains example-bad-phrase`,
      now: 1_000 + index * 500,
      config,
    }).filter((event) => event.type === "abusive_language"));
  }
  assert.deepEqual(observations, [
    { type: "abusive_language", count: 1, action: "review" },
    { type: "abusive_language", count: 3, action: "timeout" },
  ]);
  assert.equal(JSON.stringify(observations).includes("message 0"), false);
});

test("disabled automation and explicit exemptions never produce automated observations", () => {
  const tracker = createDetectionTracker();
  assert.deepEqual(tracker.observe({
    userId: "discord-user",
    content: "example-bad-phrase",
    now: 1_000,
    config: { ...config, enabled: false },
  }), []);
  assert.deepEqual(tracker.observe({
    userId: "exempt-user",
    content: "example-bad-phrase",
    now: 1_000,
    config,
    exempt: true,
  }), []);
});

test("evidence links accept only supported types and Discord snowflakes", () => {
  assert.equal(
    makeEvidenceReference("message", "12345678901234567", "12345678901234568", "12345678901234569"),
    "discord-message:12345678901234567:12345678901234568:12345678901234569"
  );
  assert.throws(() => makeEvidenceReference("message", "not-an-id", "12345678901234568", "12345678901234569"));
  assert.throws(() => makeEvidenceReference("file", "12345678901234567", "12345678901234568", "12345678901234569"));
});

test("security alerts expose no message content or sensitive incident details", () => {
  const alert = formatSecurityAlert({
    id: 7,
    payload: {
      eventType: "security.discord_incident",
      targetUserId: 42,
      details: { content: "do not leak this", evidenceRef: "discord-message:123" },
    },
  });
  const rendered = JSON.stringify(alert);
  assert.match(rendered, /security\.discord_incident/);
  assert.doesNotMatch(rendered, /do not leak this|discord-message/);
});
