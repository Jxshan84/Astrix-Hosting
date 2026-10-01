"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  async function register(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!acceptedTerms) {
      setError("You must accept the Privacy Policy and Terms of Service.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          discordId: discordId || undefined
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed.");
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
      <div className="auth-card">
        <span className="support-badge">ASTRIX HOSTING</span>
        <h1>Create account</h1>
        <p>Start managing your Astrix Hosting servers.</p>

        <div className="oauth-buttons">
          <button type="button" className="oauth-button" onClick={() => window.location.href="/api/auth/google"}>
            Continue with Google
          </button>
          <button type="button" className="oauth-button" onClick={() => window.location.href="/api/auth/discord"}>
            Continue with Discord
          </button>
        </div>

        <div className="auth-divider"><span>or create with email</span></div>

        <form onSubmit={register}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Discord ID (optional)"
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />

          <label style={{
          display:"flex",
          alignItems:"flex-start",
          gap:"10px",
          margin:"18px 0",
          color:"#aebbb2",
          fontSize:"13px",
          lineHeight:1.5,
          cursor:"pointer"
        }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            style={{marginTop:"3px"}}
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" style={{color:"#9be7ad"}}>Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" style={{color:"#9be7ad"}}>Privacy Policy</Link>.
          </span>
        </label>

        {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{" "}
          <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
