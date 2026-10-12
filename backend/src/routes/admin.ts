import { Router } from "express";
import { db } from "../db/database.js";
import {
  configuredOwnerId,
  isOwner,
  requireAuth,
  requireOwner,
  requirePermission,
  type AuthRequest,
  type StaffPermission,
} from "../middleware/auth.js";
import { enqueueBotEvent, recordAudit } from "../services/audit.js";
import { getAllPlanLimits } from "../services/planService.js";
import { serverProvider } from "../services/serverProvider.js";

const router = Router();
const permissions = [
  "announcement_management",
  "moderation_review",
  "discord_moderation",
  "appeal_review",
  "support_review",
] as const satisfies readonly StaffPermission[];
type Audience = "all_users" | "all_servers";

router.use(requireAuth);

function parseAnnouncement(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const audience = body.audience;
  const link =
    body.link === undefined || body.link === "" || body.link === null
      ? null
      : body.link;

  if (
    !title ||
    title.length > 160 ||
    !message ||
    message.length > 10_000 ||
    (audience !== "all_users" && audience !== "all_servers") ||
    (link !== null && typeof link !== "string")
  ) {
    return null;
  }

  if (typeof link === "string") {
    if (link.length > 2_000) return null;
    try {
      const parsed = new URL(link);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    } catch {
      return null;
    }
  }
  return { title, message, audience: audience as Audience, link: link as string | null };
}

function recipients(audience: Audience) {
  return audience === "all_servers"
    ? (db.prepare(`
        SELECT DISTINCT owner_user_id AS id FROM servers ORDER BY owner_user_id
      `).all() as Array<{ id: number }>).map((row) => row.id)
    : (db.prepare("SELECT id FROM users ORDER BY id").all() as Array<{ id: number }>).map(
        (row) => row.id
      );
}

router.get("/settings", requireOwner, (_req, res) => {
  const settings = db.prepare("SELECT * FROM site_settings WHERE id = 1").get();
  return res.json({ settings });
});

router.patch("/settings", requireOwner, (req: AuthRequest, res) => {
  const { supportEnabled, workStart, workEnd, timezone } = req.body || {};
  if (
    (supportEnabled !== undefined && typeof supportEnabled !== "boolean") ||
    (workStart !== undefined &&
      (typeof workStart !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workStart))) ||
    (workEnd !== undefined &&
      (typeof workEnd !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workEnd))) ||
    (timezone !== undefined && (typeof timezone !== "string" || timezone.length > 80))
  ) {
    return res.status(400).json({ error: "Invalid support settings." });
  }
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return res.status(400).json({ error: "Invalid support timezone." });
    }
  }

  const current = db.prepare("SELECT * FROM site_settings WHERE id = 1").get() as {
    support_enabled: number;
    work_start: string;
    work_end: string;
    timezone: string;
  };
  db.prepare(`
    UPDATE site_settings SET support_enabled = ?, work_start = ?, work_end = ?, timezone = ?
    WHERE id = 1
  `).run(
    supportEnabled === undefined ? current.support_enabled : supportEnabled ? 1 : 0,
    workStart ?? current.work_start,
    workEnd ?? current.work_end,
    timezone ?? current.timezone
  );
  recordAudit("settings.support_updated", req.userId ?? null, null, {});
  return res.json({ success: true, message: "Support settings updated." });
});

router.get("/provider", requireOwner, async (_req, res) => {
  const status = await serverProvider.checkConnection();
  return res.json({
    provider: {
      id: serverProvider.id,
      connected: status.connected,
      status: status.connected ? "connected" : "setup_required",
      version: status.version ?? null,
      hostCpuCount: status.hostCpuCount ?? null,
      hostMemoryBytes: status.hostMemoryBytes ?? null,
      allocation: status.allocation ?? "manual",
    },
    runtimes: serverProvider.supportedRuntimes().map(({ id, name, image }) => ({
      id,
      name,
      image,
    })),
    placement: "Node and location discovery are not exposed by the configured Docker Engine.",
  });
});

