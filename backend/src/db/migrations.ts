import type Database from "better-sqlite3";

const baseVersion = 1;
const securityVersion = 2;
const allocationVersion = 3;
const resourceVersion = 4;
const currentVersion = 6;

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(baseVersion);

  if (!applied) {
    const migrate = db.transaction(() => {
    const announcementColumns = db
      .prepare("PRAGMA table_info(announcements)")
      .all() as Array<{ name: string }>;
    const hasAnnouncementColumn = (name: string) =>
      announcementColumns.some((column) => column.name === name);

    if (!hasAnnouncementColumn("creator_user_id")) {
      db.exec("ALTER TABLE announcements ADD COLUMN creator_user_id INTEGER");
    }
    if (!hasAnnouncementColumn("audience")) {
      db.exec("ALTER TABLE announcements ADD COLUMN audience TEXT NOT NULL DEFAULT 'all_users'");
    }
    if (!hasAnnouncementColumn("link")) {
      db.exec("ALTER TABLE announcements ADD COLUMN link TEXT");
    }
    if (!hasAnnouncementColumn("status")) {
      db.exec("ALTER TABLE announcements ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'");
    }
    if (!hasAnnouncementColumn("sent_at")) {
      db.exec("ALTER TABLE announcements ADD COLUMN sent_at TEXT");
    }
    if (!hasAnnouncementColumn("delivery_count")) {
      db.exec("ALTER TABLE announcements ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasAnnouncementColumn("failure_count")) {
      db.exec("ALTER TABLE announcements ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0");
    }
    db.exec(`
      UPDATE announcements
      SET sent_at = created_at
      WHERE status = 'sent' AND sent_at IS NULL
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS staff_permissions (
        user_id INTEGER NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN (
          'announcement_management',
          'moderation_review',
          'appeal_review',
          'support_review'
        )),
        granted_by INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, permission),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        event_id TEXT PRIMARY KEY,
        actor_user_id INTEGER,
        event_type TEXT NOT NULL,
        target_user_id INTEGER,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS audit_log_no_update
      BEFORE UPDATE ON audit_log BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
      BEFORE DELETE ON audit_log BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TABLE IF NOT EXISTS announcement_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('delivered', 'failed')),
        created_at TEXT NOT NULL,
        UNIQUE (announcement_id, user_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        announcement_id INTEGER,
        appeal_id TEXT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      );

      CREATE TABLE IF NOT EXISTS account_restrictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        restriction_type TEXT NOT NULL CHECK (restriction_type IN ('temporary', 'permanent')),
        reason TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        appeal_eligible INTEGER NOT NULL DEFAULT 1 CHECK (appeal_eligible IN (0, 1)),
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_by INTEGER,
        revoked_at TEXT,
        revocation_reason TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (revoked_by) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_restrictions_active
      ON account_restrictions(user_id, revoked_at, expires_at);

      CREATE TABLE IF NOT EXISTS appeals (
        id TEXT PRIMARY KEY,
        restriction_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        explanation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        decision_notes TEXT,
        reviewer_user_id INTEGER,
        submitted_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY (restriction_id) REFERENCES account_restrictions(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_one_pending_per_restriction
      ON appeals(restriction_id) WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS appeal_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appeal_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'application/pdf')),
        content BLOB NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (appeal_id) REFERENCES appeals(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS security_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        automation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (automation_enabled IN (0, 1)),
        login_failure_threshold INTEGER NOT NULL DEFAULT 10 CHECK (login_failure_threshold BETWEEN 3 AND 50),
        login_lockout_minutes INTEGER NOT NULL DEFAULT 15 CHECK (login_lockout_minutes BETWEEN 1 AND 1440),
        spam_threshold_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (spam_threshold_per_minute BETWEEN 3 AND 100),
        overload_cpu_threshold REAL NOT NULL DEFAULT 95 CHECK (overload_cpu_threshold BETWEEN 50 AND 100),
        overload_memory_threshold REAL NOT NULL DEFAULT 92 CHECK (overload_memory_threshold BETWEEN 50 AND 100),
        overload_required_strikes INTEGER NOT NULL DEFAULT 3 CHECK (overload_required_strikes BETWEEN 2 AND 10),
        updated_by INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS user_action_windows (
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        action_count INTEGER NOT NULL,
        window_started_at TEXT NOT NULL,
        PRIMARY KEY (user_id, action),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS security_exemptions (
        user_id INTEGER PRIMARY KEY,
        reason TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS security_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_type TEXT NOT NULL,
        actor_user_id INTEGER,
        evidence_ref TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
        reviewer_user_id INTEGER,
        reviewer_notes TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY (actor_user_id) REFERENCES users(id),
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
      );

      CREATE TRIGGER IF NOT EXISTS security_incident_evidence_immutable
      BEFORE UPDATE OF incident_type, actor_user_id, evidence_ref, action_taken, created_at
      ON security_incidents BEGIN
        SELECT RAISE(ABORT, 'security incident evidence is immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS security_incident_no_delete
      BEFORE DELETE ON security_incidents BEGIN
        SELECT RAISE(ABORT, 'security incidents cannot be deleted');
      END;

      CREATE TABLE IF NOT EXISTS login_attempts (
        remote_hash TEXT PRIMARY KEY,
        failure_count INTEGER NOT NULL DEFAULT 0,
        window_started_at TEXT NOT NULL,
        blocked_until TEXT
      );

      INSERT OR IGNORE INTO security_settings (id, updated_at)
      VALUES (1, datetime('now'));
    `);

    db.prepare(`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(baseVersion, new Date().toISOString());
    });

    migrate();
  }

  const current = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(securityVersion);

  if (!current) {
    const migrateSecurityAndBot = db.transaction(() => {
    const settingsColumns = db
      .prepare("PRAGMA table_info(security_settings)")
      .all() as Array<{ name: string }>;
    const hasSettingsColumn = (name: string) =>
      settingsColumns.some((column) => column.name === name);
    if (!hasSettingsColumn("overload_cpu_threshold")) {
      db.exec("ALTER TABLE security_settings ADD COLUMN overload_cpu_threshold REAL NOT NULL DEFAULT 95");
    }
    if (!hasSettingsColumn("overload_memory_threshold")) {
      db.exec("ALTER TABLE security_settings ADD COLUMN overload_memory_threshold REAL NOT NULL DEFAULT 92");
    }
    if (!hasSettingsColumn("overload_required_strikes")) {
      db.exec("ALTER TABLE security_settings ADD COLUMN overload_required_strikes INTEGER NOT NULL DEFAULT 3");
    }

    for (const [name, definition] of [
      ["discord_abuse_detection_enabled", "INTEGER NOT NULL DEFAULT 1"],
      ["discord_spam_threshold", "INTEGER NOT NULL DEFAULT 8"],
      ["discord_spam_window_seconds", "INTEGER NOT NULL DEFAULT 10"],
      ["discord_abuse_repeat_threshold", "INTEGER NOT NULL DEFAULT 3"],
      ["discord_timeout_minutes", "INTEGER NOT NULL DEFAULT 10"],
      ["discord_abuse_terms_json", "TEXT NOT NULL DEFAULT '[]'"],
    ]) {
      if (!hasSettingsColumn(name)) {
        db.exec(`ALTER TABLE security_settings ADD COLUMN ${name} ${definition}`);
      }
    }

    const staffPermissions = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'staff_permissions'")
      .get() as { sql: string } | undefined;
    if (staffPermissions?.sql && !staffPermissions.sql.includes("'discord_moderation'")) {
      db.exec(`
        CREATE TABLE staff_permissions_v2 (
          user_id INTEGER NOT NULL,
          permission TEXT NOT NULL CHECK (permission IN (
            'announcement_management',
            'moderation_review',
            'appeal_review',
            'support_review',
            'discord_moderation'
          )),
          granted_by INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, permission),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (granted_by) REFERENCES users(id)
        );
        INSERT INTO staff_permissions_v2 (user_id, permission, granted_by, created_at)
        SELECT user_id, permission, granted_by, created_at FROM staff_permissions;
        DROP TABLE staff_permissions;
        ALTER TABLE staff_permissions_v2 RENAME TO staff_permissions;
      `);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'processing', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_bot_outbox_pending
      ON bot_outbox(status, updated_at, id);
    `);
    db.prepare(`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(securityVersion, new Date().toISOString());
    });
    migrateSecurityAndBot();
  }

  const allocationApplied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(allocationVersion);

  if (!allocationApplied) {
    const allocationMigration = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plan_limits (
        plan TEXT PRIMARY KEY CHECK (plan IN ('free', 'starter', 'pro', 'premium')),
        max_servers INTEGER NOT NULL CHECK (max_servers BETWEEN 0 AND 100),
        memory_mb INTEGER NOT NULL CHECK (memory_mb BETWEEN 128 AND 65536),
        cpu_cores REAL NOT NULL CHECK (cpu_cores > 0 AND cpu_cores <= 64),
        updated_by INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS server_allocations (
        server_id TEXT PRIMARY KEY,
        owner_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_server_allocations_owner
      ON server_allocations(owner_user_id);
    `);
    const insertLimit = db.prepare(`
      INSERT OR IGNORE INTO plan_limits
        (plan, max_servers, memory_mb, cpu_cores, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    insertLimit.run("free", 1, 512, 0.5, now);
    insertLimit.run("starter", 2, 1024, 1, now);
    insertLimit.run("pro", 5, 4096, 2, now);
    insertLimit.run("premium", 10, 8192, 4, now);
    db.prepare(`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(allocationVersion, now);
    });
    allocationMigration();
  }

  const resourceAllocationApplied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(resourceVersion);

  if (!resourceAllocationApplied) {
    const resourceAllocationMigration = db.transaction(() => {
      const serverColumns = db
        .prepare("PRAGMA table_info(servers)")
        .all() as Array<{ name: string }>;
      const allocationColumns = db
        .prepare("PRAGMA table_info(server_allocations)")
        .all() as Array<{ name: string }>;
      if (!serverColumns.some((column) => column.name === "allocated_memory_mb")) {
        db.exec("ALTER TABLE servers ADD COLUMN allocated_memory_mb INTEGER NOT NULL DEFAULT 512");
      }
      if (!serverColumns.some((column) => column.name === "allocated_cpu_cores")) {
        db.exec("ALTER TABLE servers ADD COLUMN allocated_cpu_cores REAL NOT NULL DEFAULT 0.5");
      }
      if (!allocationColumns.some((column) => column.name === "memory_mb")) {
        db.exec("ALTER TABLE server_allocations ADD COLUMN memory_mb INTEGER NOT NULL DEFAULT 512");
      }
      if (!allocationColumns.some((column) => column.name === "cpu_cores")) {
        db.exec("ALTER TABLE server_allocations ADD COLUMN cpu_cores REAL NOT NULL DEFAULT 0.5");
      }

      db.prepare(`
        UPDATE servers
        SET allocated_memory_mb = 512, allocated_cpu_cores = 0.5
      `).run();
      db.prepare(`
        UPDATE server_allocations
        SET memory_mb = 65536, cpu_cores = 64
      `).run();

      db.prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `).run(resourceVersion, new Date().toISOString());
    });
    resourceAllocationMigration();
  }

  const welcomeApplied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(currentVersion);

  if (!welcomeApplied) {
    const welcomeMigration = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS welcome_campaign (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          percentage INTEGER NOT NULL DEFAULT 10 CHECK (percentage = 10),
          expires_at TEXT,
          redemption_limit INTEGER CHECK (redemption_limit IS NULL OR redemption_limit > 0),
          updated_by INTEGER,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (updated_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS welcome_reward_claims (
          user_id INTEGER PRIMARY KEY,
          coupon_code TEXT NOT NULL UNIQUE,
          claimed_at TEXT NOT NULL,
          redeemed_at TEXT,
          redeemed_plan TEXT CHECK (redeemed_plan IS NULL OR redeemed_plan IN ('starter', 'pro', 'premium')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_welcome_claims_date
        ON welcome_reward_claims(claimed_at);

        INSERT OR IGNORE INTO welcome_campaign (id, enabled, percentage, updated_at)
        VALUES (1, 1, 10, datetime('now'));
      `);
      db.prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `).run(5, new Date().toISOString());
    });
    welcomeMigration();
  }

  const rewardMigrationApplied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(currentVersion);

  if (!rewardMigrationApplied) {
    const rewardMigration = db.transaction(() => {
      db.exec(`
        CREATE TABLE welcome_reward_claims_v6 (
          user_id INTEGER PRIMARY KEY,
          coupon_code TEXT UNIQUE,
          claimed_at TEXT NOT NULL,
          redeemed_at TEXT,
          redeemed_plan TEXT CHECK (redeemed_plan IS NULL OR redeemed_plan IN ('starter', 'pro', 'premium')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        INSERT INTO welcome_reward_claims_v6
          (user_id, coupon_code, claimed_at, redeemed_at, redeemed_plan)
        SELECT user_id, coupon_code, claimed_at, redeemed_at, redeemed_plan
        FROM welcome_reward_claims;

        DROP TABLE welcome_reward_claims;
        ALTER TABLE welcome_reward_claims_v6 RENAME TO welcome_reward_claims;
        CREATE INDEX idx_welcome_claims_date ON welcome_reward_claims(claimed_at);
      `);
      db.prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `).run(currentVersion, new Date().toISOString());
    });
    rewardMigration();
  }
}
