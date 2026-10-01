"use client";

import { FormEvent, useState } from "react";

export default function SupportPage() {
  const [plan, setPlan] = useState("free");
  const [result, setResult] = useState("");

  async function createTicket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);

    const response = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: form.get("userId"),
        userName: form.get("userName"),
        plan,
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
      e.currentTarget.reset();
    } else {
      setResult(data.error || "Could not create ticket.");
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

        <form onSubmit={createTicket}>
          <input name="userId" placeholder="Your user ID" required />
          <input name="userName" placeholder="Your name" required />

          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium — Priority 24/7</option>
          </select>

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

          {result && <div className="ticket-result">{result}</div>}
        </form>
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