router.get("/allocations", requireOwner, async (_req, res) => {
  const providerStatus = await serverProvider.checkConnection();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = db.prepare(`
    SELECT allocations.server_id, allocations.owner_user_id, users.username,
      allocations.created_at, allocations.memory_mb, allocations.cpu_cores
    FROM server_allocations AS allocations
    LEFT JOIN users ON users.id = allocations.owner_user_id
    WHERE allocations.created_at < ?
    ORDER BY allocations.created_at
  `).all(staleBefore) as Array<{
    server_id: string;
    owner_user_id: number;
    username: string | null;
    created_at: string;
    memory_mb: number;
    cpu_cores: number;
  }>;
  const allocations = await Promise.all(rows.map(async (row) => {
    let resourceStatus = "unknown";
    if (providerStatus.connected) {
      try {
        resourceStatus = (await serverProvider.status(row.server_id)).status;
      } catch (error) {
        console.error(`Unable to inspect stale server allocation ${row.server_id}.`, error);
      }
    }
    return {
      serverId: row.server_id,
      ownerUserId: row.owner_user_id,
      username: row.username,
      createdAt: row.created_at,
      memoryMb: row.memory_mb,
      cpuCores: row.cpu_cores,
      providerStatus: resourceStatus,
    };
  }));
  return res.json({ allocations });
});

router.delete("/allocations/:serverId", requireOwner, async (req: AuthRequest, res) => {
  const serverId = typeof req.params.serverId === "string" ? req.params.serverId : "";
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const reservation = db.prepare(`
    SELECT server_id FROM server_allocations
    WHERE server_id = ? AND created_at < ?
  `).get(serverId, staleBefore);
  if (!reservation) return res.status(404).json({ error: "Stale allocation not found." });

  try {
    const state = await serverProvider.status(serverId);
    if (state.status !== "missing") {
      return res.status(409).json({
        error: "The provider resource still exists or its status is unknown. Reconcile it manually before releasing its reservation.",
      });
    }
    const release = db.transaction(() => {
      const result = db.prepare(`
        DELETE FROM server_allocations
        WHERE server_id = ? AND created_at < ?
      `).run(serverId, staleBefore);
      if (result.changes !== 1) return false;
      recordAudit("server.allocation_released", req.userId ?? null, null, {
        serverId,
        reason: "provider_resource_missing",
      });
      return true;
    }).immediate();
    if (!release) return res.status(404).json({ error: "Stale allocation not found." });
    return res.json({ success: true });
  } catch (error) {
    console.error("Unable to verify pending server allocation before release.", error);
    return res.status(503).json({ error: "The provider could not confirm that the resource is missing." });
  }
});

router.get("/plans", requireOwner, (_req, res) => {
  return res.json({ plans: getAllPlanLimits() });
});

