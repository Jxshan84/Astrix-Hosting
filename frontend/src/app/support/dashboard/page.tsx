"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: number;
  ticket_code: string;
  user_name: string;
  plan: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
};

export default function SupportDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadTickets() {
    const response = await fetch("/api/support/tickets", {
      cache: "no-store"
    });

    const data = await response.json();
    setTickets(data.tickets || []);
    setLoading(false);
  }

  async function updateStatus(code: string, status: string) {
    await fetch(`/api/support/tickets/${code}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    loadTickets();
  }

  useEffect(() => {
    loadTickets();
  }, []);

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <span className="support-badge">SUPPORT TEAM</span>
          <h1>Astrix Support Dashboard</h1>
          <p>Manage customer tickets and priority requests.</p>
        </div>

        <div className="online-status">
          <span>●</span> Support Online
        </div>
      </header>

      <section className="dashboard-owner">
        <strong>Owner: Jashan Deep Singh</strong>
        <span>Discord: jxshan84</span>
        <span>sasukeuchicha46535@gmail.com</span>
      </section>

      <section className="ticket-list">
        <div className="list-title">
          <h2>Tickets</h2>
          <button onClick={loadTickets}>Refresh</button>
        </div>

        {loading && <p>Loading tickets...</p>}

        {!loading && tickets.length === 0 && (
          <p className="empty">No support tickets yet.</p>
        )}

        {tickets.map((ticket) => (
          <article
            className={`ticket-row ${
              ticket.priority === "priority" ? "priority-ticket" : ""
            }`}
            key={ticket.id}
          >
            <div>
              <strong>{ticket.ticket_code}</strong>
              <h3>{ticket.subject}</h3>
              <p>
                {ticket.user_name} · {ticket.category} · {ticket.plan}
              </p>
            </div>

            <div className="ticket-meta">
              {ticket.priority === "priority" && (
                <span className="priority">🔥 PRIORITY</span>
              )}

              <select
                value={ticket.status}
                onChange={(e) =>
                  updateStatus(ticket.ticket_code, e.target.value)
                }
              >
                <option value="pending">Pending</option>
                <option value="reviewing">Reviewing</option>
                <option value="working">Working</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
