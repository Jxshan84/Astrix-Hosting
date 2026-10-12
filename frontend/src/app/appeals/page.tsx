"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Restriction = {
  id: number;
  type: string;
  reason: string;
  expiresAt: string | null;
  evidenceRefs: string[];
};
type Appeal = {
  id: string;
  explanation: string;
  status: string;
  decision_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reason: string;
  expires_at: string | null;
};
type Notification = { id: number; title: string; message: string; created_at: string; read_at: string | null; link: string | null };

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

export default function AppealsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restriction, setRestriction] = useState<Restriction | null>(null);
  const [eligible, setEligible] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  async function loadPage() {
    setError("");
    try {
      const [eligibility, appealData, inbox] = await Promise.all([
        api<{ eligible: boolean; restriction: Restriction | null }>("/api/appeals/eligibility"),
        api<{ appeals: Appeal[] }>("/api/appeals/mine"),
        api<{ notifications: Notification[] }>("/api/announcements/inbox"),
      ]);
      setRestriction(eligibility.restriction);
      setEligible(eligibility.eligible);
      setAppeals(appealData.appeals);
      setNotifications(inbox.notifications);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load appeals.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadPage);
  }, []);

  async function submitAppeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length > 3 || files.some((file) => file.size > 2 * 1024 * 1024)) {
      setError("Choose no more than three files, each up to 2 MB.");
      return;
    }
    setError("");
    try {
      const result = await api<{ appealId: string }>("/api/appeals", {
        method: "POST",
        body: JSON.stringify({ explanation }),
      });
      for (const file of files) {
        const response = await fetch(`/api/appeals/${result.appealId}/attachments`, {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120),
          },
          body: await file.arrayBuffer(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(`Appeal ${result.appealId} was created, but an attachment failed: ${data.error || "upload failed"}`);
        }
      }
      setNotice(`Appeal ${result.appealId} submitted.`);
      setExplanation("");
      setFiles([]);
      await loadPage();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit appeal.");
    }
  }

  async function markRead(id: number) {
    try {
      await api(`/api/announcements/inbox/${id}/read`, { method: "PATCH" });
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to update notification.");
    }
  }

  return (
    <main className="appeals-page">
      <header className="owner-header">
        <span className="support-badge">ACCOUNT REVIEW</span>
        <h1>Appeals</h1>
        <p>Submit an appeal and check its status using your signed-in account.</p>
      </header>
      {loading && <p role="status">Loading account review...</p>}
      {error && <p className="owner-notice" role="alert">{error} <Link href="/login">Sign in</Link></p>}
      {notice && <p className="owner-notice" role="status">{notice}</p>}

      {!loading && !error && restriction && (
        <section className="owner-card">
          <h2>Current {restriction.type} restriction</h2>
          <p>{restriction.reason}</p>
          {restriction.expiresAt && <p>Expires: {new Date(restriction.expiresAt).toLocaleString()}</p>}
          {restriction.evidenceRefs.length > 0 && (
            <details><summary>Evidence references</summary><ul>{restriction.evidenceRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul></details>
          )}
          {eligible ? (
            <form onSubmit={submitAppeal}>
              <label htmlFor="appeal-explanation">Explain why this restriction should be reviewed</label>
              <textarea id="appeal-explanation" required minLength={20} maxLength={10000} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
              <label htmlFor="appeal-files">Optional proof (up to 3 PNG, JPEG, or PDF files; 2 MB each)</label>
              <input id="appeal-files" type="file" accept="image/png,image/jpeg,application/pdf" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} />
              {files.length > 0 && <p>{files.length} file(s) selected.</p>}
              <button className="primary-owner-button" type="submit">Submit appeal</button>
            </form>
          ) : <p>This restriction is not eligible for appeal.</p>}
        </section>
      )}

      {!loading && !error && !restriction && <section className="owner-card"><p>No active appeal-eligible restriction was found on this account.</p></section>}

      <section className="owner-card">
        <h2>Your appeal history</h2>
        {appeals.length === 0 ? <p className="empty">No appeals have been submitted.</p> : appeals.map((appeal) => (
          <article className="owner-list-item" key={appeal.id}>
            <div><strong>{appeal.id} · {appeal.status}</strong><p>{appeal.reason}</p><small>Submitted {new Date(appeal.submitted_at).toLocaleString()}</small>
              {appeal.decision_notes && <p>Review note: {appeal.decision_notes}</p>}
            </div>
          </article>
        ))}
      </section>

      <section className="owner-card">
        <h2>Notifications</h2>
        {notifications.length === 0 ? <p className="empty">No notifications.</p> : notifications.map((item) => (
          <article className="owner-list-item" key={item.id}>
            <div><strong>{item.title}</strong><p>{item.message}</p>{item.link && <a href={item.link} target="_blank" rel="noreferrer">{item.link}</a>}<small>{new Date(item.created_at).toLocaleString()}</small></div>
            {!item.read_at && <button onClick={() => markRead(item.id)}>Mark read</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