router.patch("/plans/:plan", requireOwner, (req: AuthRequest, res) => {
  const plan = typeof req.params.plan === "string" ? req.params.plan : "";
  const { maxServers, memoryMb, cpuCores } = req.body || {};
  if (
    !["free", "starter", "pro", "premium"].includes(plan) ||
    !Number.isInteger(maxServers) ||
    maxServers < 0 ||
    maxServers > 100 ||
    !Number.isInteger(memoryMb) ||
    memoryMb < 128 ||
    memoryMb > 65_536 ||
    typeof cpuCores !== "number" ||
    !Number.isFinite(cpuCores) ||
    cpuCores <= 0 ||
    cpuCores > 64
  ) {
    return res.status(400).json({ error: "Plan limits are outside the allowed range." });
  }
  const previous = getAllPlanLimits()[plan as "free" | "starter" | "pro" | "premium"];
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE plan_limits
    SET max_servers = ?, memory_mb = ?, cpu_cores = ?, updated_by = ?, updated_at = ?
    WHERE plan = ?
  `).run(maxServers, memoryMb, cpuCores, req.userId, now, plan);
  recordAudit("plan.limits_updated", req.userId ?? null, null, {
    plan,
    previous,
    limits: { maxServers, memoryMb, cpuCores },
  });
  return res.json({ success: true });
});

router.get("/welcome", requireOwner, (_req, res) => {
  const settings = db.prepare("SELECT * FROM welcome_campaign WHERE id = 1").get() as {
    enabled: number;
    percentage: number;
    expires_at: string | null;
    redemption_limit: number | null;
    updated_at: string;
  };
  const claimsIssued = (db.prepare(
    "SELECT COUNT(*) AS count FROM welcome_reward_claims"
  ).get() as { count: number }).count;
  return res.json({
    campaign: {
      enabled: Boolean(settings.enabled),
      percentage: settings.percentage,
      expiresAt: settings.expires_at,
      redemptionLimit: settings.redemption_limit,
      claimsIssued,
      updatedAt: settings.updated_at,
    },
  });
});

router.patch("/welcome", requireOwner, (req: AuthRequest, res) => {
  const { enabled, expiresAt, redemptionLimit } = req.body || {};
  if (
    (enabled !== undefined && typeof enabled !== "boolean") ||
    (expiresAt !== undefined && expiresAt !== null && (
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString() !== expiresAt
    )) ||
    (redemptionLimit !== undefined && redemptionLimit !== null && (
      !Number.isInteger(redemptionLimit) || redemptionLimit < 1 || redemptionLimit > 1_000_000
    ))
  ) {
    return res.status(400).json({ error: "Invalid welcome campaign settings." });
  }
  const current = db.prepare("SELECT * FROM welcome_campaign WHERE id = 1").get() as {
    enabled: number;
    expires_at: string | null;
    redemption_limit: number | null;
  };
  const nextEnabled = enabled === undefined ? current.enabled : enabled ? 1 : 0;
  const nextExpiry = expiresAt === undefined ? current.expires_at : expiresAt;
  const nextLimit = redemptionLimit === undefined ? current.redemption_limit : redemptionLimit;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE welcome_campaign
    SET enabled = ?, expires_at = ?, redemption_limit = ?, updated_by = ?, updated_at = ?
    WHERE id = 1
  `).run(nextEnabled, nextExpiry, nextLimit, req.userId, now);
  recordAudit("welcome.campaign_updated", req.userId ?? null, null, {
    enabled: Boolean(nextEnabled),
    expiresAt: nextExpiry,
    redemptionLimit: nextLimit,
  });
  return res.json({ success: true });
});

router.get("/welcome/claims", requireOwner, (_req, res) => {
  const claims = db.prepare(`
    SELECT claims.user_id, users.username, claims.coupon_code, claims.claimed_at,
      claims.redeemed_at, claims.redeemed_plan
    FROM welcome_reward_claims AS claims
    JOIN users ON users.id = claims.user_id
    ORDER BY claims.claimed_at DESC
  `).all();
  return res.json({ claims });
});

router.get("/announcements", requirePermission("announcement_management"), (_req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.username AS creator_name,
      (SELECT bo.status FROM bot_outbox bo
       WHERE bo.event_type = 'announcement'
         AND json_extract(bo.payload_json, '$.announcementId') = a.id
       ORDER BY bo.id DESC LIMIT 1) AS discord_delivery_status
    FROM announcements a
    LEFT JOIN users u ON u.id = a.creator_user_id
    ORDER BY a.created_at DESC, a.id DESC
  `).all();
  return res.json({ announcements });
});

router.post("/announcements/preview", requirePermission("announcement_management"), (req, res) => {
  const announcement = parseAnnouncement(req.body);
  if (!announcement) return res.status(400).json({ error: "Invalid announcement details." });
  return res.json({
    audience: announcement.audience,
    recipientCount: recipients(announcement.audience).length,
    delivery: "in_app",
  });
});

router.post("/announcements", requirePermission("announcement_management"), (req: AuthRequest, res) => {
  const announcement = parseAnnouncement(req.body);
  if (!announcement) return res.status(400).json({ error: "Invalid announcement details." });
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO announcements
      (title, message, enabled, created_at, updated_at, creator_user_id, audience, link, status)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'draft')
  `).run(
    announcement.title,
    announcement.message,
    now,
    now,
    req.userId,
    announcement.audience,
    announcement.link
  );
  recordAudit("announcement.created", req.userId ?? null, null, {
    announcementId: Number(result.lastInsertRowid),
    audience: announcement.audience,
  });
  return res.status(201).json({ success: true, announcementId: result.lastInsertRowid });
});

