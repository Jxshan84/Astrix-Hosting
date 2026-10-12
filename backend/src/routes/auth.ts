import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db } from "../db/database.js";
import { frontendRedirect, frontendUrl, jwtSecret } from "../config.js";
import { isOwner, userPermissions } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

type UserRecord = {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  discord_id: string | null;
  plan: string;
  role: string;
  created_at: string;
};

function createToken(user: UserRecord) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      plan: user.plan,
    },
    jwtSecret,
    {
      expiresIn: "7d",
    }
  );
}

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    discordId: user.discord_id ?? null,
    plan: user.plan,
    role: isOwner(user.id) ? "owner" : "user",
    isOwner: isOwner(user.id),
    permissions: userPermissions(user.id),
    createdAt: user.created_at,
  };
}

function setSessionCookie(res: Response, token: string) {
  res.cookie("astrix_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function configuredGoogleCallback(value: string) {
  try {
    const callback = new URL(value);
    const expected = new URL("/api/auth/google/callback", frontendUrl);
    if (
      callback.origin !== expected.origin ||
      callback.pathname !== expected.pathname ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      (process.env.NODE_ENV === "production" && callback.protocol !== "https:")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function logGoogleOAuthFailure(stage: string, error: unknown) {
  const diagnostic = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError" };
  console.error("Google OAuth failed.", { stage, ...diagnostic });
}

function logGoogleOAuthConfigurationFailure(
  stage: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
  callbackUrl: string | undefined
) {
  console.error("Google OAuth configuration is incomplete or inconsistent.", {
    stage,
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    callbackConfigured: Boolean(callbackUrl),
    callbackMatchesFrontend: Boolean(callbackUrl && configuredGoogleCallback(callbackUrl)),
  });
}

router.post("/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const termsAccepted = req.body?.termsAccepted === true;
    const privacyAccepted = req.body?.privacyAccepted === true;

    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        error: "You must accept the Terms of Service and Privacy Policy.",
      });
    }

    if (!email || !username || !password) {
      return res.status(400).json({
        error: "Email, username and password are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        error: "Enter a valid email address.",
      });
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-24 letters, numbers, or underscores.",
      });
    }

    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and no more than 72 bytes.",
      });
    }

    const existingEmail = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);

    if (existingEmail) {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    const existingUsername = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username);

    if (existingUsername) {
      return res.status(409).json({
        error: "That username is already taken.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `
        INSERT INTO users (
          email,
          username,
          password_hash,
          plan,
          role,
          created_at,
          updated_at,
          terms_accepted_at,
          privacy_accepted_at
        )
        VALUES (?, ?, ?, 'free', 'user', ?, ?, ?, ?)
        `
      )
      .run(email, username, passwordHash, now, now, now, now);

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(result.lastInsertRowid) as UserRecord;

    const token = createToken(user);

    setSessionCookie(res, token);

    return res.status(201).json({
      success: true,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      error: "Unable to create account.",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    const remoteHash = crypto
      .createHmac("sha256", jwtSecret)
      .update(req.ip || "unknown")
      .digest("hex");
    const now = new Date();
    const security = db.prepare(`
      SELECT automation_enabled, login_failure_threshold, login_lockout_minutes
      FROM security_settings WHERE id = 1
    `).get() as {
      automation_enabled: number;
      login_failure_threshold: number;
      login_lockout_minutes: number;
    } | undefined;
    const attempts = db.prepare(`
      SELECT failure_count, window_started_at, blocked_until
      FROM login_attempts WHERE remote_hash = ?
    `).get(remoteHash) as {
      failure_count: number;
      window_started_at: string;
      blocked_until: string | null;
    } | undefined;
    if (
      security?.automation_enabled &&
      attempts?.blocked_until &&
      attempts.blocked_until > now.toISOString()
    ) {
      return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
    }

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as UserRecord | undefined;

    const validPassword = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(
          password,
          "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
        );

    if (!user || !validPassword) {
      const threshold = security?.login_failure_threshold ?? 10;
      const lockoutMinutes = security?.login_lockout_minutes ?? 15;
      const withinWindow = attempts &&
        now.getTime() - new Date(attempts.window_started_at).getTime() < 15 * 60_000;
      const failures = withinWindow ? attempts.failure_count + 1 : 1;
      const blockedUntil = security?.automation_enabled && failures >= threshold
        ? new Date(now.getTime() + lockoutMinutes * 60_000).toISOString()
        : null;
      db.prepare(`
        INSERT INTO login_attempts (remote_hash, failure_count, window_started_at, blocked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(remote_hash) DO UPDATE SET
          failure_count = excluded.failure_count,
          window_started_at = CASE
            WHEN login_attempts.window_started_at <= ? THEN excluded.window_started_at
            ELSE login_attempts.window_started_at
          END,
          blocked_until = excluded.blocked_until
      `).run(
        remoteHash,
        failures,
        withinWindow ? attempts.window_started_at : now.toISOString(),
        blockedUntil,
        new Date(now.getTime() - 15 * 60_000).toISOString()
      );
      if (blockedUntil) {
        const incident = db.prepare(`
          INSERT INTO security_incidents
            (incident_type, evidence_ref, action_taken, created_at)
          VALUES ('repeated_login_failures', ?, 'temporary_ip_rate_limit', ?)
        `).run(`login-attempt-hash:${remoteHash.slice(0, 16)}`, now.toISOString());
        recordAudit("security.login_rate_limited", null, null, {
          incidentId: Number(incident.lastInsertRowid),
          threshold,
          lockoutMinutes,
        });
      }
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    db.prepare("DELETE FROM login_attempts WHERE remote_hash = ?").run(remoteHash);
    const token = createToken(user);

    setSessionCookie(res, token);

    return res.json({
      success: true,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      error: "Unable to log in.",
    });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("astrix_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res.json({
    success: true,
  });
});

router.get("/me", (req, res) => {
  const token = req.cookies?.astrix_session;

  if (!token) {
    return res.status(401).json({
      authenticated: false,
    });
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as {
      userId: number;
    };

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(payload.userId) as UserRecord | undefined;

    if (!user) {
      return res.status(401).json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      user: publicUser(user),
    });
  } catch {
    return res.status(401).json({
      authenticated: false,
    });
  }
});


/* ---------------- GOOGLE LOGIN ---------------- */

router.get("/google", (_req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL;

    if (
      !clientId ||
      !clientSecret ||
      !callbackUrl ||
      !configuredGoogleCallback(callbackUrl)
    ) {
      logGoogleOAuthConfigurationFailure("initialization", clientId, clientSecret, callbackUrl);
      return res.redirect(frontendRedirect("/login?error=google_not_configured"));
    }

    const state = crypto.randomBytes(32).toString("hex");

    res.cookie("google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/api/auth/google",
    });

    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", clientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);
    googleUrl.searchParams.set("access_type", "online");
    googleUrl.searchParams.set("prompt", "select_account");

    return res.redirect(googleUrl.toString());
  } catch (error) {
    logGoogleOAuthFailure("initialization", error);
    return res.redirect(frontendRedirect("/login?error=google_login_failed"));
  }
});

/* ---------------- GOOGLE CALLBACK ---------------- */

router.get("/google/callback", async (req, res) => {
  let stage = "validate_callback";
  try {
    const { code, state, error } = req.query;

    if (error) {
      res.clearCookie("google_oauth_state", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/google",
      });
      return res.redirect(frontendRedirect("/login?error=google_cancelled"));
    }

    const savedState = req.cookies?.google_oauth_state;

    if (
      !state ||
      !savedState ||
      String(state) !== String(savedState)
    ) {
      return res.redirect(frontendRedirect("/login?error=invalid_oauth_state"));
    }

    res.clearCookie("google_oauth_state", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/google",
    });

    if (!code) {
      return res.redirect(frontendRedirect("/login?error=missing_google_code"));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL;

    if (
      !clientId ||
      !clientSecret ||
      !callbackUrl ||
      !configuredGoogleCallback(callbackUrl)
    ) {
      logGoogleOAuthConfigurationFailure("callback", clientId, clientSecret, callbackUrl);
      return res.redirect(frontendRedirect("/login?error=google_not_configured"));
    }

    stage = "exchange_code";
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code: String(code),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenResponse.ok) {
      console.error("Google OAuth token exchange was rejected.", {
        status: tokenResponse.status,
      });
      return res.redirect(frontendRedirect("/login?error=google_token_exchange"));
    }

    stage = "parse_token_response";
    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
    };
    if (!tokenData.access_token) {
      console.error("Google OAuth token response did not contain an access token.");
      return res.redirect(frontendRedirect("/login?error=google_token_exchange"));
    }

    stage = "fetch_user_info";
    const userInfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      console.error("Google OAuth user-info request was rejected.", {
        status: userInfoResponse.status,
      });
      return res.redirect(frontendRedirect("/login?error=google_userinfo"));
    }

    stage = "parse_user_info";
    const googleUser = (await userInfoResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!googleUser.sub || !googleUser.email || !googleUser.email_verified) {
      console.error("Google OAuth user-info response was missing a verified account identity.");
      return res.redirect(frontendRedirect("/login?error=google_account_invalid"));
    }

    stage = "load_or_link_account";
    let user = db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .get(String(googleUser.sub)) as UserRecord | undefined;

    if (!user) {
      user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(String(googleUser.email).toLowerCase()) as UserRecord | undefined;

      if (user) {
        db.prepare(
          "UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?"
        ).run(
          String(googleUser.sub),
          new Date().toISOString(),
          user.id
        );
      }
    }

    if (!user) {
      stage = "create_account";
      const baseUsername =
        String(
          googleUser.name ||
          googleUser.email.split("@")[0] ||
          "user"
        )
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .slice(0, 20) || "user";

      let username = baseUsername;
      let counter = 1;

      while (
        db
          .prepare("SELECT id FROM users WHERE username = ?")
          .get(username)
      ) {
        username = `${baseUsername}${counter++}`;
      }

      const randomPassword = crypto
        .randomBytes(32)
        .toString("hex");

      const passwordHash = await bcrypt.hash(randomPassword, 12);
      const now = new Date().toISOString();

      const result = db
        .prepare(
          `
          INSERT INTO users (
            email,
            username,
            password_hash,
            google_id,
            plan,
            role,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'free', 'user', ?, ?)
          `
        )
        .run(
          String(googleUser.email).toLowerCase(),
          username,
          passwordHash,
          String(googleUser.sub),
          now,
          now
        );

      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as UserRecord;
    }

    stage = "create_session";
    const token = createToken(user);
    setSessionCookie(res, token);

    stage = "redirect_to_frontend";
    return res.redirect(frontendRedirect("/dashboard"));
  } catch (error) {
    logGoogleOAuthFailure(stage, error);
    return res.redirect(frontendRedirect("/login?error=google_login_failed"));
  }
});
export default router;
