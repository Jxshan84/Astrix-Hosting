"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

export default function SupportPage() {
  const [user, setUser] = useState<{ username: string; plan: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [result, setResult] = useState("");

  useEffect(() => {
    void fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign in to open a support ticket.");
        const data = await response.json();
        setUser(data.user);
      })
      .catch((error: unknown) => {
        setResult(error instanceof Error ? error.message : "Unable to check your account.");
      })
      .finally(() => setAuthLoading(false));
  }, []);

  async function createTicket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;

    const formElement = e.currentTarget;
    const form = new FormData(formElement);

    try {
      const response = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: form.get("subject"),
        category: form.get("category"),
        message: form.get("message")
      })
      });

      const data = await response.json();

      if (response.ok) {
        setResult(
          `Ticket ${data.ticket.ticketCode} created — ${data.ticket.priority} priority`
        );
        formElement.reset();
      } else {
        setResult(data.error || "Could not create ticket.");
      }
    } catch {
      setResult("Unable to connect to support. Please try again.");
    }
  }

  return (
    <main className="support-page">
      <section className="support-hero">
        <span className="support-badge">● ONLINE SUPPORT</span>
        <h1>Astrix Hosting Support</h1>
        <p>
          Get help from the Astrix Hosting support team.
          Premium members receive priority support and can open tickets 24/7.
        </p>

        <div className="support-owner">
          <strong>Owner</strong>
          <span>Jashan Deep Singh</span>
          <span>Discord: jxshan84</span>
          <span>Email: sasukeuchicha46535@gmail.com</span>
          <a href="https://discord.gg/3B5PF9SC8j">
            Join Discord Support
          </a>
        </div>
      </section>

      <section className="ticket-card">
        <div>
          <span className="support-badge">NEW TICKET</span>
          <h2>Open a Support Ticket</h2>
          <p>Premium tickets automatically receive priority handling.</p>
        </div>

        {authLoading ? (
          <p role="status">Checking your account...</p>
        ) : user ? (
          <>
          <p>Submitting as {user.username} · {user.plan} plan</p>
          <form onSubmit={createTicket}>
          <input name="subject" placeholder="Ticket subject" required />

          <select name="category" defaultValue="general">
            <option value="general">General</option>
            <option value="hosting">Hosting</option>
            <option value="billing">Billing</option>
            <option value="technical">Technical</option>
            <option value="account">Account</option>
          </select>

          <textarea
            name="message"
            placeholder="Describe your issue..."
            required
          />

          <button type="submit">Create Ticket</button>

          </form>
          </>
        ) : (
          <p role="alert">
            {result} <Link href="/login">Sign in</Link> to open a ticket.
          </p>
        )}
        {result && user && <div className="ticket-result" role="status">{result}</div>}
      </section>

      <section className="support-info">
        <div>
          <strong>Free / Standard</strong>
          <span>Support during work hours</span>
        </div>

        <div className="premium-box">
          <strong>Premium</strong>
          <span>Priority support • 24/7 tickets</span>
        </div>

        <div>
          <strong>Ticket workflow</strong>
          <span>Pending → Reviewing → Working → Resolved</span>
        </div>
      </section>
    </main>
  );
}
