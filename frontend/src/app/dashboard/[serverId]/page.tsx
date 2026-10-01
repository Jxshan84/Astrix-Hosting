"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const sections = [
  ["overview", "Overview"],
  ["console", "Console"],
  ["files", "Files"],
  ["resources", "Resources"],
  ["backups", "Backups"],
  ["logs", "Logs"],
  ["settings", "Settings"],
];

const templates = [
  ["node", "Node.js", "Free"],
  ["python", "Python", "Free"],
  ["bun", "Bun", "Free"],
  ["deno", "Deno", "Free"],
  ["java", "Java", "Premium"],
  ["go", "Go", "Free"],
  ["rust", "Rust", "Free"],
  ["php", "PHP", "Free"],
  ["ruby", "Ruby", "Free"],
  ["dotnet", ".NET", "Premium"],
  ["lavalink", "Lavalink", "Premium"],
  ["minecraft-java", "Minecraft Java", "Premium"],
  ["minecraft-bedrock", "Minecraft Bedrock", "Premium"],
];

export default function ServerPage() {
  const params = useParams();
  const serverId = String(params.serverId);
  const serverTypeInfo: Record<string, { name: string; icon: string }> = {
    node: { name: "Node.js", icon: "https://cdn.simpleicons.org/nodedotjs/68A063" },
    python: { name: "Python", icon: "https://cdn.simpleicons.org/python/3776AB" },
    bun: { name: "Bun", icon: "https://cdn.simpleicons.org/bun/FFFFFF" },
    deno: { name: "Deno", icon: "https://cdn.simpleicons.org/deno/FFFFFF" },
    java: { name: "Java", icon: "https://cdn.simpleicons.org/openjdk/FFFFFF" },
    go: { name: "Go", icon: "https://cdn.simpleicons.org/go/00ADD8" },
    rust: { name: "Rust", icon: "https://cdn.simpleicons.org/rust/FFFFFF" },
    php: { name: "PHP", icon: "https://cdn.simpleicons.org/php/777BB4" },
    ruby: { name: "Ruby", icon: "https://cdn.simpleicons.org/ruby/CC342D" },
    lavalink: { name: "Lavalink", icon: "https://cdn.simpleicons.org/sonos/FFFFFF" },
    dotnet: { name: ".NET", icon: "https://cdn.simpleicons.org/dotnet/512BD4" },
    "minecraft-java": { name: "Minecraft Java", icon: "https://cdn.simpleicons.org/minecraft/62B47A" },
    "minecraft-bedrock": { name: "Minecraft Bedrock", icon: "https://cdn.simpleicons.org/minecraft/62B47A" },
  };
  const [server, setServer] = useState<any>(null);
  const [status, setStatus] = useState("loading");
  const [logs, setLogs] = useState("");
  const [command, setCommand] = useState("");
  const [section, setSection] = useState("overview");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const currentType = serverTypeInfo[server?.type || ""] || {
    name: server?.type || "Server",
    icon: "https://cdn.simpleicons.org/docker/2496ED",
  };


  async function refresh() {
    const res = await fetch(`/api/servers/${serverId}`);
    const data = await res.json();

    if (res.ok) {
      setServer(data.server);
      setStatus(data.docker.status);
    }
  }

  async function action(name: "start" | "stop" | "restart") {
    setStatus("working");

    const res = await fetch(`/api/servers/${serverId}/${name}`, {
      method: "POST",
    });

    const data = await res.json();

    if (res.ok) {
      setStatus(data.status);
    } else {
      setStatus("error");
    }
  }

  async function loadLogs() {
    const res = await fetch(`/api/servers/${serverId}/logs`);
    const data = await res.json();

    if (res.ok) {
      setLogs(data.logs || "");
    }
  }

  async function connectConsole() {
    socket?.close();

    try {
      const tokenResponse = await fetch(`/api/console/token/${serverId}`);
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error || "Failed to authorize console.");
      }

      let backendOrigin = "";

      if (window.location.hostname === "localhost") {
        backendOrigin = `${window.location.protocol}//localhost:4000`;
      } else if (
        window.location.hostname.endsWith("-3000.app.github.dev")
      ) {
        backendOrigin = `${window.location.protocol}//${window.location.hostname.replace(
          "-3000.app.github.dev",
          "-4000.app.github.dev"
        )}`;
      } else {
        backendOrigin =
          window.location.protocol === "https:"
            ? "https://localhost:4000"
            : "http://localhost:4000";
      }

      const wsProtocol = backendOrigin.startsWith("https:")
        ? "wss:"
        : "ws:";

      const wsHost = backendOrigin.replace(/^https?:\/\//, "");

      const ws = new WebSocket(
        `${wsProtocol}//${wsHost}/ws/console/${serverId}?token=${encodeURIComponent(
          tokenData.token
        )}`
      );

      ws.onopen = () => {
        setLogs((v) => v + "\n[Console connected to backend]\n");
      };

      ws.onmessage = (event) => {
        setLogs((v) => v + event.data);
      };

      ws.onerror = () => {
        setLogs((v) => v + "\n[Console connection error]\n");
      };

      ws.onclose = () => {
        setLogs((v) => v + "\n[Console disconnected]\n");
        setSocket(null);
      };

      setSocket(ws);
    } catch (error) {
      setLogs(
        (v) =>
          v +
          `\n[Console authorization failed] ${
            error instanceof Error ? error.message : "Unknown error"
          }\n`
      );
    }
  }

  function sendCommand() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(command + "\n");
    setCommand("");
  }

  useEffect(() => {
    refresh();

    return () => socket?.close();
  }, [serverId]);

  if (!server) {
    return (
      <main className="server-loading">
        <div>
          <strong>Astrix Hosting</strong>
          <p>Loading server...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="server-panel">
      <aside className="server-sidebar">
        <div className="server-brand">
          <strong>ASTRIX</strong>
          <span>HOSTING</span>
        </div>

        <div className="server-name">
          <small>SERVER</small>
          <strong>{server.name}</strong>
          <span className={`status-dot ${status}`}>
            ● {status}
          </span>
        </div>

        <nav>
          {sections.map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button onClick={() => action("start")}>Start</button>
          <button onClick={() => action("restart")}>Restart</button>
          <button onClick={() => action("stop")}>Stop</button>
        </div>
      </aside>

      <section className="server-content">
        <header className="server-header">
          <div>
            <small>Astrix Hosting / Server</small>
            <h1>{server.name}</h1>
          </div>

          <div className="header-actions">
            <button onClick={refresh}>Refresh</button>
            <button onClick={() => action("start")}>Start Server</button>
          </div>
        </header>

        {section === "overview" && (
          <div className="panel-grid">
            <div className="hero-card">
              <small>SERVER STATUS</small>
              <h2>{status}</h2>
              <p>
                {server.type} · Docker · {server.id}
              </p>

              <div className="action-row">
                <button onClick={() => action("start")}>Start</button>
                <button onClick={() => action("restart")}>Restart</button>
                <button onClick={() => action("stop")}>Stop</button>
              </div>
            </div>

            <div className="info-card">
              <small>CPU</small>
              <strong>0.5 Core</strong>
              <span>Resource allocation</span>
            </div>

            <div className="info-card">
              <small>MEMORY</small>
              <strong>512 MB</strong>
              <span>Resource allocation</span>
            </div>

            <div className="info-card">
              <small>STORAGE</small>
              <strong>1 GB</strong>
              <span>Server storage</span>
            </div>

            <div className="info-card wide">
              <small>SERVER TEMPLATE</small>
              <strong>{server.type}</strong>
              <span>Docker-based deployment</span>
            </div>
          </div>
        )}

        {section === "console" && (
          <section className="console-card">
            <div className="card-title">
              <div>
                <small>LIVE TERMINAL</small>
                <h2>Console</h2>
              </div>
              <button onClick={connectConsole}>Connect</button>
            </div>

            <pre>{logs || "Console output will appear here..."}</pre>

            <div className="command-bar">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendCommand();
                }}
                placeholder="Enter command..."
              />
              <button onClick={sendCommand}>Send</button>
            </div>
          </section>
        )}

        {section === "files" && (
          <div className="empty-panel">
            <h2>File Manager</h2>
            <p>
              Upload, download, edit and manage your server files here.
            </p>
            <button>Open File Manager</button>
          </div>
        )}

        {section === "resources" && (
          <div className="panel-grid">
            <div className="info-card">
              <small>CPU USAGE</small>
              <strong>0%</strong>
              <span>Live usage</span>
            </div>

            <div className="info-card">
              <small>RAM USAGE</small>
              <strong>0 MB</strong>
              <span>Live usage</span>
            </div>

            <div className="info-card">
              <small>STORAGE</small>
              <strong>0 MB</strong>
              <span>Disk usage</span>
            </div>
          </div>
        )}

        {section === "backups" && (
          <div className="empty-panel">
            <h2>Backups</h2>
            <p>Create and restore server backups from here.</p>
            <button>Create Backup</button>
          </div>
        )}

        {section === "logs" && (
          <section className="console-card">
            <div className="card-title">
              <div>
                <small>SERVER OUTPUT</small>
                <h2>Logs</h2>
              </div>
              <button onClick={loadLogs}>Load Logs</button>
            </div>
            <pre>{logs || "No logs loaded."}</pre>
          </section>
        )}

        {section === "settings" && (
          <div className="settings-panel">
            <h2>Server Settings</h2>

            <label>
              Server name
              <input defaultValue={server.name} />
            </label>

            <label>
              Server template
              <select defaultValue={server.type}>
                {templates.map(([id, name, plan]) => (
                  <option key={id} value={id}>
                    {name} — {plan}
                  </option>
                ))}
              </select>
            </label>

            <button>Save Settings</button>
          </div>
        )}

        <section className="templates-section">
          <div>
            <small>AVAILABLE TEMPLATES</small>
            <h2>Server Types</h2>
          </div>

          <div className="template-grid">
            {templates.map(([id, name, plan]) => (
              <div className="template-card" key={id}>
                <strong>{name}</strong>
                <span className={plan === "Premium" ? "premium" : ""}>
                  {plan}
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
