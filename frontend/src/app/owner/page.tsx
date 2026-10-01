"use client";

import { useEffect, useState } from "react";

const OWNER_KEY = "ASTRIX_OWNER_CHANGE_THIS_KEY";

export default function OwnerDashboard() {
  const [supportEnabled, setSupportEnabled] = useState(true);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("21:00");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSettings() {
    const res = await fetch("/api/support/admin/settings");
    const data = await res.json();

    if (data.settings) {
      setSupportEnabled(Boolean(data.settings.support_enabled));
      setWorkStart(data.settings.work_start);
      setWorkEnd(data.settings.work_end);
    }
  }

  async function saveSettings() {
    const res = await fetch("/api/support/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-owner-key": OWNER_KEY
      },
      body: JSON.stringify({
        supportEnabled,
        workStart,
        workEnd,
        timezone: "Asia/Kolkata"
      })
    });

    const data = await res.json();
    setNotice(data.message || data.error || "Settings updated.");
  }

  async function createAnnouncement() {
    const res = await fetch("/api/support/admin/announcements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-owner-key": OWNER_KEY
      },
      body: JSON.stringify({ title, message })
    });

    const data = await res.json();

    if (res.ok) {
      setTitle("");
      setMessage("");
      setNotice("Announcement published.");
    } else {
      setNotice(data.error || "Could not publish announcement.");
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <main className="owner-page">
      <section className="owner-header">
        <span className="support-badge">OWNER CONTROL CENTER</span>
        <h1>Astrix Hosting</h1>
        <p>Private control panel for Astrix Hosting support.</p>
      </section>

      <section className="owner-card">
        <span className="support-badge">OWNER</span>
        <h2>Jashan Deep Singh</h2>
        <p>Discord: jxshan84</p>
        <p>Email: sasukeuchicha46535@gmail.com</p>
      </section>

      <section className="owner-card">
        <span className="support-badge">SUPPORT CONTROL</span>
        <h2>Support availability</h2>

        <button
          className={supportEnabled ? "support-toggle on" : "support-toggle off"}
          onClick={() => setSupportEnabled(!supportEnabled)}
        >
          {supportEnabled ? "🟢 SUPPORT ON" : "🔴 SUPPORT OFF"}
        </button>

        <div className="time-grid">
          <label>
            Work starts
            <input
              type="time"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
            />
          </label>

          <label>
            Work ends
            <input
              type="time"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
            />
          </label>
        </div>

        <p className="owner-note">
          Premium members can still open priority tickets 24/7.
        </p>

        <button className="primary-owner-button" onClick={saveSettings}>
          Save Support Settings
        </button>
      </section>

      <section className="owner-card">
        <span className="support-badge">ANNOUNCEMENT</span>
        <h2>Create Announcement</h2>

        <input
          placeholder="Announcement title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <textarea
          placeholder="Write your announcement..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <button
          className="primary-owner-button"
          onClick={createAnnouncement}
          disabled={!title || !message}
        >
          📢 Publish Announcement
        </button>
      </section>

      {notice && <div className="owner-notice">{notice}</div>}
    </main>
  );
}
