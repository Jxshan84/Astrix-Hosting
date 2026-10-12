import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer, type Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import type Database from "better-sqlite3";
import BetterSqlite from "better-sqlite3";
import { db as database } from "../db/database.js";
import { runMigrations } from "../db/migrations.js";
import { frontendUrl } from "../config.js";
import adminRouter from "./admin.js";
import appealsRouter from "./appeals.js";
import announcementsRouter from "./announcements.js";
import authRouter from "./auth.js";
import premiumSyncRouter from "./premiumSync.js";
import botRouter from "./bot.js";
import welcomeRouter from "./welcome.js";
import { createServerRouter } from "./servers.js";
import { requireAuth, requireUnrestrictedAccount } from "../middleware/auth.js";
import * as dockerFiles from "../services/dockerFileService.js";
import type { ServerProvider } from "../services/serverProvider.js";

const db: Database.Database = database;
const secret = process.env.JWT_SECRET || "";
let server: Server | undefined;
let baseUrl = "";
let failServerProvision = false;
let leaveResourceAfterProvisionFailure = false;
let providerAvailable = true;
let providerCpuCount = 8;
let providerMemoryBytes = 16 * 1024 * 1024 * 1024;
const fakeProvisionedResources = new Set<string>();

const testProvider: ServerProvider = {
  id: "test-docker",
  async checkConnection() {
    return {
      provider: "test-docker",
      connected: providerAvailable,
      hostCpuCount: providerCpuCount,
      hostMemoryBytes: providerMemoryBytes,
      error: providerAvailable ? undefined : "Test provider unavailable.",
    };
  },
  supportedRuntimes() {
    return [{ id: "node", name: "Node.js", image: "node:22-alpine" }];
  },
  async create(id) {
    if (failServerProvision) {
      if (leaveResourceAfterProvisionFailure) fakeProvisionedResources.add(id);
      throw new Error("Test provider unavailable.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    fakeProvisionedResources.add(id);
    return {
      id,
      container: `astrix-${id}`,
      image: "node:22-alpine",
      volume: `astrix-data-${id}`,
      status: "created",
    };
  },
  async status(id) {
    return {
      id,
      container: `astrix-${id}`,
      status: id === "owned-server" || fakeProvisionedResources.has(id) ? "running" : "missing",
    };
  },
  async stats() {
    return { cpu: null, memory: null, memoryPercent: null };
  },
  async logs() {
    return "";
  },
  async start(id) {
    return { id, container: `astrix-${id}`, status: "running" };
  },
  async stop(id) {
    return { id, container: `astrix-${id}`, status: "exited" };
  },
  async restart(id) {
    return { id, container: `astrix-${id}`, status: "running" };
  },
  async remove(id) {
    fakeProvisionedResources.delete(id);
    return { id, deleted: true };
  },
  files: dockerFiles,
};

describe("Astrix security and account workflows", () => {

function session(userId: number, claims: Record<string, unknown> = {}) {
  return `astrix_session=${jwt.sign({ userId, ...claims }, secret)}`;
}

async function request(
  pathName: string,
  userId: number,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers: {
      Cookie: session(userId),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data: data as Record<string, unknown> };
}

before(async () => {
  const now = new Date().toISOString();
  const addUser = db.prepare(`
    INSERT INTO users (email, username, password_hash, plan, role, created_at, updated_at)
    VALUES (?, ?, 'test-hash', 'free', ?, ?, ?)
  `);
  addUser.run("owner@example.test", "owner", "user", now, now);
  addUser.run("staff@example.test", "staff", "owner", now, now);
  addUser.run("member@example.test", "member", "user", now, now);
  addUser.run("outsider@example.test", "outsider", "user", now, now);
  addUser.run("allocation-race@example.test", "allocation-race", "user", now, now);
  addUser.run("provision-failure@example.test", "provision-failure", "user", now, now);
  addUser.run("host-capacity@example.test", "host-capacity", "user", now, now);
  db.prepare("UPDATE users SET discord_id = ? WHERE id = 2").run("12345678901234567");
  db.prepare("UPDATE users SET discord_id = ? WHERE id = 3").run("12345678901234568");
  db.prepare("UPDATE users SET discord_id = ? WHERE id = 4").run("12345678901234569");

  const app = express();
  app.use(express.json({ limit: "100kb" }), cookieParser());
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/appeals", appealsRouter);
  app.use("/api/announcements", announcementsRouter);
  app.use("/api/premium", premiumSyncRouter);
  app.use("/api/bot", botRouter);
  app.use("/api/welcome", welcomeRouter);
  app.use("/api/servers", createServerRouter(testProvider));
  app.get("/restricted", requireAuth, requireUnrestrictedAccount, (_req, res) => {
    res.json({ allowed: true });
  });
  const testServer = createServer(app);
  server = testServer;
  await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
  const address = testServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  assert.ok(secret.length >= 32);
  assert.equal(process.env.OWNER_USER_ID, "1");
  process.env.ASTRIX_BOT_SYNC_KEY = "test-only-bot-sync-key-with-at-least-32-characters";
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  }
  db.close();
});

test("owner identity is server-configured; user role claims do not grant owner access", async () => {
  const owner = await request("/api/admin/settings", 1, {
    headers: { Cookie: session(1, { role: "user", isOwner: false }) },
  });
  assert.equal(owner.response.status, 200);

  const ordinaryUser = await request("/api/admin/settings", 3, {
    headers: { Cookie: session(3, { role: "owner", isOwner: true }) },
  });
  assert.equal(ordinaryUser.response.status, 403);
  assert.equal(ordinaryUser.data.error, "Owner access required.");
});

test("Google OAuth validates its callback, preserves state, links the account, and creates a secure session", async () => {
  const keys = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL",
    "NODE_ENV",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const callbackUrl = new URL("/api/auth/google/callback", frontendUrl).toString();
  const originalFetch = globalThis.fetch;
  const requestedGoogleUrls: string[] = [];

  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  process.env.GOOGLE_CALLBACK_URL = callbackUrl;
  process.env.NODE_ENV = "production";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://oauth2.googleapis.com/") &&
        !url.startsWith("https://openidconnect.googleapis.com/")) {
      return originalFetch(input, init);
    }
    requestedGoogleUrls.push(url);
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("client_id"), "test-google-client");
      assert.equal(form.get("client_secret"), "test-google-secret");
      assert.equal(form.get("redirect_uri"), callbackUrl);
      return Response.json({ access_token: "test-access-token" });
    }
    assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-access-token");
    return Response.json({
      sub: "google-sub-test",
      email: "google-oauth@example.test",
      email_verified: true,
      name: "OAuth Test User",
    });
  };

  try {
    const start = await originalFetch(`${baseUrl}/api/auth/google`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get("location") || "");
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("redirect_uri"), callbackUrl);
    const stateCookie = start.headers.get("set-cookie") || "";
    const state = stateCookie.match(/google_oauth_state=([a-f0-9]{64})/)?.[1];
    assert.ok(state);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/auth/google"]) {
      assert.ok(stateCookie.includes(attribute), `expected state cookie attribute ${attribute}`);
    }
    assert.equal(authorization.searchParams.get("state"), state);

    const callback = await originalFetch(
      `${baseUrl}/api/auth/google/callback?code=test-code&state=${state}`,
      {
        headers: { Cookie: stateCookie.split(";")[0] },
        redirect: "manual",
      }
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), new URL("/dashboard", frontendUrl).toString());
    const sessionCookie = callback.headers.get("set-cookie") || "";
    assert.ok(sessionCookie.includes("astrix_session="));
    assert.ok(sessionCookie.includes("HttpOnly"));
    assert.ok(sessionCookie.includes("Secure"));
    assert.ok(sessionCookie.includes("SameSite=Lax"));
    const token = sessionCookie.match(/astrix_session=([^;]+)/)?.[1];
    assert.ok(token);
    const sessionPayload = jwt.verify(token, secret) as { userId: number };
    const account = db.prepare("SELECT email, google_id FROM users WHERE id = ?")
      .get(sessionPayload.userId) as { email: string; google_id: string };
    assert.deepEqual(account, {
      email: "google-oauth@example.test",
      google_id: "google-sub-test",
    });
    assert.deepEqual(requestedGoogleUrls, [
      "https://oauth2.googleapis.com/token",
      "https://openidconnect.googleapis.com/v1/userinfo",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("welcome rewards validate eligibility, idempotency, concurrency, and expiry without issuing unusable coupons", async () => {
  const ownerClaim = await request("/api/welcome/claim", 1, { method: "POST" });
  assert.equal(ownerClaim.response.status, 403);
  const deniedOwnerControl = await request("/api/admin/welcome", 3, {
    method: "PATCH",
    body: { enabled: false },
  });
  assert.equal(deniedOwnerControl.response.status, 403);

  const settings = await request("/api/admin/welcome", 1, {
    method: "PATCH",
    body: { enabled: true, expiresAt: null, redemptionLimit: 2 },
  });
  assert.equal(settings.response.status, 200);

  const first = await request("/api/welcome/claim", 3, { method: "POST" });
  const replay = await request("/api/welcome/claim", 3, { method: "POST" });
  assert.equal(first.response.status, 200);
  assert.equal(replay.response.status, 200);
  assert.equal((first.data.claim as { couponCode: string | null }).couponCode, null);
  assert.equal((replay.data.claim as { couponCode: string | null }).couponCode, null);
  assert.deepEqual(first.data.rewards, [
    { id: "welcome_badge", type: "badge", name: "Astrix Welcome Badge" },
    { id: "welcome_achievement", type: "achievement", name: "Astrix Pioneer" },
  ]);

  const concurrent = await Promise.all([
    request("/api/welcome/claim", 4, { method: "POST" }),
    request("/api/welcome/claim", 4, { method: "POST" }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.response.status), [200, 200]);
  assert.equal(
    (concurrent[0].data.claim as { couponCode: string }).couponCode,
    (concurrent[1].data.claim as { couponCode: string }).couponCode
  );

  const overLimit = await request("/api/welcome/claim", 5, { method: "POST" });
  assert.equal(overLimit.response.status, 409);
  assert.equal((await request("/api/welcome/claim", 1, { method: "POST" })).response.status, 403);

  const history = await request("/api/admin/welcome/claims", 1);
  assert.equal(history.response.status, 200);
  assert.equal((history.data.claims as unknown[]).length, 2);

  const couponCode = "ASTRIX-LEGACY-QUOTE-TEST";
  db.prepare("UPDATE welcome_reward_claims SET coupon_code = ? WHERE user_id = 3").run(couponCode);
  const publicClaim = await request("/api/welcome/claim", 3);
  assert.equal((publicClaim.data.claim as { couponCode: string | null }).couponCode, null);
  const quote = await request("/api/welcome/quote", 3, {
    method: "POST",
    body: { couponCode, plan: "starter" },
  });
  assert.equal(quote.response.status, 503);
  assert.equal(
    quote.data.error,
    "Discount checkout is not configured. No coupon discount is currently available."
  );
  assert.equal("discountAmountMinor" in quote.data, false);
  assert.equal((await request("/api/welcome/quote", 4, {
    method: "POST",
    body: { couponCode, plan: "pro" },
  })).response.status, 503);
  assert.equal((await request("/api/welcome/quote", 1, {
    method: "POST",
    body: { couponCode, plan: "pro" },
  })).response.status, 403);

  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await request("/api/admin/welcome", 1, {
    method: "PATCH",
    body: { enabled: true, expiresAt: expiredAt, redemptionLimit: null },
  });
  assert.equal((await request("/api/welcome/quote", 3, {
    method: "POST",
    body: { couponCode, plan: "pro" },
  })).response.status, 410);
  assert.equal((await request("/api/welcome/claim", 5, { method: "POST" })).response.status, 410);
  await request("/api/admin/welcome", 1, {
    method: "PATCH",
    body: { enabled: true, expiresAt: null, redemptionLimit: null },
  });
});

test("staff permissions are explicit, staff cannot access owner controls, and announcements send once", async () => {
  const denied = await request("/api/admin/announcements", 2);
  assert.equal(denied.response.status, 403);

  const grant = await request("/api/admin/staff/2", 1, {
    method: "PUT",
    body: { permissions: ["announcement_management", "appeal_review"] },
  });
  assert.equal(grant.response.status, 200);

  const staffOwnerControl = await request("/api/admin/security", 2);
  assert.equal(staffOwnerControl.response.status, 403);
  const staffModerationControl = await request("/api/admin/incidents", 2);
  assert.equal(staffModerationControl.response.status, 403);

  const draft = await request("/api/admin/announcements", 2, {
    method: "POST",
    body: {
      title: "Maintenance",
      message: "Scheduled maintenance notice.",
      audience: "all_users",
      link: "https://example.test/status",
    },
  });
  assert.equal(draft.response.status, 201);
  const id = Number(draft.data.announcementId);
  const preview = await request("/api/admin/announcements/preview", 2, {
    method: "POST",
    body: {
      title: "Maintenance",
      message: "Scheduled maintenance notice.",
      audience: "all_users",
    },
  });
  assert.equal(preview.data.recipientCount, 7);

  const incompleteConfirmation = await request(`/api/admin/announcements/${id}/send`, 2, {
    method: "POST",
    body: { confirm: true, confirmedRecipientCount: 3 },
  });
  assert.equal(incompleteConfirmation.response.status, 409);

  const sent = await request(`/api/admin/announcements/${id}/send`, 2, {
    method: "POST",
    body: { confirm: true, confirmedRecipientCount: 7 },
  });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.data.deliveryCount, 7);
  const duplicate = await request(`/api/admin/announcements/${id}/send`, 2, {
    method: "POST",
    body: { confirm: true, confirmedRecipientCount: 7 },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM announcement_deliveries WHERE announcement_id = ?")
      .get(id) as { count: number }).count,
    7
  );

  const revoked = await request("/api/admin/staff/2", 1, {
    method: "PUT",
    body: { permissions: [] },
  });
  assert.equal(revoked.response.status, 200);
  const revokedAccess = await request("/api/admin/announcements", 2);
  assert.equal(revokedAccess.response.status, 403);
  const appealAccess = await request("/api/admin/staff/2", 1, {
    method: "PUT",
    body: {
      permissions: ["announcement_management", "appeal_review", "discord_moderation"],
    },
  });
  assert.equal(appealAccess.response.status, 200);
  const botAuthorization = await fetch(`${baseUrl}/api/bot/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({ discordId: "12345678901234567", permission: "discord_moderation" }),
  });
  assert.equal(botAuthorization.status, 200);
  assert.equal((await botAuthorization.json() as { authorized: boolean }).authorized, true);

  const revokedModeration = await request("/api/admin/staff/2", 1, {
    method: "PUT",
    body: { permissions: ["announcement_management", "appeal_review"] },
  });
  assert.equal(revokedModeration.response.status, 200);
});

test("server audience targets distinct server owners and requires exact confirmation", async () => {
  const now = new Date().toISOString();
  const addServer = db.prepare(`
    INSERT INTO servers (id, owner_user_id, name, type, container_name, created_at)
    VALUES (?, ?, ?, 'node', ?, ?)
  `);
  addServer.run("server-1", 3, "first", "astrix-server-1", now);
  addServer.run("server-2", 3, "second", "astrix-server-2", now);
  addServer.run("server-3", 4, "third", "astrix-server-3", now);

  const body = {
    title: "Server maintenance",
    message: "A server-focused notice.",
    audience: "all_servers",
  };
  const draft = await request("/api/admin/announcements", 2, {
    method: "POST",
    body,
  });
  assert.equal(draft.response.status, 201);
  const preview = await request("/api/admin/announcements/preview", 2, {
    method: "POST",
    body,
  });
  assert.equal(preview.data.recipientCount, 2);
  const sent = await request(`/api/admin/announcements/${draft.data.announcementId}/send`, 2, {
    method: "POST",
    body: { confirm: true, confirmedRecipientCount: 2 },
  });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.data.deliveryCount, 2);
});

test("restrictions are enforced in middleware; eligible appeals accept safe evidence and approved appeals lift access", async () => {
  const restricted = await request("/api/admin/restrictions/3", 1, {
    method: "POST",
    body: {
      reason: "Review of repeated automated requests.",
      durationMinutes: null,
      evidenceRefs: ["incident:42"],
      appealEligible: true,
    },
  });
  assert.equal(restricted.response.status, 201);
  const blocked = await request("/restricted", 3);
  assert.equal(blocked.response.status, 403);

  const submission = await request("/api/appeals", 3, {
    method: "POST",
    body: { explanation: "I believe the restriction was applied incorrectly and request a review." },
  });
  assert.equal(submission.response.status, 201);
  const appealId = String(submission.data.appealId);

  const attachmentResponse = await fetch(`${baseUrl}/api/appeals/${appealId}/attachments`, {
    method: "POST",
    headers: {
      Cookie: session(3),
      "Content-Type": "image/png",
      "X-File-Name": "proof.png",
    },
    body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  assert.equal(attachmentResponse.status, 201);

  const outsider = await request(`/api/appeals/${appealId}`, 4);
  assert.equal(outsider.response.status, 404);

  const ownerSelfReview = await request(`/api/appeals/${appealId}/decision`, 1, {
    method: "PATCH",
    body: { decision: "approved", notes: "Reviewed the evidence." },
  });
  assert.equal(ownerSelfReview.response.status, 403);

  const reviewer = await request(`/api/appeals/${appealId}/decision`, 2, {
    method: "PATCH",
    body: { decision: "approved", notes: "Reviewed the evidence." },
  });
  assert.equal(reviewer.response.status, 200);
  const allowed = await request("/restricted", 3);
  assert.equal(allowed.response.status, 200);

  const auditMutation = db.prepare("UPDATE audit_log SET event_type = 'changed' WHERE event_type = 'appeal.approved'");
  assert.throws(() => auditMutation.run(), /append-only/);
});

test("bot sync failures return safe responses and do not disclose configuration", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/premium/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-astrix-bot-key": "incorrect" },
    body: JSON.stringify({ discordId: "unlinked", plan: "premium" }),
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Unauthorized." });

  const unlinked = await fetch(`${baseUrl}/api/premium/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": "test-only-bot-sync-key-with-at-least-32-characters",
    },
    body: JSON.stringify({ discordId: "unlinked", plan: "premium" }),
  });
  assert.equal(unlinked.status, 404);
  assert.deepEqual(await unlinked.json(), {
    error: "No hosting account is linked to this Discord ID.",
  });
});

