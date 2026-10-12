"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

type Announcement = {
  id: number;
  title: string;
  message: string;
  audience: "all_users" | "all_servers";
  link: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
  creator_name: string | null;
  delivery_count: number;
  failure_count: number;
  discord_delivery_status: string | null;
};
type Exemption = { user_id: number; username: string; reason: string };
type Permission = "announcement_management" | "moderation_review" | "appeal_review" | "support_review" | "discord_moderation";
type StaffMember = { user_id: number; username: string; email: string; permission: Permission | null };
type Restriction = {
  id: number;
  user_id: number;
  username: string;
  restriction_type: string;
  reason: string;
  expires_at: string | null;
  revoked_at: string | null;
};
type Incident = {
  id: number;
  incident_type: string;
  evidence_ref: string;
  action_taken: string;
  actor_user_id: number | null;
  status: string;
  created_at: string;
};
type Appeal = {
  id: string;
  username: string;
  status: string;
  explanation: string;
  reason: string;
  submitted_at: string;
  evidenceRefs: string[];
};
type PlanLimits = { maxServers: number; memoryMb: number; cpuCores: number };
type PlanId = "free" | "starter" | "pro" | "premium";
type ProviderInfo = {
  id: string;
  connected: boolean;
  status: string;
  version: string | null;
  hostCpuCount: number | null;
  hostMemoryBytes: number | null;
  allocation: string;
};
type PendingAllocation = {
  serverId: string;
  ownerUserId: number;
  username: string | null;
  createdAt: string;
  memoryMb: number;
  cpuCores: number;
  providerStatus: string;
};
type WelcomeCampaign = {
  enabled: boolean;
  percentage: number;
  expiresAt: string | null;
  redemptionLimit: number | null;
  claimsIssued: number;
};
type WelcomeHistory = {
  user_id: number;
  username: string;
  coupon_code: string | null;
  claimed_at: string;
  redeemed_at: string | null;
  redeemed_plan: string | null;
};

