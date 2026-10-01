import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db } from "../db/database.js";

const router = Router();

const jwtSecret = process.env.JWT_SECRET || "development-secret";

function createToken(user: any) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      plan: user.plan,
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function setSessionCookie(res: any, token: string) {
  res.cookie("astrix_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

router.get("/discord", (_req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const callbackUrl = process.env.DISCORD_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    return res.status(500).json({
      error: "Discord login is not configured.",
    });
  }

  const state = crypto.randomBytes(32).toString("hex");

  res.cookie("discord_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/discord",
  });

  const discordUrl = new URL("https://discord.com/oauth2/authorize");

  discordUrl.searchParams.set("client_id", clientId);
  discordUrl.searchParams.set("redirect_uri", callbackUrl);
  discordUrl.searchParams.set("response_type", "code");
  discordUrl.searchParams.set("scope", "identify email guilds.join");
  discordUrl.searchParams.set("state", state);

  return res.redirect(discordUrl.toString());
});

router.get("/discord/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect("/login?error=discord_cancelled");
    }

    const savedState = req.cookies?.discord_oauth_state;

    if (
      !state ||
      !savedState ||
      String(state) !== String(savedState)
    ) {
      return res.redirect("/login?error=invalid_discord_state");
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      return res.redirect("/login?error=discord_not_configured");
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
          code: String(code),
          redirect_uri: callbackUrl,
        }),
      }
    );

    if (!tokenResponse.ok) {
      throw new Error("Discord token request failed");
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
      throw new Error("Discord user request failed");
    }

    const discordUser = (await userResponse.json()) as {
      id: string;
      username: string;
      global_name: string | null;
      email: string | null;
    };

    if (!discordUser.email) {
      return res.redirect("/login?error=discord_email_required");
    }

    let user = db
      .prepare("SELECT * FROM users WHERE discord_id = ?")
      .get(discordUser.id) as any;

    if (!user) {
      user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(discordUser.email.toLowerCase()) as any;

      if (user) {
        db.prepare(
          "UPDATE users SET discord_id = ?, updated_at = ? WHERE id = ?"
        ).run(
          discordUser.id,
          new Date().toISOString(),
          user.id
        );
      }
    }

    if (!user) {
      const baseUsername =
        (discordUser.global_name ||
          discordUser.username ||
          "discord-user")
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .slice(0, 20) || "discorduser";

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
        .prepare(`
          INSERT INTO users (
            email,
            username,
            password_hash,
            discord_id,
            plan,
            role,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'free', 'user', ?, ?)
        `)
        .run(
          discordUser.email.toLowerCase(),
          username,
          passwordHash,
          discordUser.id,
          now,
          now
        );

      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as any;
    }

    const token = createToken(user);

    setSessionCookie(res, token);

    return res.redirect("/dashboard");
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return res.redirect("/login?error=discord_login_failed");
  }
});

export default router;
