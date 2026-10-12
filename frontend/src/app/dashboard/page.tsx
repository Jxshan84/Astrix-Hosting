"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type RuntimeStats = {
  cpu: string | null;
  memory: string | null;
  memoryPercent: string | null;
} | null;

type Server = {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  status: string;
  stats: RuntimeStats;
};
type Catalog = {
  provider: { id: string; connected: boolean; error: string | null; allocation: string };
  runtimes: Array<{ id: string; name: string }>;
  planName: string;
  plan: { maxServers: number; memoryMb: number; cpuCores: number };
  slots: { used: number; limit: number };
};
type WelcomeClaim = {
  claimedAt: string;
  rewards: Array<{ id: string; type: "badge" | "achievement"; name: string }>;
};

type ServerAction = "start" | "stop" | "restart";

function statusLabel(status: string) {
  switch (status) {
    case "running":
      return "Container running";
    case "created":
    case "exited":
    case "stopped":
      return "Offline";
    case "starting":
    case "restarting":
      return "Starting";
    case "stopping":
      return "Stopping";
    case "error":
    case "dead":
      return "Error";
    case "missing":
      return "Provider resource missing";
    default:
      return status || "Unknown";
  }
}

function memoryUsed(memory: string | null | undefined) {
  return memory?.split("/")[0]?.trim() || "—";
}