const permissionNames: Record<Permission, string> = {
  announcement_management: "Manage announcements",
  moderation_review: "Review moderation incidents",
  discord_moderation: "Use Discord moderation commands",
  appeal_review: "Review appeals",
  support_review: "Review support tickets",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function OwnerDashboard() {
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [supportEnabled, setSupportEnabled] = useState(true);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("21:00");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementId, setAnnouncementId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all_users" | "all_servers">("all_users");
  const [link, setLink] = useState("");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState("");
  const [staffPermissions, setStaffPermissions] = useState<Permission[]>([]);
  const [securityEnabled, setSecurityEnabled] = useState(true);
  const [loginThreshold, setLoginThreshold] = useState(10);
  const [lockoutMinutes, setLockoutMinutes] = useState(15);
  const [spamThreshold, setSpamThreshold] = useState(10);
  const [overloadCpuThreshold, setOverloadCpuThreshold] = useState(95);
  const [overloadMemoryThreshold, setOverloadMemoryThreshold] = useState(92);
  const [overloadStrikes, setOverloadStrikes] = useState(3);
  const [discordAbuseEnabled, setDiscordAbuseEnabled] = useState(true);
  const [discordSpamThreshold, setDiscordSpamThreshold] = useState(8);
  const [discordSpamWindowSeconds, setDiscordSpamWindowSeconds] = useState(10);
  const [discordAbuseRepeatThreshold, setDiscordAbuseRepeatThreshold] = useState(3);
  const [discordTimeoutMinutes, setDiscordTimeoutMinutes] = useState(10);
  const [discordAbuseTerms, setDiscordAbuseTerms] = useState("");
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [exemptionUserId, setExemptionUserId] = useState("");
  const [exemptionReason, setExemptionReason] = useState("");
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [restrictionReason, setRestrictionReason] = useState("");
  const [restrictionEvidenceRefs, setRestrictionEvidenceRefs] = useState("");
  const [restrictionAppealEligible, setRestrictionAppealEligible] = useState(true);
  const [restrictionDuration, setRestrictionDuration] = useState("permanent");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [pendingAllocations, setPendingAllocations] = useState<PendingAllocation[]>([]);
  const [planLimits, setPlanLimits] = useState<Record<PlanId, PlanLimits> | null>(null);
  const [welcomeCampaign, setWelcomeCampaign] = useState<WelcomeCampaign | null>(null);
  const [welcomeExpiresAt, setWelcomeExpiresAt] = useState("");
  const [welcomeRedemptionLimit, setWelcomeRedemptionLimit] = useState("");
  const [welcomeHistory, setWelcomeHistory] = useState<WelcomeHistory[]>([]);
  const groupedStaff = useMemo(() => {
    const grouped = new Map<number, { username: string; email: string; permissions: Permission[] }>();
    for (const item of staff) {
      const member = grouped.get(item.user_id) || {
        username: item.username,
        email: item.email,
        permissions: [],
      };
      if (item.permission) member.permissions.push(item.permission);
      grouped.set(item.user_id, member);
    }
    return [...grouped.entries()];
  }, [staff]);

  async function loadDashboard() {
    setError("");
    try {
      const session = await api<{ user: { isOwner?: boolean } }>("/api/auth/me");
      if (!session.user?.isOwner) throw new Error("Sign in with the configured owner account to continue.");
      const [settings, announcementData, staffData, securityData, restrictionData, incidentData, appealData, exemptionData, providerData, allocationData, planData, welcomeData, welcomeHistoryData] =
        await Promise.all([
          api<{ settings: { support_enabled: number; work_start: string; work_end: string } }>("/api/admin/settings"),
          api<{ announcements: Announcement[] }>("/api/admin/announcements"),
          api<{ staff: StaffMember[] }>("/api/admin/staff"),
          api<{ settings: {
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
          } }>("/api/admin/security"),
          api<{ restrictions: Restriction[] }>("/api/admin/restrictions"),
          api<{ incidents: Incident[] }>("/api/admin/incidents"),
          api<{ appeals: Appeal[] }>("/api/appeals"),
          api<{ exemptions: Exemption[] }>("/api/admin/security/exemptions"),
          api<{ provider: ProviderInfo }>("/api/admin/provider"),
          api<{ allocations: PendingAllocation[] }>("/api/admin/allocations"),
          api<{ plans: Record<PlanId, PlanLimits> }>("/api/admin/plans"),
          api<{ campaign: WelcomeCampaign }>("/api/admin/welcome"),
          api<{ claims: WelcomeHistory[] }>("/api/admin/welcome/claims"),
        ]);
      setSupportEnabled(Boolean(settings.settings.support_enabled));
      setWorkStart(settings.settings.work_start);
      setWorkEnd(settings.settings.work_end);
      setAnnouncements(announcementData.announcements);
      setStaff(staffData.staff);
      setSecurityEnabled(Boolean(securityData.settings.automation_enabled));
      setLoginThreshold(securityData.settings.login_failure_threshold);
      setLockoutMinutes(securityData.settings.login_lockout_minutes);
      setSpamThreshold(securityData.settings.spam_threshold_per_minute);
      setOverloadCpuThreshold(securityData.settings.overload_cpu_threshold);
      setOverloadMemoryThreshold(securityData.settings.overload_memory_threshold);
      setOverloadStrikes(securityData.settings.overload_required_strikes);
      setDiscordAbuseEnabled(Boolean(securityData.settings.discord_abuse_detection_enabled));
      setDiscordSpamThreshold(securityData.settings.discord_spam_threshold);
      setDiscordSpamWindowSeconds(securityData.settings.discord_spam_window_seconds);
      setDiscordAbuseRepeatThreshold(securityData.settings.discord_abuse_repeat_threshold);
      setDiscordTimeoutMinutes(securityData.settings.discord_timeout_minutes);
      setDiscordAbuseTerms(
        (JSON.parse(securityData.settings.discord_abuse_terms_json) as string[]).join("\n")
      );
      setRestrictions(restrictionData.restrictions);
      setIncidents(incidentData.incidents);
      setAppeals(appealData.appeals);
      setExemptions(exemptionData.exemptions);
      setProviderInfo(providerData.provider);
      setPendingAllocations(allocationData.allocations);
      setPlanLimits(planData.plans);
      setWelcomeCampaign(welcomeData.campaign);
      setWelcomeExpiresAt(localDateTime(welcomeData.campaign.expiresAt));
      setWelcomeRedemptionLimit(welcomeData.campaign.redemptionLimit?.toString() || "");
      setWelcomeHistory(welcomeHistoryData.claims);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load owner controls.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadDashboard);
  }, []);

  async function saveSupport() {
    setError("");
    try {
      const data = await api<{ message: string }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ supportEnabled, workStart, workEnd, timezone: "Asia/Kolkata" }),
      });
      setNotice(data.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save support settings.");
    }

  }

  async function savePlanLimits(plan: PlanId) {
    if (!planLimits) return;
    setError("");
    try {
      await api(`/api/admin/plans/${plan}`, {
        method: "PATCH",
        body: JSON.stringify(planLimits[plan]),
      });
      setNotice(`${plan} resource and slot limits updated.`);
      await loadDashboard();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update plan limits.");
    }
  }

  async function saveWelcomeCampaign() {
    if (!welcomeCampaign) return;
    setError("");
    try {
      await api("/api/admin/welcome", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: welcomeCampaign.enabled,
          expiresAt: welcomeExpiresAt ? new Date(welcomeExpiresAt).toISOString() : null,
          redemptionLimit: welcomeRedemptionLimit ? Number(welcomeRedemptionLimit) : null,
        }),
      });
      setNotice("Welcome promotion settings updated.");
      await loadDashboard();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update the welcome promotion.");
    }
  }

  async function releaseStaleAllocation(allocation: PendingAllocation) {
    if (allocation.providerStatus !== "missing") return;
    if (!window.confirm(`Release the stale resource reservation for ${allocation.serverId}?`)) return;
    setError("");
    try {
      await api(`/api/admin/allocations/${encodeURIComponent(allocation.serverId)}`, {
        method: "DELETE",
      });
      setNotice(`Released the reservation for ${allocation.serverId}.`);
      await loadDashboard();
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "Unable to release the allocation.");
    }
  }

  function announcementBody() {
    return { title, message, audience, link: link.trim() || null };
  }

  async function previewAnnouncement() {
    setError("");
    try {
      const preview = await api<{ recipientCount: number }>("/api/admin/announcements/preview", {
        method: "POST",
        body: JSON.stringify(announcementBody()),
      });
      setRecipientCount(preview.recipientCount);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to preview announcement.");
    }
  }

  async function saveAnnouncement() {
    setError("");
    try {
      if (announcementId) {
        await api(`/api/admin/announcements/${announcementId}`, {
          method: "PATCH",
          body: JSON.stringify(announcementBody()),
        });
        setNotice("Announcement draft updated.");
      } else {
        await api("/api/admin/announcements", {
          method: "POST",
          body: JSON.stringify(announcementBody()),
        });
        setNotice("Announcement draft saved.");
      }
      setAnnouncementId(null);
      setTitle("");
      setMessage("");
      setLink("");
      setRecipientCount(null);
      await loadDashboard();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save announcement.");
    }
  }

  async function sendAnnouncement() {
    setError("");
    try {
      let id = announcementId;
      if (id) {
        await api(`/api/admin/announcements/${id}`, {
          method: "PATCH",
          body: JSON.stringify(announcementBody()),
        });
      } else {
        const created = await api<{ announcementId: number }>("/api/admin/announcements", {
          method: "POST",
          body: JSON.stringify(announcementBody()),
        });
        id = created.announcementId;
        setAnnouncementId(id);
      }
      const preview = await api<{ recipientCount: number }>("/api/admin/announcements/preview", {
        method: "POST",
        body: JSON.stringify(announcementBody()),
      });
      if (preview.recipientCount < 1) throw new Error("This audience has no recipients.");
      const confirmed = window.confirm(
        `Send “${title}” to ${preview.recipientCount} ${audience === "all_servers" ? "server owners" : "accounts"}? This cannot be sent twice.`
      );
      if (!confirmed) {
        setNotice("Announcement draft saved and ready to continue later.");
        await loadDashboard();
        return;
      }
      await api(`/api/admin/announcements/${id}/send`, {
        method: "POST",
        body: JSON.stringify({ confirm: true, confirmedRecipientCount: preview.recipientCount }),
      });
      setNotice(`Announcement delivered to ${preview.recipientCount} account(s) in the website inbox.`);
      setAnnouncementId(null);
      setTitle("");
      setMessage("");
      setLink("");
      setRecipientCount(null);
      await loadDashboard();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send announcement.");
    }
  }

  function editAnnouncement(item: Announcement) {
    if (item.status !== "draft") return;
    setAnnouncementId(item.id);
    setTitle(item.title);
    setMessage(item.message);
    setAudience(item.audience);
    setLink(item.link || "");
    setRecipientCount(null);
  }

  function togglePermission(permission: Permission) {
    setStaffPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  }

  async function saveStaffPermissions(id = staffId) {
    setError("");
    try {
      await api(`/api/admin/staff/${id}`, {
        method: "PUT",
        body: JSON.stringify({ permissions: staffPermissions }),
      });
      setNotice("Staff permissions updated.");
      setStaffId("");
      setStaffPermissions([]);
      await loadDashboard();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update staff permissions.");
    }
  }

  async function saveSecurity() {
    setError("");
    try {
      await api("/api/admin/security", {
        method: "PATCH",
        body: JSON.stringify({
          automationEnabled: securityEnabled,
          loginFailureThreshold: loginThreshold,
          loginLockoutMinutes: lockoutMinutes,
          spamThresholdPerMinute: spamThreshold,
          overloadCpuThreshold,
          overloadMemoryThreshold,
          overloadRequiredStrikes: overloadStrikes,
          discordAbuseDetectionEnabled: discordAbuseEnabled,
          discordSpamThreshold,
          discordSpamWindowSeconds,
          discordAbuseRepeatThreshold,
          discordTimeoutMinutes,
          discordAbuseTerms: discordAbuseTerms.split("\n").map((term) => term.trim()).filter(Boolean),
        }),
      });
      setNotice("Security settings updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update security settings.");
    }
  }

  async function saveSecurityExemption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/admin/security/exemptions/${exemptionUserId}`, {
        method: "PUT",
        body: JSON.stringify({ reason: exemptionReason }),
      });
      setNotice("Security exemption saved.");
      setExemptionUserId("");
      setExemptionReason("");
      await loadDashboard();
    } catch (exemptionError) {
      setError(exemptionError instanceof Error ? exemptionError.message : "Unable to save exemption.");
    }
  }

  async function removeSecurityExemption(userId: number) {
    setError("");
    try {
      await api(`/api/admin/security/exemptions/${userId}`, { method: "DELETE" });
      setNotice("Security exemption removed.");
      await loadDashboard();
    } catch (exemptionError) {
      setError(exemptionError instanceof Error ? exemptionError.message : "Unable to remove exemption.");
    }
  }

  async function applyRestriction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/admin/restrictions/${targetUserId}`, {
        method: "POST",
        body: JSON.stringify({
          reason: restrictionReason,
          durationMinutes: restrictionDuration === "permanent" ? null : Number(restrictionDuration),
          evidenceRefs: restrictionEvidenceRefs.split("\n").map((ref) => ref.trim()).filter(Boolean),
          appealEligible: restrictionAppealEligible,
        }),
      });
      setNotice("Account restriction applied.");
      setTargetUserId("");
      setRestrictionReason("");
      setRestrictionEvidenceRefs("");
      setRestrictionAppealEligible(true);
      await loadDashboard();
    } catch (restrictionError) {
      setError(restrictionError instanceof Error ? restrictionError.message : "Unable to restrict account.");
    }
  }

  async function reverseRestriction(id: number) {
    const reason = window.prompt("Reason for reversing this restriction:");
    if (!reason) return;
    setError("");
    try {
      await api(`/api/admin/restrictions/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason }),
      });
      setNotice("Restriction reversed.");
      await loadDashboard();
    } catch (reversalError) {
      setError(reversalError instanceof Error ? reversalError.message : "Unable to reverse restriction.");
    }
  }

  async function reviewIncident(
    id: number,
    status: "reviewed" | "dismissed",
    revokeDiscordModeration = false
  ) {
    const notes = window.prompt("Add a note to the incident review:");
    if (!notes) return;
    setError("");
    try {
      await api(`/api/admin/incidents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes, revokeDiscordModeration }),
      });
      setNotice("Incident review saved.");
      await loadDashboard();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to review incident.");
    }
  }

  return (
    <main className="owner-page">
      <section className="owner-header">
        <span className="support-badge">OWNER CONTROL CENTER</span>
        <h1>Astrix Hosting</h1>
        <p>Manage announcements, staff access, account safety, incidents, and appeals.</p>
      </section>

      {loading && <p role="status">Loading owner controls...</p>}
      {error && <p className="owner-notice" role="alert">{error}</p>}
      {notice && <p className="owner-notice" role="status">{notice}</p>}

      {!loading && !error && (
        <>
          <section className="owner-card">
            <span className="support-badge">SERVER PROVIDER</span>
            <h2>Provider connectivity</h2>
            {providerInfo?.connected ? (
              <>
                <p role="status">
                  {providerInfo.id} Engine {providerInfo.version} connected · {providerInfo.allocation} allocation
                </p>
                <p>
                  Host capacity: {providerInfo.hostCpuCount} CPU cores · {providerInfo.hostMemoryBytes === null
                    ? "memory unknown"
                    : `${(providerInfo.hostMemoryBytes / 1024 / 1024 / 1024).toFixed(1)} GiB RAM`}
                </p>
              </>
            ) : (
              <p role="status">Docker Engine setup required. Server actions remain unavailable until the persistent backend host can reach its configured Docker Engine.</p>
            )}
            <p>Node and location inventory is not exposed by this Docker Engine. Resource limits apply to new allocations and do not resize existing containers.</p>
          </section>

          <section className="owner-card">
            <span className="support-badge">PLAN ALLOCATION</span>
            <h2>Server limits</h2>
            <p>Limits below are enforced by the backend during atomic server allocation. Changing a limit does not alter existing containers.</p>
            {planLimits && (Object.entries(planLimits) as Array<[PlanId, PlanLimits]>).map(([plan, limits]) => (
              <div className="owner-list-item" key={plan}>
                <strong>{plan}</strong>
                <div className="owner-form-grid">
                  <label>Server slots<input type="number" min={0} max={100} value={limits.maxServers} onChange={(event) => setPlanLimits((current) => current && ({ ...current, [plan]: { ...current[plan], maxServers: Number(event.target.value) } }))} /></label>
                  <label>RAM per server (MiB)<input type="number" min={128} max={65536} step={128} value={limits.memoryMb} onChange={(event) => setPlanLimits((current) => current && ({ ...current, [plan]: { ...current[plan], memoryMb: Number(event.target.value) } }))} /></label>
                  <label>CPU cores<input type="number" min={0.1} max={64} step={0.1} value={limits.cpuCores} onChange={(event) => setPlanLimits((current) => current && ({ ...current, [plan]: { ...current[plan], cpuCores: Number(event.target.value) } }))} /></label>
                </div>
                <button onClick={() => void savePlanLimits(plan)}>Save {plan} limits</button>
              </div>
            ))}
          </section>

          <section className="owner-card">
            <span className="support-badge">WELCOME PROMOTION</span>
            <h2>Ribbon reward campaign</h2>
            <p>Eligible accounts can claim an Astrix Welcome Badge and Pioneer achievement once. No discounts or coupon codes are offered while checkout redemption is unavailable. The account cap limits reward claims.</p>
            {welcomeCampaign && <>
              <label className="owner-check">
                <input
                  type="checkbox"
                  checked={welcomeCampaign.enabled}
                  onChange={(event) => setWelcomeCampaign((current) => current && ({ ...current, enabled: event.target.checked }))}
                />
                Campaign enabled
              </label>
              <div className="owner-form-grid">
                <label>Promotion expiry (local time)<input type="datetime-local" value={welcomeExpiresAt} onChange={(event) => setWelcomeExpiresAt(event.target.value)} /></label>
                <label>Maximum accounts (blank for unlimited)<input type="number" min={1} max={1_000_000} value={welcomeRedemptionLimit} onChange={(event) => setWelcomeRedemptionLimit(event.target.value)} placeholder="Unlimited" /></label>
              </div>
              <p>{welcomeCampaign.claimsIssued} account(s) have claimed rewards. Existing claims remain in the history when the campaign is disabled.</p>
              <button className="primary-owner-button" onClick={() => void saveWelcomeCampaign()}>Save welcome settings</button>
            </>}
            <h3>Claim history</h3>
            {welcomeHistory.length ? welcomeHistory.map((claim) => (
              <article className="owner-list-item" key={claim.user_id}>
                <div>
                  <strong>{claim.username} · account {claim.user_id}</strong>
                  <p>Claimed {new Date(claim.claimed_at).toLocaleString()} · {claim.coupon_code ? "Legacy coupon not redeemable until checkout is configured" : "Welcome Badge and Pioneer achievement issued"}</p>
                </div>
              </article>
            )) : <p className="empty">No welcome reward claims yet.</p>}
          </section>

          <section className="owner-card">
            <span className="support-badge">RECOVERY</span>
            <h2>Stale server reservations</h2>
            <p>Reservations older than 15 minutes remain counted until reviewed. A reservation can only be released after the provider confirms that its resource is missing. Existing provider resources require manual reconciliation to avoid losing data.</p>
            {pendingAllocations.length ? pendingAllocations.map((allocation) => (
              <div className="owner-list-item" key={allocation.serverId}>
                <strong>{allocation.serverId}</strong>
                <span>
                  {allocation.username || `Account ${allocation.ownerUserId}`} · {allocation.memoryMb} MiB · {allocation.cpuCores} CPU · provider: {allocation.providerStatus} · {new Date(allocation.createdAt).toLocaleString()}
                </span>
                <button
                  onClick={() => void releaseStaleAllocation(allocation)}
                  disabled={allocation.providerStatus !== "missing"}
                >
                  Release missing resource reservation
                </button>
              </div>
            )) : <p role="status">No stale reservations require review.</p>}
          </section>

          <section className="owner-card">
            <span className="support-badge">SUPPORT CONTROL</span>
            <h2>Support availability</h2>
            <label className="owner-check">
              <input type="checkbox" checked={supportEnabled} onChange={(event) => setSupportEnabled(event.target.checked)} />
              Support is available
            </label>
            <div className="owner-form-grid">
              <label>Work starts<input type="time" value={workStart} onChange={(event) => setWorkStart(event.target.value)} /></label>
              <label>Work ends<input type="time" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} /></label>
            </div>
            <button className="primary-owner-button" onClick={saveSupport}>Save support settings</button>
          </section>

          <section className="owner-card">
            <span className="support-badge">ANNOUNCEMENTS</span>
            <h2>{announcementId ? "Edit announcement draft" : "Create an announcement"}</h2>
            <label>Title<input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Message<textarea maxLength={10000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <label>Audience
              <select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}>
                <option value="all_users">All user accounts</option>
                <option value="all_servers">Owners of hosted servers</option>
              </select>
            </label>
            <label>Optional link<input type="url" inputMode="url" value={link} onChange={(event) => setLink(event.target.value)} /></label>
            <div className="owner-actions">
              <button onClick={previewAnnouncement} disabled={!title.trim() || !message.trim()}>Preview audience</button>
              <button onClick={saveAnnouncement} disabled={!title.trim() || !message.trim()}>Save draft</button>
              <button className="primary-owner-button" onClick={sendAnnouncement} disabled={!title.trim() || !message.trim()}>Preview and send</button>
              {announcementId && <button onClick={() => { setAnnouncementId(null); setTitle(""); setMessage(""); setLink(""); }}>Cancel edit</button>}
            </div>
            {recipientCount !== null && <p role="status">Preview: {recipientCount} recipient(s). Delivery is through the website inbox.</p>}
            {recipientCount !== null && <div className="announcement-preview" aria-label="Announcement preview"><strong>{title || "Announcement title"}</strong><p>{message || "Announcement message"}</p>{link && <a href={link} target="_blank" rel="noreferrer">{link}</a>}</div>}
            <h3>Announcement history</h3>
            {announcements.length === 0 ? <p className="empty">No announcements yet.</p> : announcements.map((item) => (
              <article className="owner-list-item" key={item.id}>
                <div><strong>{item.title}</strong><p>{item.status} · {item.audience === "all_servers" ? "server owners" : "all accounts"}{item.creator_name ? ` · ${item.delivery_count} delivered · ${item.failure_count} failed` : " · legacy delivery history unavailable"} · Discord: {item.audience === "all_servers" ? "not requested" : item.discord_delivery_status || "queued"}</p><small>Created by {item.creator_name || "unknown"} · {new Date(item.created_at).toLocaleString()}{item.sent_at ? ` · Sent ${new Date(item.sent_at).toLocaleString()}` : ""}</small></div>
                {item.status === "draft" && <button onClick={() => editAnnouncement(item)}>Edit draft</button>}
              </article>
            ))}
          </section>

          <section className="owner-card">
            <span className="support-badge">STAFF ACCESS</span>
            <h2>Least-privilege permissions</h2>
            <p>Grant only the permissions each staff member needs. Owner access is never granted here.</p>
            <label>Account ID<input inputMode="numeric" value={staffId} onChange={(event) => setStaffId(event.target.value)} placeholder="User account ID" /></label>
            <div className="owner-permissions">
              {(Object.keys(permissionNames) as Permission[]).map((permission) => (
                <label className="owner-check" key={permission}>
                  <input type="checkbox" checked={staffPermissions.includes(permission)} onChange={() => togglePermission(permission)} />
                  {permissionNames[permission]}
                </label>
              ))}
            </div>
            <button className="primary-owner-button" onClick={() => saveStaffPermissions()} disabled={!staffId}>Save permissions</button>
            <h3>Current staff</h3>
            {groupedStaff.length === 0 ? <p className="empty">No other accounts are available.</p> : groupedStaff.map(([id, member]) => (
              <article className="owner-list-item owner-staff-row" key={id}>
                <div><strong>{member.username}</strong><p>{member.email} · account {id}</p><small>{member.permissions.length ? member.permissions.map((permission) => permissionNames[permission]).join(", ") : "No staff permissions"}</small></div>
                <button onClick={() => { setStaffId(String(id)); setStaffPermissions(member.permissions); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
              </article>
            ))}
          </section>

          <section className="owner-card">
            <span className="support-badge">AUTOMATIC SECURITY</span>
            <h2>Security controls</h2>
            <label className="owner-check">
              <input type="checkbox" checked={securityEnabled} onChange={(event) => setSecurityEnabled(event.target.checked)} />
              Enable login/action rate limits and automated overload stops (emergency disable)
            </label>
            <div className="owner-form-grid">
              <label>Failed login threshold<input type="number" min={3} max={50} value={loginThreshold} onChange={(event) => setLoginThreshold(Number(event.target.value))} /></label>
              <label>Lockout minutes<input type="number" min={1} max={1440} value={lockoutMinutes} onChange={(event) => setLockoutMinutes(Number(event.target.value))} /></label>
              <label>Actions per user per minute<input type="number" min={3} max={100} value={spamThreshold} onChange={(event) => setSpamThreshold(Number(event.target.value))} /></label>
              <label>CPU overload threshold (%)<input type="number" min={50} max={100} value={overloadCpuThreshold} onChange={(event) => setOverloadCpuThreshold(Number(event.target.value))} /></label>
              <label>Memory overload threshold (%)<input type="number" min={50} max={100} value={overloadMemoryThreshold} onChange={(event) => setOverloadMemoryThreshold(Number(event.target.value))} /></label>
              <label>Overload strikes before stopping<input type="number" min={2} max={10} value={overloadStrikes} onChange={(event) => setOverloadStrikes(Number(event.target.value))} /></label>
            </div>
            <button className="primary-owner-button" onClick={saveSecurity}>Save security settings</button>
            <h3>Discord safety automation</h3>
            <label className="owner-check">
              <input type="checkbox" checked={discordAbuseEnabled} onChange={(event) => setDiscordAbuseEnabled(event.target.checked)} />
              Enable Discord abuse detection and graduated timeout controls
            </label>
            <div className="owner-form-grid">
              <label>Messages per spam window<input type="number" min={3} max={100} value={discordSpamThreshold} onChange={(event) => setDiscordSpamThreshold(Number(event.target.value))} /></label>
              <label>Spam window seconds<input type="number" min={3} max={120} value={discordSpamWindowSeconds} onChange={(event) => setDiscordSpamWindowSeconds(Number(event.target.value))} /></label>
              <label>Repeated abusive messages before timeout<input type="number" min={2} max={20} value={discordAbuseRepeatThreshold} onChange={(event) => setDiscordAbuseRepeatThreshold(Number(event.target.value))} /></label>
              <label>Timeout minutes (maximum 7 days)<input type="number" min={1} max={10080} value={discordTimeoutMinutes} onChange={(event) => setDiscordTimeoutMinutes(Number(event.target.value))} /></label>
            </div>
            <label>Abusive-language matching terms (one per line; only counts/references are retained)<textarea maxLength={4000} value={discordAbuseTerms} onChange={(event) => setDiscordAbuseTerms(event.target.value)} /></label>
            <p>Single phrase matches only create an incident for review; repeated matches can trigger a temporary timeout. The bot does not automatically ban users.</p>
            <h3>Request-rate exemptions</h3>
            <p>Exemptions bypass account-rate and Discord content automation, but not account restrictions or overload protection.</p>
            <form onSubmit={saveSecurityExemption}>
              <label>Account ID<input required inputMode="numeric" value={exemptionUserId} onChange={(event) => setExemptionUserId(event.target.value)} /></label>
              <label>Reason<textarea required minLength={3} maxLength={1000} value={exemptionReason} onChange={(event) => setExemptionReason(event.target.value)} /></label>
              <button type="submit">Add or update exemption</button>
            </form>
            {exemptions.length === 0 ? <p className="empty">No exemptions configured.</p> : exemptions.map((item) => (
              <article className="owner-list-item" key={item.user_id}>
                <div><strong>{item.username} · account {item.user_id}</strong><p>{item.reason}</p></div>
                <button onClick={() => removeSecurityExemption(item.user_id)}>Remove exemption</button>
              </article>
            ))}
            <h3>Incidents</h3>
            {incidents.length === 0 ? <p className="empty">No security incidents recorded.</p> : incidents.map((incident) => (
              <article className="owner-list-item" key={incident.id}>
                <div><strong>{incident.incident_type} · {incident.status}</strong><p>{incident.action_taken} · {new Date(incident.created_at).toLocaleString()}</p><small>Evidence reference: {incident.evidence_ref}</small></div>
                {incident.status === "open" && <div className="owner-actions"><button onClick={() => reviewIncident(incident.id, "reviewed")}>Review</button><button onClick={() => reviewIncident(incident.id, "dismissed")}>Dismiss</button>{incident.actor_user_id && <button onClick={() => reviewIncident(incident.id, "reviewed", true)}>Review and revoke Discord moderation</button>}</div>}
              </article>
            ))}
          </section>

          <section className="owner-card">
            <span className="support-badge">ACCOUNT RESTRICTIONS</span>
            <h2>Restrict an account</h2>
            <form onSubmit={applyRestriction}>
              <label>Account ID<input required inputMode="numeric" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} /></label>
              <label>Reason<textarea required minLength={3} maxLength={2000} value={restrictionReason} onChange={(event) => setRestrictionReason(event.target.value)} /></label>
              <label>Evidence references (one per line)<textarea maxLength={10000} value={restrictionEvidenceRefs} onChange={(event) => setRestrictionEvidenceRefs(event.target.value)} /></label>
              <label className="owner-check"><input type="checkbox" checked={restrictionAppealEligible} onChange={(event) => setRestrictionAppealEligible(event.target.checked)} />Allow the account to appeal</label>
              <label>Duration
                <select value={restrictionDuration} onChange={(event) => setRestrictionDuration(event.target.value)}>
                  <option value="permanent">Permanent (owner review required)</option>
                  <option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option>
                </select>
              </label>
              <button className="primary-owner-button" type="submit">Apply restriction</button>
            </form>
            <h3>Restriction history</h3>
            {restrictions.length === 0 ? <p className="empty">No restrictions recorded.</p> : restrictions.map((restriction) => (
              <article className="owner-list-item" key={restriction.id}>
                <div><strong>{restriction.username} · {restriction.restriction_type}</strong><p>{restriction.reason}{restriction.expires_at ? ` · Expires ${new Date(restriction.expires_at).toLocaleString()}` : ""}</p><small>{restriction.revoked_at ? `Reversed ${new Date(restriction.revoked_at).toLocaleString()}` : "Active"}</small></div>
                {!restriction.revoked_at && <button onClick={() => reverseRestriction(restriction.id)}>Reverse</button>}
              </article>
            ))}
          </section>

          <section className="owner-card">
            <span className="support-badge">APPEALS</span>
            <h2>Appeal review</h2>
            <p>{appeals.filter((appeal) => appeal.status === "pending").length} appeal(s) awaiting review.</p>
            <Link className="owner-link-button" href="/support/appeals">Open appeal review panel</Link>
          </section>
        </>
      )}
    </main>
  );
}
