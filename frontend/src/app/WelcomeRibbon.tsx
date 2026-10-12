"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRef } from "react";

type Campaign = {
  enabled: boolean;
  active: boolean;
  claimsOpen: boolean;
  expiresAt: string | null;
  redemptionLimit: number | null;
  checkoutConfigured: boolean;
  rewards: Reward[];
};

type Reward = {
  id: string;
  type: "badge" | "achievement";
  name: string;
};

type RewardClaim = {
  claimedAt: string;
  rewards: Reward[];
};

const dismissedKey = "astrix-welcome-ribbon-dismissed";

export default function WelcomeRibbon() {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [visible, setVisible] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [claim, setClaim] = useState<RewardClaim | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const swipeStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/welcome/campaign", { cache: "no-store" }),
      fetch("/api/welcome/claim", { cache: "no-store" }),
    ])
      .then(async ([campaignResponse, claimResponse]) => {
        if (!campaignResponse.ok) return;
        const campaignData = await campaignResponse.json() as { campaign: Campaign };
        const claimData = claimResponse.ok
          ? await claimResponse.json() as {
              claim: RewardClaim | null;
              eligible: boolean;
            }
          : null;
        if (!active) return;
        setCampaign(campaignData.campaign);
        setAuthenticated(Boolean(claimData));
        setEligible(claimData?.eligible === true);
        setClaim(claimData?.claim ?? null);
        if (claimData?.claim) {
          try {
            window.localStorage.setItem(dismissedKey, "1");
          } catch {
            // The server claim remains authoritative when browser storage is unavailable.
          }
          return;
        }
        let dismissed = false;
        try {
          dismissed = window.localStorage.getItem(dismissedKey) === "1";
        } catch {
          dismissed = false;
        }
        setVisible(campaignData.campaign.claimsOpen && !dismissed);
      })
      .catch(() => {
        if (active) setCampaign(null);
      });
    return () => {
      active = false;
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(dismissedKey, "1");
    } catch {
      // Dismissal is a convenience, not proof of reward eligibility.
    }
    setVisible(false);
  }

  function reveal() {
    setRevealed(true);
    try {
      window.localStorage.setItem(dismissedKey, "1");
    } catch {
      // The website remains usable without browser storage.
    }
  }

  function startSlice(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishSlice(event: React.PointerEvent<HTMLButtonElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (deltaX >= 56 && deltaX > Math.abs(deltaY)) reveal();
  }

  async function claimReward() {
    setClaiming(true);
    setError("");
    try {
      const response = await fetch("/api/welcome/claim", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to claim this reward.");
      setClaim(data.claim as RewardClaim);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Unable to claim this reward.");
    } finally {
      setClaiming(false);
    }
  }

  if (!visible || !campaign?.claimsOpen) return null;

  return (
    <section className={`welcome-ribbon ${revealed ? "is-revealed" : ""}`} aria-labelledby="welcome-title">
      <button className="welcome-dismiss" type="button" onClick={dismiss} aria-label="Dismiss welcome reward">
        <span aria-hidden="true">×</span>
      </button>
      <div className="welcome-copy">
        <span className="welcome-eyebrow">A SMALL GIFT FROM ASTRIX</span>
        <h1 id="welcome-title">Welcome to Astrix Hosting.</h1>
        <p>Every new project deserves a golden start. There is a welcome reward tucked inside.</p>
        {!revealed ? (
          <>
            <button
              className="welcome-cut-button welcome-slice-button"
              type="button"
              onClick={reveal}
              onPointerDown={startSlice}
              onPointerUp={finishSlice}
              onPointerCancel={() => { swipeStart.current = null; }}
              aria-describedby="welcome-slice-hint"
            >
              <span aria-hidden="true">✂</span> Cut the Ribbon
            </button>
            <p className="welcome-slice-hint" id="welcome-slice-hint">
              Tap to cut, or swipe right across the button.
            </p>
          </>
        ) : (
          <div className="welcome-reward" aria-live="polite">
            <span className="welcome-reward-label">YOUR WELCOME REWARD</span>
            <strong>Your Astrix welcome collection</strong>
            <ul className="welcome-reward-list">
              {campaign.rewards.map((reward) => (
                <li key={reward.id}>
                  <span aria-hidden="true">{reward.type === "badge" ? "✦" : "◆"}</span>
                  <span>{reward.name}<small>{reward.type}</small></span>
                </li>
              ))}
            </ul>
            {claim ? (
              <div className="welcome-code">
                <span>Your welcome rewards are attached to this account.</span>
              </div>
            ) : authenticated ? (
              eligible ? (
                <button className="welcome-cut-button" type="button" onClick={() => void claimReward()} disabled={claiming}>
                  {claiming ? "Claiming..." : "Claim my rewards"}
                </button>
              ) : <p className="welcome-terms">This account is not eligible for this promotion.</p>
            ) : (
              <div className="welcome-actions">
                <Link href="/register?welcome=claim" className="welcome-cut-button">Create account to claim</Link>
                <Link href="/login?welcome=claim" className="welcome-login-link">Already have an account? Sign in</Link>
              </div>
            )}
            {error && <p className="welcome-error" role="alert">{error}</p>}
            <p className="welcome-terms">
              For new, unrestricted accounts. One claim per account.
              {campaign.redemptionLimit ? ` Limited to ${campaign.redemptionLimit} account(s).` : " No account claim limit is set."}
              {campaign.expiresAt ? ` Promotion ends ${new Date(campaign.expiresAt).toLocaleString()}.` : " No expiry is currently set."}
            </p>
            {!campaign.checkoutConfigured && (
              <p className="welcome-checkout-note">Discount coupons are not offered because checkout cannot currently redeem them.</p>
            )}
          </div>
        )}
      </div>
      <div className={`welcome-gift ${revealed ? "gift-open" : ""}`} aria-hidden="true">
        <span className="gift-spark gift-spark-one" />
        <span className="gift-spark gift-spark-two" />
        <span className="gift-box">
          <span className="gift-box-front" />
          <span className="gift-lid" />
          <span className="gift-ribbon-vertical" />
          <span className="gift-ribbon-horizontal" />
          <span className="gift-bow gift-bow-left" />
          <span className="gift-bow gift-bow-right" />
        </span>
        {revealed && <span className="welcome-slice-line" />}
        {revealed && <span className="welcome-confetti">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</span>}
      </div>
    </section>
  );
}