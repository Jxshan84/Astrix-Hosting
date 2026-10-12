"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Appeal = {
  id: string;
  user_id: number;
  username: string;
  status: string;
  explanation: string;
  reason: string;
  evidenceRefs: string[];
  submitted_at: string;
};
type AppealDetail = Appeal & {
  attachments: Array<{ id: number; file_name: string; media_type: string; size: number }>;
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

export default function AppealReviewPage() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [selected, setSelected] = useState<AppealDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAppeals() {
    setError("");
    try {
      const data = await api<{ appeals: Appeal[] }>("/api/appeals");
      setAppeals(data.appeals);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load appeals.");
    } finally {
      setLoading(false);
    }
  }

  async function openAppeal(id: string) {
    setError("");
    try {
      const data = await api<{ appeal: AppealDetail }>(`/api/appeals/${id}`);
      setSelected(data.appeal);
      setNotes("");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open appeal.");
    }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!selected) return;
    setError("");
    try {
      await api(`/api/appeals/${selected.id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ decision, notes }),
      });
      setSelected(null);
      setNotes("");
      await loadAppeals();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to record appeal decision.");
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadAppeals);
  }, []);

  return (
    <main className="appeals-page">
      <header className="owner-header">
        <span className="support-badge">AUTHORIZED REVIEWERS</span>
        <h1>Appeal review</h1>
        <p>Only accounts granted appeal-review permission can access this panel.</p>
        <Link href="/support/dashboard">Back to support dashboard</Link>
      </header>
      {loading && <p role="status">Loading appeals...</p>}
      {error && <p className="owner-notice" role="alert">{error}</p>}
      {!loading && !error && appeals.length === 0 && <section className="owner-card"><p className="empty">No appeals are available.</p></section>}
      <section className="owner-card">
        <h2>Queue</h2>
        {appeals.map((appeal) => (
          <article className="owner-list-item" key={appeal.id}>
            <div><strong>{appeal.id} · {appeal.status}</strong><p>{appeal.username} · {appeal.reason}</p><small>{new Date(appeal.submitted_at).toLocaleString()}</small></div>
            <button onClick={() => openAppeal(appeal.id)}>Review</button>
          </article>
        ))}
      </section>
      {selected && (
        <section className="owner-card">
          <h2>{selected.id} · {selected.username}</h2>
          <p>Submitted {new Date(selected.submitted_at).toLocaleString()}</p>
          <h3>Restriction reason</h3><p>{selected.reason}</p>
          <h3>Appeal explanation</h3><p className="appeal-explanation">{selected.explanation}</p>
          <h3>Evidence references</h3>
          {selected.evidenceRefs.length === 0 ? <p>None attached to the restriction.</p> : <ul>{selected.evidenceRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul>}
          <h3>Proof attachments</h3>
          {selected.attachments.length === 0 ? <p>No attachments.</p> : selected.attachments.map((file) => (
            <p key={file.id}><a href={`/api/appeals/${selected.id}/attachments/${file.id}`}>{file.file_name} ({Math.ceil(file.size / 1024)} KB)</a></p>
          ))}
          {selected.status === "pending" && <>
            <label htmlFor="decision-notes">Decision notes (required)</label>
            <textarea id="decision-notes" minLength={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
            <div className="owner-actions">
              <button className="primary-owner-button" disabled={notes.trim().length < 3} onClick={() => decide("approved")}>Approve and lift restriction</button>
              <button disabled={notes.trim().length < 3} onClick={() => decide("rejected")}>Reject appeal</button>
            </div>
          </>}
        </section>
      )}
    </main>
  );
}
