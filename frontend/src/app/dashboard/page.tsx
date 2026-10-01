"use client";

import { useEffect, useState } from "react";

const serverTypes = [
  { id: "node", name: "Node.js", free: true },
  { id: "python", name: "Python", free: true },
  { id: "bun", name: "Bun", free: true },
  { id: "lavalink", name: "Lavalink", free: true },
  { id: "java", name: "Java", premium: true },
  { id: "go", name: "Go", premium: true },
  { id: "rust", name: "Rust", premium: true },
  { id: "php", name: "PHP", premium: true },
  { id: "deno", name: "Deno", premium: true },
  { id: "ruby", name: "Ruby", premium: true },
];

type Server = {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  status?: string;
};

export default function Dashboard() {
  const [name, setName] = useState("");
  const [type, setType] = useState("node");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [servers, setServers] = useState<Server[]>([]);
  const [serversLoading, setServersLoading] = useState(true);

const totalServers = servers.length;
const runningServers = servers.filter(
  s => s.status === "running"
).length;

const ramUsed = `${runningServers * 512} MB`;
const storageUsed = `${runningServers * 1} GB`;

  async function loadServers() {
    try {
      setServersLoading(true);

      const response = await fetch("/api/servers");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load servers.");
      }

      const detailed = await Promise.all(
        (data.servers || []).map(async (server: Server) => {
          try {
            const detailResponse = await fetch(`/api/servers/${server.id}`);
            const detail = await detailResponse.json();

            return {
              ...server,
              status: detail.docker?.status || "unknown",
            };
          } catch {
            return {
              ...server,
              status: "unknown",
            };
          }
        })
      );

      setServers(detailed);
    } catch (error) {
      console.error(error);
      setServers([]);
    } finally {
      setServersLoading(false);
    }
  }

  useEffect(() => {
    void loadServers();

    const timer = window.setInterval(() => {
      void loadServers();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  async function createServer() {
    if (!name.trim()) {
      setMessage("Enter a server name.");
      return;
    }

    setLoading(true);
    setMessage("Creating server...");

    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create server.");
      }

      setName("");
      setMessage("Server created successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to create server."
      );
    } finally {
      setLoading(false);
    }
  }


  async function deleteServer(serverId: string, serverName: string) {
    const confirmed = window.confirm(
      `Delete "${serverName}"? This will permanently remove the server.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete server.");
      }

      await loadServers();
      setMessage("Server deleted successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete server.");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "28px 5%",
        color: "white",
        background:
          "radial-gradient(circle at top, #123526 0%, #07100d 42%, #030605 100%)",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 35,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              letterSpacing: 3,
              color: "#69e89a",
              fontWeight: 700,
            }}
          >
            ASTRIX HOSTING
          </div>
          <h1 style={{ fontSize: 36, margin: "8px 0 5px" }}>
            Dashboard
          </h1>
          <p style={{ opacity: 0.6, margin: 0 }}>
            Manage your servers from one place.
          </p>
        </div>

        <a
          href="/support"
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            color: "white",
            textDecoration: "none",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          Support
        </a>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {[
  ["Servers", String(totalServers)],
  ["Running", String(runningServers)],
  ["RAM", ramUsed],
  ["Storage", storageUsed],
].map(([title, value]) => (
          <div
            key={title}
            style={{
              padding: 20,
              borderRadius: 16,
              background: "rgba(255,255,255,0.055)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <div style={{ opacity: 0.55, fontSize: 13 }}>{title}</div>
            <strong style={{ display: "block", fontSize: 25, marginTop: 8 }}>
              {value}
            </strong>
          </div>
        ))}
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 14,
          marginBottom: 30,
        }}
      >
        {[
          ["My Servers", "View and manage your servers"],
          ["Files", "Manage server files"],
          ["Backups", "Create and restore backups"],
          ["Resources", "CPU, RAM and storage"],
          ["Billing", "Plans and upgrades"],
          ["Support", "Get help from our team"],
        ].map(([title, description]) => (
          <div
            key={title}
            style={{
              padding: 18,
              borderRadius: 16,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <strong>{title}</strong>
            <p style={{ opacity: 0.55, fontSize: 13, lineHeight: 1.5 }}>
              {description}
            </p>
          </div>
        ))}
      </section>

      <section
        style={{
          maxWidth: 720,
          padding: 24,
          borderRadius: 20,
          marginBottom: 24,
          background: "rgba(255,255,255,0.055)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>My Servers</h2>
            <p style={{ margin: "6px 0 0", opacity: 0.65 }}>
              Live status updates every 15 seconds.
            </p>
          </div>

          <button
            onClick={() => void loadServers()}
            disabled={serversLoading}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid #34443d",
              background: "#0b1511",
              color: "white",
              cursor: serversLoading ? "wait" : "pointer",
            }}
          >
            {serversLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {serversLoading && servers.length === 0 ? (
          <p style={{ marginTop: 20, opacity: 0.7 }}>
            Loading your servers...
          </p>
        ) : servers.length === 0 ? (
          <p style={{ marginTop: 20, opacity: 0.7 }}>
            No servers yet. Create your first server below.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {servers.map((server) => {
              const running = server.status === "running";
              const stopped =
                server.status === "exited" ||
                server.status === "created" ||
                server.status === "stopped";

              return (
                <div
                  key={server.id}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 14,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong>{server.name}</strong>
                    <div style={{ opacity: 0.6, fontSize: 13, marginTop: 5 }}>
                      {server.type}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        background: running
                          ? "rgba(50,205,120,0.15)"
                          : stopped
                            ? "rgba(255,170,70,0.12)"
                            : "rgba(255,255,255,0.08)",
                        color: running
                          ? "#65e89b"
                          : stopped
                            ? "#ffbd70"
                            : "#ddd",
                      }}
                    >
                      {running
                        ? "● Running"
                        : stopped
                          ? "● Stopped"
                          : `● ${server.status || "Unknown"}`}
                    </span>

                    <div style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
            }}>
              <button
                      onClick={() =>
                        (window.location.href = `/dashboard/${server.id}`)
                      }
                      style={{
                        padding: "8px 12px",
                        borderRadius: 9,
                        border: "1px solid #34443d",
                        background: "#101d17",
                        color: "white",
                        cursor: "pointer",
                      }}
                    >
                      Open
                    </button>
              <button
                onClick={() => deleteServer(server.id, server.name)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 9,
                  border: "1px solid rgba(255,100,100,.25)",
                  background: "rgba(70,20,20,.7)",
                  color: "#ffaaaa",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        style={{
          maxWidth: 720,
          padding: 24,
          borderRadius: 20,
          background: "rgba(255,255,255,0.055)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Create Server</h2>
        <p style={{ opacity: 0.6 }}>
          Choose the runtime for your new hosting server.
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 14,
            marginTop: 10,
            borderRadius: 11,
            border: "1px solid #34443d",
            background: "#0b1511",
            color: "white",
          }}
        />

        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 14,
            marginTop: 12,
            borderRadius: 11,
            border: "1px solid #34443d",
            background: "#0b1511",
            color: "white",
          }}
        >
          {serverTypes.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
              {server.premium ? " — Premium" : " — Free"}
            </option>
          ))}
        </select>

        <button
          onClick={createServer}
          disabled={loading}
          style={{
            width: "100%",
            padding: 14,
            marginTop: 15,
            border: 0,
            borderRadius: 11,
            background: "#42e889",
            color: "#031008",
            fontWeight: 800,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Creating..." : "Create Server"}
        </button>

        {message && (
          <p style={{ marginTop: 14, opacity: 0.75 }}>{message}</p>
        )}
      </section>
    </main>
  );
}