test("bot staff authorization, incident records, and security outbox are backend-controlled", async () => {
  const denied = await fetch(`${baseUrl}/api/bot/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({ discordId: "12345678901234568", permission: "discord_moderation" }),
  });
  assert.equal(denied.status, 200);
  assert.equal((await denied.json() as { authorized: boolean }).authorized, false);

  const ownerPermission = await request("/api/admin/staff/2", 1, {
    method: "PUT",
    body: { permissions: ["discord_moderation", "appeal_review", "announcement_management"] },
  });
  assert.equal(ownerPermission.response.status, 200);
  const auth = await fetch(`${baseUrl}/api/bot/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({ discordId: "12345678901234567", permission: "discord_moderation" }),
  });
  assert.equal((await auth.json() as { authorized: boolean }).authorized, true);

  const malformedEvidence = await fetch(`${baseUrl}/api/bot/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      incidentType: "abusive_language",
      actorDiscordId: "12345678901234568",
      evidenceRef: "message content must never be sent",
      observedCount: 1,
      actionTaken: "observed",
    }),
  });
  assert.equal(malformedEvidence.status, 400);

  await request("/api/admin/security", 1, {
    method: "PATCH",
    body: {
      discordAbuseDetectionEnabled: true,
      discordSpamThreshold: 4,
      discordAbuseTerms: ["example-abuse-term"],
    },
  });
  const config = await fetch(`${baseUrl}/api/bot/config`, {
    headers: { "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "" },
  });
  const settings = await config.json() as { abusiveTerms: string[]; spamThreshold: number };
  assert.deepEqual(settings.abusiveTerms, ["example-abuse-term"]);
  assert.equal(settings.spamThreshold, 4);
  const exemption = await request("/api/admin/security/exemptions/4", 1, {
    method: "PUT",
    body: { reason: "Test account exemption for content automation." },
  });
  assert.equal(exemption.response.status, 200);
  const exemptContentEvidence = "discord-message:12345678901234567:12345678901234568:12345678901234571";
  const exemptContent = await fetch(`${baseUrl}/api/bot/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      incidentType: "spam",
      actorDiscordId: "12345678901234569",
      evidenceRef: exemptContentEvidence,
      observedCount: 4,
      actionTaken: "observed",
    }),
  });
  assert.equal((await exemptContent.json() as { exempt: boolean }).exempt, true);
  const exemptDestructiveEvidence = "discord-auditlog:12345678901234567:12345678901234568:12345678901234572";
  const exemptDestructive = await fetch(`${baseUrl}/api/bot/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      incidentType: "unauthorized_role_change",
      actorDiscordId: "12345678901234569",
      evidenceRef: exemptDestructiveEvidence,
      observedCount: 1,
      actionTaken: "observed",
    }),
  });
  assert.equal(exemptDestructive.status, 201);
  assert.equal(
    (db.prepare("SELECT actor_user_id FROM security_incidents WHERE evidence_ref = ?")
      .get(exemptDestructiveEvidence) as { actor_user_id: number }).actor_user_id,
    4
  );
  const removeExemption = await request("/api/admin/security/exemptions/4", 1, { method: "DELETE" });
  assert.equal(removeExemption.response.status, 200);

  const unlinkedActorEvidence = "discord-auditlog:12345678901234567:12345678901234568:12345678901234569";
  const unlinkedActorIncident = await fetch(`${baseUrl}/api/bot/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      incidentType: "unauthorized_role_change",
      actorDiscordId: "12345678901234570",
      targetDiscordId: "12345678901234569",
      evidenceRef: unlinkedActorEvidence,
      observedCount: 1,
      actionTaken: "observed",
    }),
  });
  assert.equal(unlinkedActorIncident.status, 201);
  const { incidentId } = await unlinkedActorIncident.json() as { incidentId: number };
  assert.equal(
    (db.prepare("SELECT actor_user_id FROM security_incidents WHERE evidence_ref = ?")
      .get(unlinkedActorEvidence) as { actor_user_id: number | null }).actor_user_id,
    null
  );
  const falsePositiveReview = await request(`/api/admin/incidents/${incidentId}`, 1, {
    method: "PATCH",
    body: { status: "dismissed", notes: "Verified this audit event was a false positive." },
  });
  assert.equal(falsePositiveReview.response.status, 200);
  assert.equal(
    (db.prepare("SELECT status FROM security_incidents WHERE id = ?")
      .get(incidentId) as { status: string }).status,
    "dismissed"
  );
  assert.ok(
    (db.prepare("SELECT COUNT(*) AS count FROM bot_outbox WHERE event_type = 'security_incident'")
      .get() as { count: number }).count > 0
  );
});

