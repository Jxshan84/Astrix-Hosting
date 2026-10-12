"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { ChangeEvent, FormEvent } from "react";

const sections = [
  ["overview", "Overview"],
  ["console", "Console"],
  ["files", "Files"],
  ["resources", "Resources"],
  ["backups", "Backups"],
  ["logs", "Logs"],
  ["settings", "Settings"],
];

const starterTemplates: Record<string, Array<{ fileName: string; label: string; content: string }>> = {
  node: [
    { fileName: "package.json", label: "Node package.json", content: '{\n  "name": "my-server",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": { "start": "node index.js" }\n}\n' },
    { fileName: "index.js", label: "Node index.js", content: 'console.log("Astrix Node.js server ready");\n' },
    { fileName: "index.ts", label: "Node index.ts", content: 'console.log("Astrix TypeScript server ready");\n' },
    { fileName: "Dockerfile", label: "Node Dockerfile", content: `FROM node:22-alpine\nWORKDIR /home/container\nCOPY . .\nCMD ["node", "index.js"]\n` },
  ],
  bun: [
    { fileName: "package.json", label: "Bun package.json", content: '{\n  "name": "my-server",\n  "scripts": { "start": "bun run index.ts" }\n}\n' },
    { fileName: "index.ts", label: "Bun index.ts", content: 'console.log("Astrix Bun server ready");\n' },
    { fileName: "Dockerfile", label: "Bun Dockerfile", content: `FROM oven/bun:alpine\nWORKDIR /home/container\nCOPY . .\nCMD ["bun", "run", "index.ts"]\n` },
  ],
  python: [
    { fileName: "requirements.txt", label: "Python requirements.txt", content: "# Add reviewed Python dependencies here.\n" },
    { fileName: "index.py", label: "Python index.py", content: 'print("Astrix Python server ready")\n' },
    { fileName: "Dockerfile", label: "Python Dockerfile", content: `FROM python:3.13-alpine\nWORKDIR /home/container\nCOPY . .\nCMD ["python", "index.py"]\n` },
  ],
  go: [{ fileName: "main.go", label: "Go main.go", content: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Astrix Go server ready")\n}\n' }],
  rust: [{ fileName: "main.rs", label: "Rust main.rs", content: 'fn main() {\n    println!("Astrix Rust server ready");\n}\n' }],
  java: [{ fileName: "Main.java", label: "Java Main.java", content: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Astrix Java server ready");\n  }\n}\n' }],
  php: [{ fileName: "index.php", label: "PHP index.php", content: '<?php\necho "Astrix PHP server ready\\n";\n' }],
  ruby: [{ fileName: "main.rb", label: "Ruby main.rb", content: 'puts "Astrix Ruby server ready"\n' }],
  deno: [{ fileName: "index.ts", label: "Deno index.ts", content: 'console.log("Astrix Deno server ready");\n' }],
  lavalink: [{ fileName: "application.yml", label: "Lavalink configuration", content: "server:\n  port: 2333\n  address: 0.0.0.0\n" }],
};

type Server = {
  id: string;
  name: string;
  type: string;
  createdAt: string;
};
type ManagedFile = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAt: string | null;
};

type RuntimeStats = {
  cpu: string | null;
  memory: string | null;
  memoryPercent: string | null;
} | null;

export default function ServerPage() {
  const params = useParams<{ serverId: string }>();
  const searchParams = useSearchParams();
  const serverId = String(params.serverId);
  const [server, setServer] = useState<Server | null>(null);
  const [status, setStatus] = useState("loading");
  const [stats, setStats] = useState<RuntimeStats>(null);
  const [error, setError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [logs, setLogs] = useState("");
  const [command, setCommand] = useState("");
  const [section, setSection] = useState("overview");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [filePath, setFilePath] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const consoleSocket = useRef<WebSocket | null>(null);
  const consoleConnectionId = useRef(0);
  const consoleReconnectCount = useRef(0);
  const consoleReconnectTimer = useRef<number | null>(null);
  const consoleStableTimer = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load server.");
      setServer(data.server);
      setStatus(data.docker.status);
      setStats(data.stats);
      setError("");
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load server."
      );
    }
  }, [serverId]);

  const loadFiles = useCallback(async () => {
    const response = await fetch(
      `/api/servers/${encodeURIComponent(serverId)}/files?path=${encodeURIComponent(filePath)}`,
      { cache: "no-store" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to list server files.");
    setFiles(data.files as ManagedFile[]);
    setError("");
  }, [filePath, serverId]);

  async function fileApi(path: string, init?: RequestInit) {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/files${path}`, {
      ...init,
      headers: {
        ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Server file operation failed.");
    return data;
  }

  function chooseTemplate(fileName: string) {
    const template = server
      ? (starterTemplates[server.type] || []).find((item) => item.fileName === fileName)
      : undefined;
    if (!template) {
      setSelectedTemplate("");
      return;
    }
    setSelectedFile("");
    setFileName(template.fileName);
    setFileContent(template.content);
    setSelectedTemplate(template.fileName);
  }

  async function openTextFile(path: string) {
    setFileBusy(true);
    try {
      const data = await fileApi(`/content?path=${encodeURIComponent(path)}`);
      setSelectedFile(path);
      setFileName(path);
      setFileContent(data.content);
      setSelectedTemplate("");
      setError("");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to open this text file.");
    } finally {
      setFileBusy(false);
    }
  }

  async function saveTextFile(overwrite = false) {
    const path = selectedFile || (filePath ? `${filePath}/${fileName}` : fileName);
    if (!path) {
      setError("Enter a file name.");
      return;
    }
    setFileBusy(true);
    try {
      try {
        await fileApi("/file", {
          method: "POST",
          body: JSON.stringify({ path, content: fileContent, overwrite }),
        });
      } catch (saveError) {
        if (!(saveError instanceof Error) || !/already exists|overwrite/i.test(saveError.message) || overwrite) throw saveError;
        if (!window.confirm(`${path} already exists. Replace it?`)) return;
        await saveTextFile(true);
        return;
      }
      setSelectedFile(path);
      setFileName(path);
      setSelectedTemplate("");
      await loadFiles();
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save this file.");
    } finally {
      setFileBusy(false);
    }
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = filePath ? `${filePath}/${newFolderName}` : newFolderName;
    setFileBusy(true);
    try {
      await fileApi("/folder", { method: "POST", body: JSON.stringify({ path }) });
      setNewFolderName("");
      await loadFiles();
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to create folder.");
    } finally {
      setFileBusy(false);
    }
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Uploads are limited to 10 MiB.");
      event.target.value = "";
      return;
    }
    const path = filePath ? `${filePath}/${file.name}` : file.name;
    setFileBusy(true);
    setUploadProgress(0);
    try {
      const send = (overwrite: boolean) => new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/servers/${encodeURIComponent(serverId)}/files/upload`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-File-Path", path);
        xhr.setRequestHeader("X-File-Content-Type", file.type || "application/octet-stream");
        if (overwrite) xhr.setRequestHeader("X-Confirm-Overwrite", "true");
        xhr.upload.onprogress = (progress) => {
          if (progress.lengthComputable) setUploadProgress(Math.round((progress.loaded / progress.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let errorMessage = "Upload failed.";
            try {
              errorMessage = JSON.parse(xhr.responseText).error || errorMessage;
            } catch {}
            reject(Object.assign(new Error(errorMessage), { status: xhr.status }));
          }
        };
        xhr.onerror = () => reject(new Error("Upload connection failed."));
        xhr.send(file);
      });
      try {
        await send(false);
      } catch (uploadError) {
        if (!(uploadError instanceof Error) || !/already exists|overwrite/i.test(uploadError.message)) throw uploadError;
        if (!window.confirm(`${path} already exists. Replace it?`)) return;
        await send(true);
      }
      await loadFiles();
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setFileBusy(false);
      setUploadProgress(null);
      event.target.value = "";
    }
  }

  async function moveFile(path: string) {
    const destination = window.prompt("New relative path:", path);
    if (!destination || destination === path) return;
    setFileBusy(true);
    try {
      try {
        await fileApi("/move", {
          method: "PATCH",
          body: JSON.stringify({ fromPath: path, toPath: destination }),
        });
      } catch (moveError) {
        if (!(moveError instanceof Error) || !/already exists|overwrite/i.test(moveError.message)) throw moveError;
        if (!window.confirm(`${destination} already exists. Replace it?`)) return;
        await fileApi("/move", {
          method: "PATCH",
          body: JSON.stringify({ fromPath: path, toPath: destination, overwrite: true }),
        });
      }
      await loadFiles();
      setError("");
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Unable to move this path.");
    } finally {
      setFileBusy(false);
    }
  }

  async function deleteFile(path: string) {
    if (!window.confirm(`Permanently delete ${path}?`)) return;
    setFileBusy(true);
    try {
      await fileApi(`?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: true }),
      });
      if (selectedFile === path) {
        setSelectedFile("");
        setFileContent("");
      }
      await loadFiles();
      setError("");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to delete this path.");
    } finally {
      setFileBusy(false);
    }
  }

  async function action(name: "start" | "stop" | "restart") {
    setActionPending(true);
    setError("");
    try {
      const response = await fetch(`/api/servers/${serverId}/${name}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Unable to ${name} server.`);
      setStatus(data.status);
      await refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : `Unable to ${name} server.`
      );
    } finally {
      setActionPending(false);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch(`/api/servers/${serverId}/logs`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load server logs.");
      setLogs(data.logs || "");
      setError("");
    } catch (logError) {
      setError(logError instanceof Error ? logError.message : "Unable to load server logs.");
    }
  }

  async function connectConsole(automaticRetry = false) {
    if (!automaticRetry) consoleReconnectCount.current = 0;
    const connectionId = ++consoleConnectionId.current;
    if (consoleReconnectTimer.current !== null) {
      window.clearTimeout(consoleReconnectTimer.current);
      consoleReconnectTimer.current = null;
    }
    consoleSocket.current?.close();

    try {
      const tokenResponse = await fetch(`/api/console/token/${serverId}`);
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error || "Failed to authorize console.");
      }

      const configuredBackend = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (!configuredBackend) {
        throw new Error(
          "Set NEXT_PUBLIC_BACKEND_URL to the public backend URL to use the live console."
        );
      }
      const backendUrl = new URL(configuredBackend);
      backendUrl.protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";

      const ws = new WebSocket(
        `${backendUrl.origin}/ws/console/${encodeURIComponent(serverId)}?token=${encodeURIComponent(tokenData.token)}`
      );
      consoleSocket.current = ws;

      ws.onopen = () => {
        if (connectionId !== consoleConnectionId.current) {
          ws.close();
          return;
        }
        if (consoleStableTimer.current !== null) {
          window.clearTimeout(consoleStableTimer.current);
        }
        consoleStableTimer.current = window.setTimeout(() => {
          consoleReconnectCount.current = 0;
          consoleStableTimer.current = null;
        }, 30_000);
        setLogs((v) => v + "\n[Console connected to backend]\n");
      };

      ws.onmessage = (event) => {
        if (connectionId !== consoleConnectionId.current) return;
        setLogs((v) => v + event.data);
      };

      ws.onerror = () => {
        if (connectionId === consoleConnectionId.current) {
          setError("Console connection failed. Check NEXT_PUBLIC_BACKEND_URL and the backend WebSocket port.");
        }
      };

      ws.onclose = () => {
        if (connectionId !== consoleConnectionId.current) return;
        if (consoleStableTimer.current !== null) {
          window.clearTimeout(consoleStableTimer.current);
          consoleStableTimer.current = null;
        }
        setLogs((v) => v + "\n[Console disconnected]\n");
        consoleSocket.current = null;
        setSocket(null);
        if (consoleReconnectCount.current < 5) {
          const delay = Math.min(1000 * 2 ** consoleReconnectCount.current, 16_000);
          consoleReconnectCount.current += 1;
          consoleReconnectTimer.current = window.setTimeout(() => {
            consoleReconnectTimer.current = null;
            void connectConsole(true);
          }, delay);
        } else {
          setError("Console disconnected after several retries. Select Connect to try again.");
        }
      };

      setSocket(ws);
    } catch (error) {
      if (connectionId !== consoleConnectionId.current) return;
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
    void Promise.resolve().then(refresh);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (section !== "files" || status !== "running") return;
    void loadFiles().catch((fileError: unknown) => {
      setError(fileError instanceof Error ? fileError.message : "Unable to load server files.");
    });
  }, [filePath, loadFiles, section, status]);

  useEffect(() => {
    const requestedSection = searchParams.get("section");
    if (sections.some(([id]) => id === requestedSection)) {
      setSection(requestedSection || "overview");
    }
  }, [searchParams]);

  useEffect(() => () => {
    consoleConnectionId.current += 1;
    if (consoleReconnectTimer.current !== null) {
      window.clearTimeout(consoleReconnectTimer.current);
    }
    if (consoleStableTimer.current !== null) {
      window.clearTimeout(consoleStableTimer.current);
    }
    consoleSocket.current?.close();
  }, []);

  if (!server) {
    return (
      <main className="server-loading">
        <div>
          <strong>Astrix Hosting</strong>
          {error ? <p role="alert">{error}</p> : <p>Loading server...</p>}
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
            ● {status === "running" ? "Container running" : status === "missing" ? "Provider resource missing" : status}
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
            <button onClick={() => void refresh()}>Refresh</button>
            <button onClick={() => void action("start")} disabled={actionPending || status === "running"}>Start Server</button>
          </div>
        </header>

        {error && <div className="server-notice server-notice-error" role="alert">{error}</div>}

        {section === "overview" && (
          <div className="panel-grid">
            <div className="hero-card">
              <small>DOCKER CONTAINER STATUS</small>
              <h2>{status === "running" ? "Running" : status === "missing" ? "Provider resource missing" : status}</h2>
              <p>{server.type} runtime image · Docker Engine · {server.id}</p>

              <div className="action-row">
                <button onClick={() => void action("start")} disabled={actionPending || status === "running"}>Start</button>
                <button onClick={() => void action("restart")} disabled={actionPending || status !== "running"}>Restart</button>
                <button onClick={() => void action("stop")} disabled={actionPending || status !== "running"}>Stop</button>
              </div>
            </div>

            <div className="info-card">
              <small>CPU USAGE</small>
              <strong>{stats?.cpu || "—"}</strong>
              <span>Live Docker usage</span>
            </div>

            <div className="info-card">
              <small>MEMORY USAGE</small>
              <strong>{stats?.memory || "—"}</strong>
              <span>{stats?.memoryPercent ? `${stats.memoryPercent} of limit` : "Available while running"}</span>
            </div>

            <div className="info-card">
              <small>STORAGE</small>
              <strong>Not reported</strong>
              <span>Storage metrics are not provided by the current backend.</span>
            </div>

            <div className="info-card wide">
              <small>SERVER TEMPLATE</small>
              <strong>{server.type}</strong>
              <span>Created {new Date(server.createdAt).toLocaleString()} · Docker container</span>
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
              <button onClick={() => void connectConsole()}>Connect</button>
            </div>

            <pre>{logs || "Connect to the live server console to view output."}</pre>

            <div className="command-bar">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendCommand();
                }}
                placeholder="Enter command..."
                aria-label="Console command"
              />
              <button onClick={sendCommand} disabled={!command.trim() || socket?.readyState !== 1}>Send</button>
            </div>
          </section>
        )}

        {section === "files" && (
          <section className="file-manager">
            <div className="card-title">
              <div>
                <small>PERSISTENT DOCKER VOLUME · 10 MiB UPLOAD LIMIT</small>
                <h2>File manager</h2>
              </div>
              <button onClick={() => void loadFiles().catch((fileError: unknown) => setError(fileError instanceof Error ? fileError.message : "Unable to refresh files."))} disabled={fileBusy || status !== "running"}>Refresh</button>
            </div>
            {status !== "running" ? (
              <p role="status">Start this container to list or manage files.</p>
            ) : (
              <>
                <nav className="file-breadcrumbs" aria-label="File location">
                  <button onClick={() => { setFilePath(""); setSelectedFile(""); }}>home/container</button>
                  {filePath.split("/").filter(Boolean).map((segment, index, segments) => {
                    const path = segments.slice(0, index + 1).join("/");
                    return <button key={path} onClick={() => { setFilePath(path); setSelectedFile(""); }}>/{segment}</button>;
                  })}
                </nav>
                <div className="file-manager-tools">
                  <form onSubmit={createFolder}>
                    <label>New folder<input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={255} required /></label>
                    <button disabled={fileBusy}>Create folder</button>
                  </form>
                  <label className="file-upload-control">
                    Upload file (max 10 MiB)
                    <input type="file" onChange={(event) => void uploadFile(event)} disabled={fileBusy} />
                  </label>
                </div>
                {uploadProgress !== null && <progress value={uploadProgress} max={100} aria-label="Upload progress">{uploadProgress}%</progress>}
                <div className="file-manager-list" aria-live="polite">
                  {files.length === 0 ? <p>This directory is empty.</p> : files.map((file) => (
                    <article className="file-row" key={file.path}>
                      <button
                        className="file-entry-name"
                        onClick={() => file.type === "directory"
                          ? (setFilePath(file.path), setSelectedFile(""))
                          : file.type === "file" ? void openTextFile(file.path) : setError("Symbolic links are read-only and cannot be opened.")}
                        disabled={fileBusy}
                      >
                        <span aria-hidden="true">{file.type === "directory" ? "▰" : file.type === "symlink" ? "↗" : "▤"}</span>
                        {file.name}
                      </button>
                      <span>{file.type}</span>
                      <span>{file.type === "file" ? `${(file.size / 1024).toFixed(1)} KiB` : "—"}</span>
                      <span>{file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : "Not reported"}</span>
                      <div className="file-row-actions">
                        {file.type === "file" && <a href={`/api/servers/${encodeURIComponent(serverId)}/files/download?path=${encodeURIComponent(file.path)}`}>Download</a>}
                        <button onClick={() => void moveFile(file.path)} disabled={fileBusy || file.type === "symlink"}>Move / rename</button>
                        <button onClick={() => void deleteFile(file.path)} disabled={fileBusy || file.type === "symlink"}>Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="file-editor">
                  <h3>{selectedFile ? `Edit ${selectedFile}` : "Create from a reviewed starter template"}</h3>
                  <label>Template suggestion
                    <select value={selectedTemplate} onChange={(event) => chooseTemplate(event.target.value)}>
                      <option value="">Choose a local suggestion…</option>
                      {(starterTemplates[server.type] || []).map((template) => (
                        <option key={template.fileName} value={template.fileName}>{template.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>Relative file name
                    <input value={fileName} onChange={(event) => { setSelectedFile(""); setSelectedTemplate(""); setFileName(event.target.value); }} maxLength={1024} placeholder={filePath ? `${filePath}/index.js` : "index.js"} />
                  </label>
                  {selectedTemplate && <p>Suggestion preview only. Saving creates or explicitly replaces the file; no template code is executed automatically.</p>}
                  <label>Text content
                    <textarea value={fileContent} onChange={(event) => setFileContent(event.target.value)} maxLength={1024 * 1024} rows={14} spellCheck={false} />
                  </label>
                  <button onClick={() => void saveTextFile(false)} disabled={fileBusy || !fileName}>{fileBusy ? "Saving…" : selectedFile ? "Save changes" : "Create file"}</button>
                </div>
              </>
            )}
          </section>
        )}

        {section === "resources" && (
          <div className="panel-grid">
            <div className="info-card">
              <small>CPU USAGE</small>
              <strong>{stats?.cpu || "—"}</strong>
              <span>Docker Engine measurement</span>
            </div>

            <div className="info-card">
              <small>RAM USAGE</small>
              <strong>{stats?.memory || "—"}</strong>
              <span>{stats?.memoryPercent ? `${stats.memoryPercent} of limit` : "Available while running"}</span>
            </div>

            <div className="info-card">
              <small>STORAGE</small>
              <strong>Not reported</strong>
              <span>Disk metrics are not provided by the backend.</span>
            </div>
          </div>
        )}

        {section === "backups" && (
          <div className="empty-panel">
            <h2>Backups</h2>
            <p>Create and restore server backups from here.</p>
            <p>Backup creation is not supported by the current backend.</p>
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
              <input value={server.type} readOnly />
            </label>

            <p>Server name and runtime edits are not supported by the current backend.</p>
          </div>
        )}

      </section>
    </main>
  );
}