router.patch(
  "/announcements/:id",
  requirePermission("announcement_management"),
  (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid announcement ID." });
    }
    const announcement = parseAnnouncement(req.body);
    if (!announcement) return res.status(400).json({ error: "Invalid announcement details." });
    const result = db.prepare(`
      UPDATE announcements
      SET title = ?, message = ?, audience = ?, link = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(
      announcement.title,
      announcement.message,
      announcement.audience,
      announcement.link,
      new Date().toISOString(),
      id
    );
    if (!result.changes) {
      return res.status(404).json({ error: "Draft announcement not found." });
    }
    recordAudit("announcement.edited", req.userId ?? null, null, { announcementId: id });
    return res.json({ success: true });
  }
);

router.post(
  "/announcements/:id/send",
  requirePermission("announcement_management"),
  (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid announcement ID." });
    }
    const announcement = db.prepare(`
      SELECT id, title, message, audience, link, status
      FROM announcements WHERE id = ?
    `).get(id) as {
      id: number;
      title: string;
      message: string;
      audience: Audience;
      link: string | null;
      status: string;
    } | undefined;
    if (!announcement) return res.status(404).json({ error: "Announcement not found." });
    if (announcement.status !== "draft") {
      return res.status(409).json({ error: "This announcement has already been sent or is not a draft." });
    }

    const userIds = recipients(announcement.audience);
    if (!userIds.length) return res.status(409).json({ error: "This audience has no recipients." });
    if (
      req.body?.confirm !== true ||
      req.body?.confirmedRecipientCount !== userIds.length
    ) {
      return res.status(409).json({
        error: "Confirm the current recipient count before sending.",
        recipientCount: userIds.length,
      });
    }

    const now = new Date().toISOString();
    try {
      const send = db.transaction(() => {
        const currentRecipients = recipients(announcement.audience);
        if (
          currentRecipients.length !== userIds.length ||
          currentRecipients.some((userId, index) => userId !== userIds[index])
        ) {
          throw new Error("Announcement audience changed.");
        }
        const claimed = db.prepare(`
          UPDATE announcements SET status = 'sending', updated_at = ?
          WHERE id = ? AND status = 'draft'
        `).run(now, id);
        if (!claimed.changes) throw new Error("Announcement is no longer a draft.");

        const addDelivery = db.prepare(`
          INSERT INTO announcement_deliveries
            (announcement_id, user_id, status, created_at)
          VALUES (?, ?, 'delivered', ?)
        `);
        const addNotification = db.prepare(`
          INSERT INTO notifications (user_id, announcement_id, title, message, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const userId of userIds) {
          addDelivery.run(id, userId, now);
          addNotification.run(
            userId,
            id,
            announcement.title,
            announcement.link
              ? `${announcement.message}\n\n${announcement.link}`
              : announcement.message,
            now
          );
        }
        db.prepare(`
          UPDATE announcements
          SET status = 'sent', sent_at = ?, delivery_count = ?, failure_count = 0, updated_at = ?
          WHERE id = ?
        `).run(now, userIds.length, now, id);
        recordAudit("announcement.sent", req.userId ?? null, null, {
          announcementId: id,
          audience: announcement.audience,
          recipientCount: userIds.length,
        });
        if (announcement.audience === "all_users") {
          enqueueBotEvent("announcement", {
            announcementId: id,
            title: announcement.title,
            message: announcement.message,
            audience: announcement.audience,
            link: announcement.link,
          });
        }
      });
      send();
      return res.json({
        success: true,
        status: "sent",
        delivery: "in_app",
        deliveryCount: userIds.length,
        failureCount: 0,
        discordDelivery: announcement.audience === "all_users" ? "queued" : "not_requested",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Announcement is no longer a draft.") {
        return res.status(409).json({ error: "This announcement has already been sent." });
      }
      if (error instanceof Error && error.message === "Announcement audience changed.") {
        return res.status(409).json({
          error: "The audience changed after preview. Preview again before sending.",
          recipientCount: recipients(announcement.audience).length,
        });
      }
      console.error("Announcement delivery transaction failed.");
      return res.status(500).json({ error: "Announcement was not sent. Please review its status before retrying." });
    }
  }
);