test("Discord appeal submission requires a linked restricted account and lifts restrictions only after an authorized review", async () => {
  const restricted = await request("/api/admin/restrictions/4", 1, {
    method: "POST",
    body: {
      reason: "Discord-linked account needs an owner review.",
      durationMinutes: null,
      appealEligible: true,
    },
  });
  assert.equal(restricted.response.status, 201);
  const submission = await fetch(`${baseUrl}/api/bot/appeals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      discordId: "12345678901234569",
      explanation: "I believe this action was made in error and respectfully request a review.",
    }),
  });
  assert.equal(submission.status, 201);
  const { appealId } = await submission.json() as { appealId: string };
  const decision = await fetch(`${baseUrl}/api/bot/appeals/${appealId}/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({
      discordId: "12345678901234567",
      decision: "approved",
      notes: "Reviewed the appeal and reversed the restriction.",
    }),
  });
  assert.equal(decision.status, 200);
  assert.equal((await request("/restricted", 4)).response.status, 200);
  assert.ok(
    (db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE appeal_id = ?")
      .get(appealId) as { count: number }).count > 0
  );
});

test("premium sync validates its shared-secret feature and synchronizes a linked account", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/premium/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": "incorrect",
    },
    body: JSON.stringify({ discordId: "12345678901234568", plan: "pro" }),
  });
  assert.equal(unauthorized.status, 401);

  const synced = await fetch(`${baseUrl}/api/premium/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-astrix-bot-key": process.env.ASTRIX_BOT_SYNC_KEY || "",
    },
    body: JSON.stringify({ discordId: "12345678901234568", plan: "pro" }),
  });
  assert.equal(synced.status, 200);
  assert.equal((await synced.json() as { plan: string }).plan, "pro");
  assert.equal(
    (db.prepare("SELECT plan FROM users WHERE discord_id = ?")
      .get("12345678901234568") as { plan: string }).plan,
    "pro"
  );
});

test("owner security thresholds are validated and the emergency disable is persisted", async () => {
  const invalid = await request("/api/admin/security", 1, {
    method: "PATCH",
    body: { overloadRequiredStrikes: 11 },
  });
  assert.equal(invalid.response.status, 400);

  const saved = await request("/api/admin/security", 1, {
    method: "PATCH",
    body: {
      automationEnabled: false,
      overloadCpuThreshold: 88,
      overloadMemoryThreshold: 85,
      overloadRequiredStrikes: 4,
    },
  });
  assert.equal(saved.response.status, 200);
  const loaded = await request("/api/admin/security", 1);
  const settings = loaded.data.settings as Record<string, unknown>;
  assert.equal(settings.automation_enabled, 0);
  assert.equal(settings.overload_cpu_threshold, 88);
  assert.equal(settings.overload_memory_threshold, 85);
  assert.equal(settings.overload_required_strikes, 4);
  await request("/api/admin/security", 1, {
    method: "PATCH",
    body: { automationEnabled: true },
  });
});

test("server catalog reports provider unavailability and atomic reservations enforce slot limits", async () => {
  providerAvailable = false;
  const catalog = await request("/api/servers/catalog", 3);
  assert.equal(catalog.response.status, 200);
  assert.equal((catalog.data.provider as { connected: boolean }).connected, false);
  assert.equal(catalog.data.nodes, null);
  assert.deepEqual(catalog.data.runtimes, [{ id: "node", name: "Node.js" }]);
  providerAvailable = true;

  const attempts = await Promise.all([
    request("/api/servers", 5, { method: "POST", body: { name: "first" } }),
    request("/api/servers", 5, { method: "POST", body: { name: "second" } }),
  ]);
  assert.deepEqual(attempts.map(({ response }) => response.status).sort(), [201, 403]);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM server_allocations WHERE owner_user_id = 5").get() as { count: number }).count,
    0
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM servers WHERE owner_user_id = 5").get() as { count: number }).count,
    1
  );
});

test("server reservations reject plans larger than real remaining host capacity", async () => {
  providerCpuCount = 2;
  providerMemoryBytes = 4 * 1024 * 1024 * 1024;
  db.prepare("UPDATE users SET plan = 'pro' WHERE id = 7").run();
  const result = await request("/api/servers", 7, {
    method: "POST",
    body: { name: "exceeds-host-capacity" },
  });
  assert.equal(result.response.status, 409);
  assert.match(String(result.data.error), /insufficient unallocated CPU or memory/);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM server_allocations WHERE owner_user_id = 7").get() as { count: number }).count,
    0
  );
  providerCpuCount = 8;
  providerMemoryBytes = 16 * 1024 * 1024 * 1024;
});

test("failed provider provisioning releases the server reservation", async () => {
  failServerProvision = true;
  try {
    const result = await request("/api/servers", 6, {
      method: "POST",
      body: { name: "provider-failure" },
    });
    assert.equal(result.response.status, 500, JSON.stringify(result.data));
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM server_allocations WHERE owner_user_id = 6").get() as { count: number }).count,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM servers WHERE owner_user_id = 6").get() as { count: number }).count,
      0
    );
  } finally {
    failServerProvision = false;
  }
});

test("an unverified provider resource keeps its allocation reserved after failure", async () => {
  failServerProvision = true;
  leaveResourceAfterProvisionFailure = true;
  try {
    const result = await request("/api/servers", 6, {
      method: "POST",
      body: { name: "unverified-provider-resource" },
    });
    assert.equal(result.response.status, 500);
    const reservation = db.prepare(`
      SELECT server_id FROM server_allocations WHERE owner_user_id = 6
    `).get() as { server_id: string };
    assert.ok(fakeProvisionedResources.has(reservation.server_id));
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM server_allocations WHERE owner_user_id = 6").get() as { count: number }).count,
      1
    );
    fakeProvisionedResources.delete(reservation.server_id);
    db.prepare("DELETE FROM server_allocations WHERE server_id = ?").run(reservation.server_id);
  } finally {
    failServerProvision = false;
    leaveResourceAfterProvisionFailure = false;
  }
});

test("server file paths reject traversal and absolute paths before provider access", () => {
  assert.throws(() => dockerFiles.validateFilePath("../outside"), /parent directory/);
  assert.throws(() => dockerFiles.validateFilePath("/etc/passwd"), /relative file path/);
  assert.throws(() => dockerFiles.validateFilePath("safe/../outside"), /parent directory/);
  assert.doesNotThrow(() => dockerFiles.validateFilePath("safe/nested/file.txt"));
});

test("server details are limited to their authenticated owner", async () => {
  db.prepare(`
    INSERT INTO servers (id, owner_user_id, name, type, container_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("owned-server", 3, "Owned", "node", "astrix-owned-server", new Date().toISOString());
  const owner = await request("/api/servers/owned-server", 3);
  assert.equal(owner.response.status, 200);
  const otherAccount = await request("/api/servers/owned-server", 4, {
    headers: { Cookie: session(4, { role: "owner", isOwner: true }) },
  });
  assert.equal(otherAccount.response.status, 404);
  const fileAccess = await request("/api/servers/owned-server/files?path=..", 4);
  assert.equal(fileAccess.response.status, 404);
});