export default function Dashboard() {
  const [name, setName] = useState("");
  const [type, setType] = useState("node");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [servers, setServers] = useState<Server[]>([]);
  const [serversLoading, setServersLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [welcomeClaim, setWelcomeClaim] = useState<WelcomeClaim | null>(null);
  const [welcomeActive, setWelcomeActive] = useState(false);
  const [welcomeEligible, setWelcomeEligible] = useState(false);
  const [welcomeClaiming, setWelcomeClaiming] = useState(false);
  const [welcomeError, setWelcomeError] = useState("");

  const refreshCatalog = useCallback(async () => {
    const response = await fetch("/api/servers/catalog", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to check server provider.");
    setCatalog(data as Catalog);
  }, []);

  const loadServers = useCallback(async (showLoading = false) => {
    if (showLoading) setServersLoading(true);

    try {
      const response = await fetch("/api/servers", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load servers.");
      }

      setServers(data.servers);
      setLoadError("");
    } catch (error) {
      console.error("Unable to load server list:", error);
      setLoadError(
        error instanceof Error ? error.message : "Failed to load servers."
      );
    } finally {
      setServersLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadServers());
    const timer = window.setInterval(() => void loadServers(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadServers]);

  useEffect(() => {
    let active = true;
    void fetch("/api/servers/catalog", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to check server provider.");
        return data as Catalog;
      })
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch((error: unknown) => {
        console.error("Unable to load provider catalog:", error);
        if (active) {
          setCatalog({
            provider: { id: "docker", connected: false, error: "Server provider setup required.", allocation: "manual" },
            runtimes: [],
            planName: "",
            plan: { maxServers: 0, memoryMb: 0, cpuCores: 0 },
            slots: { used: 0, limit: 0 },
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/welcome/campaign", { cache: "no-store" }),
      fetch("/api/welcome/claim", { cache: "no-store" }),
    ])
      .then(async ([campaignResponse, claimResponse]) => {
        if (!campaignResponse.ok || !claimResponse.ok) return;
        const campaignData = await campaignResponse.json();
        const claimData = await claimResponse.json();
        if (!active) return;
        setWelcomeActive(campaignData.campaign?.claimsOpen === true);
        setWelcomeEligible(claimData.eligible === true);
        setWelcomeClaim(claimData.claim ?? null);
      })
      .catch((error: unknown) => {
        console.error("Unable to load the welcome reward:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  async function claimWelcomeReward() {
    setWelcomeClaiming(true);
    setWelcomeError("");
    try {
      const response = await fetch("/api/welcome/claim", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to claim the welcome reward.");
      setWelcomeClaim(data.claim as WelcomeClaim);
    } catch (error) {
      setWelcomeError(error instanceof Error ? error.message : "Unable to claim the welcome reward.");
    } finally {
      setWelcomeClaiming(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = await response.json();
        return data.user?.isOwner === true;
      })
      .then((owner) => {
        if (active) setIsOwner(owner);
      })
      .catch((error: unknown) => {
        console.error("Unable to load dashboard permissions:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("Enter a server name.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: selectedType }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create server.");
      }

      setName("");
      setMessage("Server created successfully.");
      await loadServers();
      await refreshCatalog();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to create server."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAction(server: Server, action: ServerAction) {
    setBusyServer(server.id);
    setMessage("");
    try {
      const response = await fetch(`/api/servers/${server.id}/${action}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to ${action} server.`);
      await loadServers();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `Failed to ${action} server.`
      );
      await loadServers();
    } finally {
      setBusyServer(null);
    }
  }

  async function deleteServer(server: Server) {
    if (!window.confirm(`Delete "${server.name}"? This will permanently remove the server.`)) {
      return;
    }

    setBusyServer(server.id);
    setMessage("");
    try {
      const response = await fetch(`/api/servers/${server.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete server.");
      setServers((current) => current.filter((item) => item.id !== server.id));
      setMessage("Server deleted successfully.");
      await refreshCatalog();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to delete server."
      );
    } finally {
      setBusyServer(null);
    }
  }

  const runningServers = servers.filter((server) => server.status === "running").length;
  const selectedType = catalog?.runtimes.some((runtime) => runtime.id === type)
    ? type
    : catalog?.runtimes[0]?.id || type;

  return (
    <main className="servers-page">
      <div className="servers-shell">
        <header className="servers-header">
          <div>
            <span className="servers-eyebrow">ASTRIX HOSTING</span>
            <h1>Server dashboard</h1>
            <p>Monitor and manage your game servers from one place.</p>
          </div>
          <nav className="servers-nav" aria-label="Dashboard navigation">
            <Link href="/support">Support</Link>
            <Link href="/appeals">Appeals &amp; notifications</Link>
            {isOwner && <Link href="/owner">Owner controls</Link>}
          </nav>
        </header>

        {(welcomeClaim || (welcomeActive && welcomeEligible)) && (
          <aside className="dashboard-welcome" aria-label="Astrix welcome reward">
            <div>
              {welcomeClaim ? (
                <>
                  <strong>✦ ASTRIX WELCOME BADGE</strong>
                  <p>Your Astrix Welcome Badge and Pioneer achievement are attached to this account.</p>
                </>
              ) : (
                <>
                  <strong>YOUR ASTRIX WELCOME REWARD</strong>
                  <p>Claim your Astrix Welcome Badge and Pioneer achievement.</p>
                  {welcomeError && <p role="alert">{welcomeError}</p>}
                </>
              )}
            </div>
            {!welcomeClaim && <button type="button" onClick={() => void claimWelcomeReward()} disabled={welcomeClaiming}>
              {welcomeClaiming ? "Claiming..." : "Claim reward"}
            </button>}
          </aside>
        )}

        <section className="server-metrics" aria-label="Server overview">
          <article className="server-metric">
            <span>Total servers</span>
            <strong>{servers.length}</strong>
          </article>
          <article className="server-metric">
            <span>Running containers</span>
            <strong>{runningServers}</strong>
          </article>
          <article className="server-metric">
            <span>Offline</span>
            <strong>{servers.filter((server) => ["created", "exited", "stopped", "missing", "dead"].includes(server.status)).length}</strong>
          </article>
          <article className="server-metric">
            <span>CPU · live</span>
            <strong>
              {servers.some((server) => server.status === "running")
                ? `${servers
                    .filter((server) => server.status === "running")
                    .reduce(
                      (total, server) =>
                        total + (Number.parseFloat(server.stats?.cpu || "") || 0),
                      0
                    )
                    .toFixed(1)}%`
                : "—"}
            </strong>
          </article>
        </section>

        <section className="servers-section" aria-labelledby="servers-heading">
          <div className="servers-section-heading">
            <div>
              <span className="servers-eyebrow">YOUR INSTANCES</span>
              <h2 id="servers-heading">My servers</h2>
            </div>
            <button
              className="button button-secondary"
              onClick={() => void loadServers(true)}
              disabled={serversLoading}
            >
              {serversLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {loadError && (
            <div className="server-notice server-notice-error" role="alert">
              {loadError}
              {loadError.includes("Authentication") && (
                <> <Link href="/login">Sign in</Link></>
              )}
              {loadError.includes("restricted") && (
                <> <Link href="/appeals">Review your restriction or submit an appeal</Link></>
              )}
            </div>
          )}

          {catalog && !catalog.provider.connected && (
            <div className="server-notice server-notice-error" role="status">
              Provider setup required: the backend cannot currently reach its Docker Engine. Status and server actions are unavailable until the persistent backend host is configured.
            </div>
          )}

          {catalog && (
            <p className="server-plan-summary" role="status">
              Plan {catalog.planName} · {catalog.slots.used}/{catalog.slots.limit} slots used · {catalog.plan.memoryMb || "—"} MiB RAM and {catalog.plan.cpuCores || "—"} CPU cores per new server
            </p>
          )}

          {message && (
            <div className="server-notice" role="status" aria-live="polite">
              {message}
            </div>
          )}

          {serversLoading && servers.length === 0 ? (
            <div className="servers-empty" role="status">
              <span className="loading-indicator" aria-hidden="true" />
              <strong>Loading your servers</strong>
              <p>Getting the latest server and resource status.</p>
            </div>
          ) : servers.length === 0 ? (
            <div className="servers-empty">
              <span className="empty-server-icon" aria-hidden="true">▧</span>
              <strong>{loadError ? "Server list unavailable" : "No servers yet"}</strong>
              <p>{loadError || "Create a server below to get started."}</p>
              {loadError ? (
                <button className="button button-secondary" onClick={() => void loadServers(true)}>
                  Try again
                </button>
              ) : (
                <a className="button button-primary" href="#create-server">Create a server</a>
              )}
            </div>
          ) : (
            <div className="servers-grid">
              {servers.map((server) => {
                const running = server.status === "running";
                const busy = busyServer === server.id;

                return (
                  <article className={`server-card server-card-runtime-${server.type}`} key={server.id}>
                    <div className="server-card-heading">
                      <div className={`server-type-icon runtime-${server.type}`} aria-hidden="true">
                        {server.type === "node" ? "JS" : server.type === "python" ? "Py" : server.type.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="server-card-title">
                        <h3>{server.name}</h3>
                        <span>{server.type} runtime image · Docker</span>
                      </div>
                      <span
                        className={`server-status status-${server.status}`}
                        aria-label={`Server status: ${statusLabel(server.status)}`}
                      >
                        <span aria-hidden="true" />
                        {statusLabel(server.status)}
                      </span>
                    </div>

                    <div className="server-card-resources">
                      <div>
                        <span>Provider CPU</span>
                        <strong>{server.stats?.cpu || "—"}</strong>
                      </div>
                      <div>
                        <span>Provider memory</span>
                        <strong>{memoryUsed(server.stats?.memory)}</strong>
                      </div>
                      <div>
                        <span>Plan</span>
                        <strong>{catalog?.planName || "—"}</strong>
                      </div>
                    </div>

                    <div className="server-card-actions">
                      <button
                        className="button button-primary"
                        onClick={() => void runAction(server, "start")}
                        disabled={busy || running}
                      >
                        Start
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => void runAction(server, "stop")}
                        disabled={busy || !running}
                      >
                        Stop
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => void runAction(server, "restart")}
                        disabled={busy || !running}
                      >
                        Restart
                      </button>
                      <Link className="button button-quiet" href={`/dashboard/${server.id}?section=console`}>
                        Console
                      </Link>
                    </div>
                    <div className="server-card-footer">
                      <Link href={`/dashboard/${server.id}`}>Manage server</Link>
                      <button
                        className="server-delete"
                        onClick={() => void deleteServer(server)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="create-server-panel" id="create-server">
          <div>
            <span className="servers-eyebrow">GET STARTED</span>
            <h2>Create a server</h2>
            <p>Choose a Docker runtime image. The provider confirms availability during allocation; the runtime image alone does not mean an application is installed.</p>
          </div>
          <form className="create-server-form" onSubmit={createServer}>
            <label>
              Server name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={48}
                placeholder="e.g. survival-world"
                required
              />
            </label>
            <label>
              Runtime
              <select value={selectedType} onChange={(event) => setType(event.target.value)}>
                {(catalog?.runtimes || []).map((serverType) => (
                  <option key={serverType.id} value={serverType.id}>
                  {serverType.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-primary create-server-submit" disabled={loading || !catalog?.provider.connected || !catalog.runtimes.length || catalog.slots.used >= catalog.slots.limit}>
              {loading ? "Creating…" : "Create server"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
