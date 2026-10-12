const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BACKEND_URL = "http://127.0.0.1:4000";
process.env.ASTRIX_BOT_SYNC_KEY = "test-only-bot-sync-key-with-at-least-32-characters";
process.env.DISCORD_BOT_TOKEN = "test-only-token";
process.env.DISCORD_GUILD_ID = "12345678901234567";
process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = "12345678901234568";

const {
  client,
  api,
  commandDefinitions,
  deliverOutboxEvent,
  safeDiscordAttachment,
  validateBackendUrl,
} = require("./index");

test("bot registers the expected appeals and moderation commands", () => {
  const names = commandDefinitions().map((command) => command.name);
  assert.deepEqual(names, ["appeal", "appeal-status", "review-appeal", "warn", "timeout"]);
});

test("bot rejects untrusted attachment hosts before making a request", async () => {
  await assert.rejects(
    safeDiscordAttachment({
      url: "http://127.0.0.1/private",
      size: 32,
      name: "proof.png",
    }),
    /Only attachments hosted by Discord/
  );
});

test("bot rejects insecure remote and production backend URLs", () => {
  assert.throws(() => validateBackendUrl("http://backend.example", "development"), /must use HTTPS/);
  assert.throws(() => validateBackendUrl("http://127.0.0.1:4000", "production"), /must use HTTPS/);
  assert.throws(() => validateBackendUrl("https://user:password@backend.example", "production"), /embedded credentials/);
  assert.doesNotThrow(() => validateBackendUrl("http://127.0.0.1:4000", "development"));
  assert.doesNotThrow(() => validateBackendUrl("https://backend.example", "production"));
});

test("bot API requests refuse redirects while authenticating", async () => {
  const originalFetch = global.fetch;
  let requestOptions;
  global.fetch = async (_url, options) => {
    requestOptions = options;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await api("/health");
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(requestOptions.redirect, "error");
  assert.ok(requestOptions.headers["x-astrix-bot-key"]);
});

test("bot reports unsupported outbox event types without contacting Discord", async () => {
  await assert.rejects(
    deliverOutboxEvent({ id: 1, type: "unknown", payload: {} }),
    /Unsupported bot outbox event/
  );
});

test("announcement delivery uses the outbox ID as Discord's duplicate-send nonce", async () => {
  const originalFetch = client.channels.fetch;
  let sentPayload;
  client.channels.fetch = async () => ({
    isTextBased: () => true,
    send: async (payload) => {
      sentPayload = payload;
    },
  });
  try {
    await deliverOutboxEvent({
      id: 42,
      type: "announcement",
      payload: { title: "Maintenance", message: "Scheduled work", link: null },
    });
  } finally {
    client.channels.fetch = originalFetch;
  }
  assert.equal(sentPayload.nonce, "42");
  assert.equal(sentPayload.enforceNonce, true);
});