router.get("/staff", requireOwner, (_req, res) => {
  const staff = db.prepare(`
    SELECT u.id AS user_id, u.username, u.email, sp.permission, sp.granted_by, sp.created_at
    FROM users u
    LEFT JOIN staff_permissions sp ON sp.user_id = u.id
    WHERE u.id != ?
    ORDER BY u.username, sp.permission
    LIMIT 500
  `).all(configuredOwnerId() ?? -1);
  return res.json({ staff, permissions });
});

router.put("/staff/:userId", requireOwner, (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  const requested = req.body?.permissions;
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !Array.isArray(requested) ||
    requested.some((permission: unknown) => !permissions.includes(permission as StaffPermission)) ||
    new Set(requested).size !== requested.length
  ) {
    return res.status(400).json({ error: "Invalid staff account or permissions." });
  }
  if (userId === configuredOwnerId()) {
    return res.status(400).json({ error: "Owner permissions cannot be changed here." });
  }
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) {
    return res.status(404).json({ error: "User account not found." });
  }

  const change = db.transaction(() => {
    const current = db.prepare(`
      SELECT permission FROM staff_permissions WHERE user_id = ?
    `).all(userId).map((row) => (row as { permission: string }).permission);
    const remove = db.prepare("DELETE FROM staff_permissions WHERE user_id = ? AND permission = ?");
    const add = db.prepare(`
      INSERT INTO staff_permissions (user_id, permission, granted_by, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const permission of current) {
      if (!requested.includes(permission)) {
        remove.run(userId, permission);
        recordAudit("staff.permission_revoked", req.userId ?? null, userId, { permission });
      }
    }
    for (const permission of requested as StaffPermission[]) {
      if (!current.includes(permission)) {
        add.run(userId, permission, req.userId, now);
        recordAudit("staff.permission_granted", req.userId ?? null, userId, { permission });
      }
    }
  });
  change();
  return res.json({ success: true, permissions: requested });
});

router.get("/security", requireOwner, (_req, res) => {
  const settings = db.prepare("SELECT * FROM security_settings WHERE id = 1").get();
  return res.json({ settings });
});

router.patch("/security", requireOwner, (req: AuthRequest, res) => {
  const {
    automationEnabled,
    loginFailureThreshold,
    loginLockoutMinutes,
    spamThresholdPerMinute,
    discordAbuseDetectionEnabled,
    discordSpamThreshold,
    discordSpamWindowSeconds,
    discordAbuseRepeatThreshold,
    discordTimeoutMinutes,
    discordAbuseTerms,
    overloadCpuThreshold,
    overloadMemoryThreshold,
    overloadRequiredStrikes,
  } = req.body || {};
  if (
    (automationEnabled !== undefined && typeof automationEnabled !== "boolean") ||
    (loginFailureThreshold !== undefined &&
      (!Number.isInteger(loginFailureThreshold) || loginFailureThreshold < 3 || loginFailureThreshold > 50)) ||
    (loginLockoutMinutes !== undefined &&
      (!Number.isInteger(loginLockoutMinutes) || loginLockoutMinutes < 1 || loginLockoutMinutes > 1440)) ||
    (spamThresholdPerMinute !== undefined &&
      (!Number.isInteger(spamThresholdPerMinute) || spamThresholdPerMinute < 3 || spamThresholdPerMinute > 100)) ||
    (overloadCpuThreshold !== undefined &&
      (typeof overloadCpuThreshold !== "number" || overloadCpuThreshold < 50 || overloadCpuThreshold > 100)) ||
    (overloadMemoryThreshold !== undefined &&
      (typeof overloadMemoryThreshold !== "number" || overloadMemoryThreshold < 50 || overloadMemoryThreshold > 100)) ||
    (overloadRequiredStrikes !== undefined &&
      (!Number.isInteger(overloadRequiredStrikes) || overloadRequiredStrikes < 2 || overloadRequiredStrikes > 10)) ||
    (discordAbuseDetectionEnabled !== undefined && typeof discordAbuseDetectionEnabled !== "boolean") ||
    (discordSpamThreshold !== undefined &&
      (!Number.isInteger(discordSpamThreshold) || discordSpamThreshold < 3 || discordSpamThreshold > 100)) ||
    (discordSpamWindowSeconds !== undefined &&
      (!Number.isInteger(discordSpamWindowSeconds) || discordSpamWindowSeconds < 3 || discordSpamWindowSeconds > 120)) ||
    (discordAbuseRepeatThreshold !== undefined &&
      (!Number.isInteger(discordAbuseRepeatThreshold) || discordAbuseRepeatThreshold < 2 || discordAbuseRepeatThreshold > 20)) ||
    (discordTimeoutMinutes !== undefined &&
      (!Number.isInteger(discordTimeoutMinutes) || discordTimeoutMinutes < 1 || discordTimeoutMinutes > 10080)) ||
    (discordAbuseTerms !== undefined &&
      (!Array.isArray(discordAbuseTerms) ||
        discordAbuseTerms.length > 50 ||
        discordAbuseTerms.some((term: unknown) =>
          typeof term !== "string" || term.trim().length < 2 || term.trim().length > 80
        )))
  ) {
    return res.status(400).json({ error: "Invalid security settings." });
  }
  const current = db.prepare("SELECT * FROM security_settings WHERE id = 1").get() as {
    automation_enabled: number;
    login_failure_threshold: number;
    login_lockout_minutes: number;
    spam_threshold_per_minute: number;
    overload_cpu_threshold: number;
    overload_memory_threshold: number;
    overload_required_strikes: number;
    discord_abuse_detection_enabled: number;
    discord_spam_threshold: number;
    discord_spam_window_seconds: number;
    discord_abuse_repeat_threshold: number;
    discord_timeout_minutes: number;
    discord_abuse_terms_json: string;
  };
  const normalizedTerms = discordAbuseTerms === undefined
    ? current.discord_abuse_terms_json
    : JSON.stringify([...new Set((discordAbuseTerms as string[]).map((term) => term.trim().toLowerCase()))]);
  db.prepare(`
    UPDATE security_settings
    SET automation_enabled = ?, login_failure_threshold = ?,
    login_lockout_minutes = ?, spam_threshold_per_minute = ?,
    overload_cpu_threshold = ?, overload_memory_threshold = ?,
    overload_required_strikes = ?,
    discord_abuse_detection_enabled = ?, discord_spam_threshold = ?,
    discord_spam_window_seconds = ?, discord_abuse_repeat_threshold = ?,
    discord_timeout_minutes = ?, discord_abuse_terms_json = ?,
    updated_by = ?, updated_at = ?
    WHERE id = 1
  `).run(
    automationEnabled === undefined ? current.automation_enabled : automationEnabled ? 1 : 0,
    loginFailureThreshold ?? current.login_failure_threshold,
    loginLockoutMinutes ?? current.login_lockout_minutes,
    spamThresholdPerMinute ?? current.spam_threshold_per_minute,
    overloadCpuThreshold ?? current.overload_cpu_threshold,
    overloadMemoryThreshold ?? current.overload_memory_threshold,
    overloadRequiredStrikes ?? current.overload_required_strikes,
    discordAbuseDetectionEnabled === undefined
      ? current.discord_abuse_detection_enabled
      : discordAbuseDetectionEnabled ? 1 : 0,
    discordSpamThreshold ?? current.discord_spam_threshold,
    discordSpamWindowSeconds ?? current.discord_spam_window_seconds,
    discordAbuseRepeatThreshold ?? current.discord_abuse_repeat_threshold,
    discordTimeoutMinutes ?? current.discord_timeout_minutes,
    normalizedTerms,
    req.userId,
    new Date().toISOString()
  );
  recordAudit("security.settings_updated", req.userId ?? null, null, {
    automationEnabled,
    loginFailureThreshold,
    loginLockoutMinutes,
    spamThresholdPerMinute,
    overloadCpuThreshold,
    overloadMemoryThreshold,
    overloadRequiredStrikes,
    discordAbuseDetectionEnabled,
    discordSpamThreshold,
    discordSpamWindowSeconds,
    discordAbuseRepeatThreshold,
    discordTimeoutMinutes,
    abusiveTermCount: discordAbuseTerms?.length,
  });
  return res.json({ success: true });
});

router.get("/security/exemptions", requireOwner, (_req, res) => {
  const exemptions = db.prepare(`
    SELECT e.user_id, u.username, e.reason, e.created_by, e.created_at
    FROM security_exemptions e JOIN users u ON u.id = e.user_id
    ORDER BY e.created_at DESC
  `).all();
  return res.json({ exemptions });
});

router.put("/security/exemptions/:userId", requireOwner, (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  const reason = req.body?.reason;
  if (!Number.isSafeInteger(userId) || userId < 1 || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 1_000) {
    return res.status(400).json({ error: "A valid account and exemption reason are required." });
  }
  if (userId === configuredOwnerId()) return res.status(400).json({ error: "The owner account does not need a security exemption." });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) {
    return res.status(404).json({ error: "User account not found." });
  }
  db.prepare(`
    INSERT INTO security_exemptions (user_id, reason, created_by, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason,
      created_by = excluded.created_by, created_at = excluded.created_at
  `).run(userId, reason.trim(), req.userId, new Date().toISOString());
  recordAudit("security.exemption_added", req.userId ?? null, userId, { reason: reason.trim() });
  return res.json({ success: true });
});

router.delete("/security/exemptions/:userId", requireOwner, (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Invalid account ID." });
  }
  const result = db.prepare("DELETE FROM security_exemptions WHERE user_id = ?").run(userId);
  if (!result.changes) return res.status(404).json({ error: "Security exemption not found." });
  recordAudit("security.exemption_removed", req.userId ?? null, userId, {});
  return res.json({ success: true });
});

router.get(
  "/incidents",
  requirePermission("moderation_review"),
  (_req, res) => {
    const incidents = db.prepare(`
      SELECT id, incident_type, actor_user_id, evidence_ref, action_taken,
             status, reviewer_user_id, reviewer_notes, created_at, reviewed_at
      FROM security_incidents ORDER BY created_at DESC LIMIT 500
    `).all();
    return res.json({ incidents });
  }
);

router.patch(
  "/incidents/:id",
  requirePermission("moderation_review"),
  (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { status, notes, revokeDiscordModeration } = req.body || {};
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["reviewed", "dismissed"].includes(status) ||
      typeof notes !== "string" ||
      notes.trim().length < 1 ||
      notes.length > 2_000 ||
      (revokeDiscordModeration !== undefined && typeof revokeDiscordModeration !== "boolean") ||
      (revokeDiscordModeration && !isOwner(req.userId))
    ) {
      return res.status(400).json({ error: "Invalid incident review." });
    }
    const now = new Date().toISOString();
    const incident = db.prepare(`
      SELECT actor_user_id FROM security_incidents WHERE id = ? AND status = 'open'
    `).get(id) as { actor_user_id: number | null } | undefined;
    if (!incident) return res.status(404).json({ error: "Open incident not found." });
    const result = db.prepare(`
      UPDATE security_incidents
      SET status = ?, reviewer_user_id = ?, reviewer_notes = ?, reviewed_at = ?
      WHERE id = ? AND status = 'open'
    `).run(status, req.userId, notes.trim(), now, id);
    if (!result.changes) return res.status(404).json({ error: "Open incident not found." });
    let permissionRevoked = false;
    if (revokeDiscordModeration && incident.actor_user_id !== null) {
      permissionRevoked = Boolean(db.prepare(`
        DELETE FROM staff_permissions
        WHERE user_id = ? AND permission = 'discord_moderation'
      `).run(incident.actor_user_id).changes);
      if (permissionRevoked) {
        recordAudit("staff.permission_revoked", req.userId ?? null, incident.actor_user_id, {
          permission: "discord_moderation",
          incidentId: id,
        });
      }
    }
    recordAudit("security.incident_reviewed", req.userId ?? null, incident.actor_user_id, {
      incidentId: id,
      status,
      permissionRevoked,
      notes: notes.trim(),
    });
    return res.json({ success: true, permissionRevoked });
  }
);

router.get("/restrictions", requireOwner, (_req, res) => {
  const restrictions = db.prepare(`
    SELECT r.*, u.username
    FROM account_restrictions r JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC LIMIT 500
  `).all();
  return res.json({ restrictions });
});

router.post("/restrictions/:userId", requireOwner, (req: AuthRequest, res) => {
  const userId = Number(req.params.userId);
  const { reason, durationMinutes, evidenceRefs, appealEligible } = req.body || {};
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    typeof reason !== "string" ||
    reason.trim().length < 3 ||
    reason.length > 2_000 ||
    (durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 525_600)) ||
    (evidenceRefs !== undefined &&
      (!Array.isArray(evidenceRefs) ||
        evidenceRefs.length > 20 ||
        evidenceRefs.some((value: unknown) => typeof value !== "string" || value.length > 500))) ||
    (appealEligible !== undefined && typeof appealEligible !== "boolean")
  ) {
    return res.status(400).json({ error: "Invalid restriction details." });
  }
  if (userId === configuredOwnerId()) {
    return res.status(400).json({ error: "The configured owner account cannot be restricted." });
  }
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) {
    return res.status(404).json({ error: "User account not found." });
  }
  const existing = db.prepare(`
    SELECT id FROM account_restrictions
    WHERE user_id = ? AND revoked_at IS NULL
      AND (restriction_type = 'permanent' OR expires_at > ?)
    LIMIT 1
  `).get(userId, new Date().toISOString());
  if (existing) return res.status(409).json({ error: "This account already has an active restriction." });

  const now = new Date();
  const expiresAt = durationMinutes === null
    ? null
    : new Date(now.getTime() + durationMinutes * 60_000).toISOString();
  const result = db.prepare(`
    INSERT INTO account_restrictions
      (user_id, restriction_type, reason, evidence_refs_json, appeal_eligible, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    durationMinutes === null ? "permanent" : "temporary",
    reason.trim(),
    JSON.stringify(evidenceRefs ?? []),
    appealEligible === false ? 0 : 1,
    req.userId,
    now.toISOString(),
    expiresAt
  );
  recordAudit("account.restricted", req.userId ?? null, userId, {
    restrictionId: Number(result.lastInsertRowid),
    type: durationMinutes === null ? "permanent" : "temporary",
    reason: reason.trim(),
    evidenceRefs: evidenceRefs ?? [],
    expiresAt,
  });
  return res.status(201).json({
    success: true,
    restrictionId: Number(result.lastInsertRowid),
    type: durationMinutes === null ? "permanent" : "temporary",
    expiresAt,
  });
});

router.delete("/restrictions/:id", requireOwner, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const reason = req.body?.reason;
  if (!Number.isSafeInteger(id) || id < 1 || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 2_000) {
    return res.status(400).json({ error: "A valid restriction ID and reversal reason are required." });
  }
  const row = db.prepare(`
    SELECT user_id FROM account_restrictions WHERE id = ? AND revoked_at IS NULL
  `).get(id) as { user_id: number } | undefined;
  if (!row) return res.status(404).json({ error: "Active restriction not found." });
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE account_restrictions
    SET revoked_by = ?, revoked_at = ?, revocation_reason = ? WHERE id = ?
  `).run(req.userId, now, reason.trim(), id);
  recordAudit("account.restriction_revoked", req.userId ?? null, row.user_id, {
    restrictionId: id,
    reason: reason.trim(),
  });
  return res.json({ success: true });
});

router.get("/audit", requireOwner, (_req, res) => {
  const events = db.prepare(`
    SELECT event_id, actor_user_id, event_type, target_user_id, details_json, created_at
    FROM audit_log ORDER BY created_at DESC LIMIT 500
  `).all();
  return res.json({ events });
});

router.post("/announcements/:id/reopen", requireOwner, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid announcement ID." });
  }
  const result = db.prepare(`
    UPDATE announcements SET status = 'draft', sent_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'failed'
  `).run(new Date().toISOString(), id);
  if (!result.changes) return res.status(409).json({ error: "Only failed announcements can be reopened." });
  recordAudit("announcement.reopened", req.userId ?? null, null, { announcementId: id });
  return res.json({ success: true });
});

export default router;
