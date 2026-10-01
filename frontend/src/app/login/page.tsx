"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <button type="button" className="oauth-button" onClick={() => window.location.href="/api/auth/google"}>
            Continue with Google
          </button>
          <button type="button" className="oauth-button" onClick={() => window.location.href="/api/auth/discord"}>
            Continue with Discord
          </button>
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
          Don't have an account?{" "}
          <Link href="/register">Create one</Link>
        </p>
      </div>
    </main>
  );
}
