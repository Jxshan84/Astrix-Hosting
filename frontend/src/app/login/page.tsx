"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get("error");
    if (!oauthError) return;

    const messages: Record<string, string> = {
      google_cancelled: "Google sign-in was cancelled.",
      google_not_configured: "Google sign-in is temporarily unavailable. Try Discord or email sign-in.",
      google_token_exchange: "Google could not complete sign-in. Please try again.",
      google_userinfo: "Google could not verify your account. Please try again.",
      google_account_invalid: "Google did not return a verified email address for this account.",
      google_login_failed: "Google sign-in could not be completed. Please try again or use Discord or email.",
      invalid_oauth_state: "Your sign-in session expired. Please start Google sign-in again.",
      missing_google_code: "Google did not complete sign-in. Please try again.",
    };
    const timeout = window.setTimeout(() => {
      setError(messages[oauthError] ?? "Sign-in could not be completed. Please try again.");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed.");
        return;
      }

      if (new URLSearchParams(window.location.search).get("welcome") === "claim") {
        await fetch("/api/welcome/claim", { method: "POST", credentials: "include" }).catch(() => undefined);
      }
      router.push("/dashboard");
    } catch {
      setError("Unable to connect to Astrix Hosting.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-scenery" aria-hidden="true">
        <div className="auth-scene auth-scene-1" />
        <div className="auth-scene auth-scene-2" />
        <div className="auth-scene auth-scene-3" />
        <div className="auth-scene auth-scene-4" />
      </div>
      <div className="auth-card">
        <span className="support-badge">ASTRIX HOSTING</span>
        <h1>Welcome back</h1>
        <p>Sign in to manage your hosting servers.</p>

        <div className="oauth-buttons">
          <a className="oauth-button" href="/api/auth/google">
            Continue with Google
          </a>
          <a className="oauth-button" href="/api/auth/discord">
            Continue with Discord
          </a>
        </div>

        <div className="auth-divider"><span>or continue with email</span></div>

        <form onSubmit={login}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account?{" "}
          <Link href="/register">Create one</Link>
        </p>
      </div>
    </main>
  );
}