test("stale allocation controls are owner-only", async () => {
  const denied = await request("/api/admin/allocations", 3);
  assert.equal(denied.response.status, 403);
  const owner = await request("/api/admin/allocations", 1);
  assert.equal(owner.response.status, 200);
  assert.deepEqual(owner.data.allocations, []);
});

test("versioned migration preserves legacy announcement records", () => {
  const legacy = new BetterSqlite(":memory:");
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
    INSERT INTO users (id) VALUES (2);
    CREATE TABLE servers (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      container_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO servers VALUES (
      'legacy-server', 2, 'Preserved instance', 'node',
      'astrix-legacy-server', '2025-01-01T00:00:00.000Z'
    );
    CREATE TABLE server_allocations (
      server_id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO server_allocations VALUES (
      'interrupted-allocation', 2, '2025-01-01T00:00:00.000Z'
    );
    CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO announcements (title, message, created_at, updated_at)
    VALUES ('Existing notice', 'Keep this content', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
  `);
  runMigrations(legacy);
  const row = legacy.prepare(`
    SELECT title, message, status, sent_at FROM announcements WHERE id = 1
  `).get() as { title: string; message: string; status: string; sent_at: string };
  assert.deepEqual(row, {
    title: "Existing notice",
    message: "Keep this content",
    status: "sent",
    sent_at: "2025-01-01T00:00:00.000Z",
  });
  assert.equal((legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 6);
  assert.equal(
    (legacy.prepare("PRAGMA table_info(welcome_reward_claims)").all() as Array<{ name: string; notnull: number }>)
      .find((column) => column.name === "coupon_code")?.notnull,
    0
  );
  legacy.prepare(`
    INSERT INTO welcome_reward_claims (user_id, coupon_code, claimed_at)
    VALUES (1, NULL, '2025-01-01T00:00:00.000Z')
  `).run();
  assert.equal(
    (legacy.prepare("SELECT coupon_code FROM welcome_reward_claims WHERE user_id = 1").get() as { coupon_code: string | null }).coupon_code,
    null
  );
  assert.deepEqual(
    legacy.prepare("SELECT allocated_memory_mb, allocated_cpu_cores FROM servers WHERE id = 'legacy-server'").get(),
    { allocated_memory_mb: 512, allocated_cpu_cores: 0.5 }
  );
  assert.deepEqual(
    legacy.prepare("SELECT memory_mb, cpu_cores FROM server_allocations WHERE server_id = 'interrupted-allocation'").get(),
    { memory_mb: 65_536, cpu_cores: 64 }
  );
  assert.deepEqual(
    legacy.prepare("SELECT id, owner_user_id, name FROM servers").get(),
    { id: "legacy-server", owner_user_id: 2, name: "Preserved instance" }
  );
  legacy.prepare(`
    INSERT INTO staff_permissions (user_id, permission, granted_by, created_at)
    VALUES (2, 'discord_moderation', 1, '2025-01-01T00:00:00.000Z')
  `).run();
  assert.equal(
    (legacy.prepare("SELECT permission FROM staff_permissions WHERE user_id = 2").get() as { permission: string }).permission,
    "discord_moderation"
  );
  runMigrations(legacy);
  assert.equal((legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 6);
  legacy.close();
});
});
