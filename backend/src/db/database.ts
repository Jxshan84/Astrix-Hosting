import Database from "better-sqlite3";

export const db = new Database("astrix-hosting.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_code TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(ticket_id) REFERENCES tickets(id)
  );

  CREATE TABLE IF NOT EXISTS support_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'support',
    active INTEGER NOT NULL DEFAULT 1
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    support_enabled INTEGER NOT NULL DEFAULT 1,
    work_start TEXT NOT NULL DEFAULT '09:00',
    work_end TEXT NOT NULL DEFAULT '21:00',
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO site_settings
  (id, support_enabled, work_start, work_end, timezone)
  VALUES (1, 1, '09:00', '21:00', 'Asia/Kolkata');
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    discord_id TEXT UNIQUE,
    plan TEXT NOT NULL DEFAULT 'free',
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); `); const userColumns = db .prepare("PRAGMA table_info(users)") 
  .all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "google_id")) { 
  db.exec("ALTER TABLE users ADD COLUMN google_id TEXT");
}
db.exec(` CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON 
  users(google_id) WHERE google_id IS NOT NULL
`);

// Terms and Privacy acceptance migration
const userColumnsAfterPolicy = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;

if (!userColumnsAfterPolicy.some((column) => column.name === "terms_accepted_at")) {
  db.exec("ALTER TABLE users ADD COLUMN terms_accepted_at TEXT");
}

if (!userColumnsAfterPolicy.some((column) => column.name === "privacy_accepted_at")) {
  db.exec("ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    container_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_servers_owner
  ON servers(owner_user_id);
`);
