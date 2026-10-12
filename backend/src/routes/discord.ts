import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db } from "../db/database.js";

const router = Router();

const jwtSecret = process.env.JWT_SECRET;
const FRONTEND_URL = (
  process.env.FRONTEND_URL ||
  "https://astrix-hosting-ebpy.vercel.app"
).replace(/\/+$/, "");

function frontendRedirect(path: string): string {
  return `${FRONTEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function createToken(user: any): string {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }

  return jwt.sign(
    { userId: user.id, role: user.role, plan: user.plan },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie("astrix_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const parsed = req.cookies?.[name];
  if (typeof parsed === "string") return parsed;

  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;

    if (item.slice(0, index).trim() === name) {
      const value = item.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return undefined;
}

function clearStateCookie(res: Response): void {
  res.clearCookie("discord_oauth_state", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

router.get("/discord", (_req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const callbackUrl = process.env.DISCORD_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    return res.redirect(
      frontendRedirect("/login?error=discord_not_configured")
    );
  }

  const state = crypto.randomBytes(32).toString("hex");

  res.cookie("discord_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email guilds.join");
  url.searchParams.set("state", state);

  return res.redirect(url.toString());
});

router.get("/discord/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      clearStateCookie(res);
      return res.redirect(
        frontendRedirect("/login?error=discord_cancelled")
      );
    }

    const savedState = readCookie(req, "discord_oauth_state");

    if (
      typeof state !== "string" ||
      typeof savedState !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !/^[a-f0-9]{64}$/.test(savedState) ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(savedState))
    ) {
      clearStateCookie(res);
      return res.redirect(
        frontendRedirect("/login?error=invalid_discord_state")
      );
    }

    clearStateCookie(res);

    if (typeof code !== "string" || !code) {
      return res.redirect(
        frontendRedirect("/login?error=discord_missing_code")
      );
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      return res.redirect(
        frontendRedirect("/login?error=discord_not_configured")
      );
    }

    const tokenResponse = await fetch(
      "https://discord.com/api/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
        }),
      }
    );

    if (!tokenResponse.ok) {
      console.error("Discord token exchange failed:", tokenResponse.status);
      return res.redirect(
        frontendRedirect("/login?error=discord_token_failed")
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
    };

    const userResponse = await fetch(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userResponse.ok) {
      console.error("Discord user request failed:", userResponse.status);
      return res.redirect(
        frontendRedirect("/login?error=discord_user_failed")
      );
    }

    const discordUser = (await userResponse.json()) as {
      id: string;
      username: string;
      global_name: string | null;
      email: string | null;
    };

    if (!discordUser.email) {
      return res.redirect(
        frontendRedirect("/login?error=discord_email_required")
      );
    }

    const email = discordUser.email.toLowerCase();

    let user = db
      .prepare("SELECT * FROM users WHERE discord_id = ?")
      .get(discordUser.id) as any;

    if (!user) {
      user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(email) as any;

      if (user) {
        db.prepare(
          "UPDATE users SET discord_id = ?, updated_at = ? WHERE id = ?"
        ).run(discordUser.id, new Date().toISOString(), user.id);

        user = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(user.id) as any;
      }
    }

    if (!user) {
      const baseUsername =
        (discordUser.global_name || discordUser.username || "discord-user")
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .slice(0, 20) || "discorduser";

      let username = baseUsername;
      let counter = 1;

      while (
        db.prepare("SELECT id FROM users WHERE username = ?").get(username)
      ) {
        username = `${baseUsername}${counter++}`;
      }

      const passwordHash = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        12
      );
      const now = new Date().toISOString();

      const result = db.prepare(`
        INSERT INTO users (
          email, username, password_hash, discord_id,
          plan, role, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'free', 'user', ?, ?)
      `).run(email, username, passwordHash, discordUser.id, now, now);

      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as any;
    }

    if (!user) {
      return res.redirect(
        frontendRedirect("/login?error=discord_user_creation_failed")
      );
    }

    setSessionCookie(res, createToken(user));
    return res.redirect(frontendRedirect("/dashboard"));
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return res.redirect(
      frontendRedirect("/login?error=discord_login_failed")
    );
  }
});

export default router;
