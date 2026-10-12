import { Router } from "express";
import { db } from "../db/database.js";
import { isOwner, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";

const router = Router();
const grantedRewards = [
  { id: "welcome_badge", type: "badge", name: "Astrix Welcome Badge" },
  { id: "welcome_achievement", type: "achievement", name: "Astrix Pioneer" },
] as const;

type Campaign = {
  enabled: number;
  percentage: number;
  expires_at: string | null;
  redemption_limit: number | null;
};

function campaign() {
  return db.prepare(`
    SELECT enabled, percentage, expires_at, redemption_limit
    FROM welcome_campaign WHERE id = 1
  `).get() as Campaign;
}

function campaignIsCurrent(value: Campaign, now = new Date()) {
  return value.enabled === 1 && (!value.expires_at || value.expires_at > now.toISOString());
}

function eligible(userId: number) {
  if (isOwner(userId)) return false;
  return !db.prepare(`
    SELECT 1 FROM account_restrictions
    WHERE user_id = ? AND revoked_at IS NULL
      AND (restriction_type = 'permanent' OR expires_at > ?)
    LIMIT 1
  `).get(userId, new Date().toISOString());
}

function publicCampaign(value = campaign()) {
  const claimCount = (db.prepare(
    "SELECT COUNT(*) AS count FROM welcome_reward_claims"
  ).get() as { count: number }).count;
  const active = campaignIsCurrent(value);
  const claimsOpen = active && (value.redemption_limit === null || claimCount < value.redemption_limit);
  return {
    enabled: value.enabled === 1,
    active,
    claimsOpen,
    expiresAt: value.expires_at,
    redemptionLimit: value.redemption_limit,
    claimsIssued: claimCount,
    checkoutConfigured: false,
    rewards: grantedRewards,
    terms: {
      rewards: "One Astrix Welcome Badge and one Astrix Pioneer achievement per eligible account.",
      discounts: "Discounts are unavailable until a checkout integration can redeem them.",
    },
  };
}

router.get("/campaign", (_req, res) => {
  return res.json({ campaign: publicCampaign() });
});

router.get("/claim", requireAuth, (req: AuthRequest, res) => {
  const row = db.prepare(`
    SELECT coupon_code, claimed_at, redeemed_at, redeemed_plan
    FROM welcome_reward_claims WHERE user_id = ?
  `).get(req.userId) as {
    coupon_code: string | null;
    claimed_at: string;
    redeemed_at: string | null;
    redeemed_plan: string | null;
  } | undefined;
  return res.json({
    claim: row ? {
      couponCode: null,
      claimedAt: row.claimed_at,
      rewards: grantedRewards,
      redeemedAt: row.redeemed_at,
      redeemedPlan: row.redeemed_plan,
    } : null,
    eligible: req.userId ? eligible(req.userId) : false,
    checkoutConfigured: false,
    rewards: grantedRewards,
  });
});

router.post("/claim", requireAuth, (req: AuthRequest, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Authentication required." });

  const issueClaim = db.transaction(() => {
    const existing = db.prepare(`
      SELECT coupon_code, claimed_at FROM welcome_reward_claims WHERE user_id = ?
    `).get(userId) as { coupon_code: string | null; claimed_at: string } | undefined;
    if (existing) return { claim: existing };

    const current = campaign();
    if (!campaignIsCurrent(current)) return { error: "This welcome promotion is not active." };
    if (!eligible(userId)) return { error: "This account is not eligible for the welcome reward." };
    const totalClaims = (db.prepare(
      "SELECT COUNT(*) AS count FROM welcome_reward_claims"
    ).get() as { count: number }).count;
    if (current.redemption_limit !== null && totalClaims >= current.redemption_limit) {
      return { error: "The welcome promotion has reached its claim limit." };
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO welcome_reward_claims (user_id, coupon_code, claimed_at)
      VALUES (?, NULL, ?)
    `).run(userId, now);
    recordAudit("welcome.reward_claimed", userId, userId, {
      claimedAt: now,
      rewards: grantedRewards.map((reward) => reward.id),
    });
    return { claim: { coupon_code: null, claimed_at: now } };
  }).immediate();

  if ("error" in issueClaim && issueClaim.error) {
    const status = issueClaim.error.includes("not eligible") ? 403
      : issueClaim.error.includes("limit") ? 409 : 410;
    return res.status(status).json({ error: issueClaim.error });
  }
  if (!issueClaim.claim) {
    return res.status(500).json({ error: "Unable to issue the welcome reward." });
  }
  return res.status(200).json({
    success: true,
    claim: {
      couponCode: null,
      claimedAt: issueClaim.claim.claimed_at,
      rewards: grantedRewards,
    },
    checkoutConfigured: false,
    rewards: grantedRewards,
  });
});

router.post("/quote", requireAuth, (_req: AuthRequest, res) => {
  return res.status(503).json({
    error: "Discount checkout is not configured. No coupon discount is currently available.",
  });
});

export default router;