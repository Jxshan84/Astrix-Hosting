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
    {
      expiresIn: "7d",
    }
  );
}

function publicUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    discordId: user.discord_id ?? null,
    plan: user.plan,
    role: user.role,
    createdAt: user.created_at,
  };
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

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters.",
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
          updated_at
        )
        VALUES (?, ?, ?, 'free', 'user', ?, ?)
        `
      )
      .run(email, username, passwordHash, now, now, now, now);

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(result.lastInsertRowid);

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

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as any;

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

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
    secure: true,
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
      .get(payload.userId) as any;

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

router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    return res.status(503).json({
      error: "Google login is not configured.",
    });
  }

  const state = crypto.randomBytes(32).toString("hex");

  res.cookie("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/google",
  });

  const googleUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth"
  );

  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", callbackUrl);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("access_type", "online");
  googleUrl.searchParams.set("prompt", "select_account");

  return res.redirect(googleUrl.toString());
});

/* ---------------- GOOGLE CALLBACK ---------------- */

router.get("/google/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect("/login?error=google_cancelled");
    }

    const savedState = req.cookies?.google_oauth_state;

    if (
      !state ||
      !savedState ||
      String(state) !== String(savedState)
    ) {
      return res.redirect("/login?error=invalid_oauth_state");
    }

    res.clearCookie("google_oauth_state", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/google",
    });

    if (!code) {
      return res.redirect("/login?error=missing_google_code");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      return res.redirect("/login?error=google_not_configured");
    }

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
      console.error(
        "Google token exchange failed:",
        await tokenResponse.text()
      );

      return res.redirect("/login?error=google_token_exchange");
    }

    const tokenData = await tokenResponse.json();

    const userInfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      return res.redirect("/login?error=google_userinfo");
    }

    const googleUser = await userInfoResponse.json();

    if (!googleUser.sub || !googleUser.email) {
      return res.redirect("/login?error=google_account_invalid");
    }

    let user = db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .get(String(googleUser.sub)) as any;

    if (!user) {
      user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(String(googleUser.email).toLowerCase()) as any;

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
        .get(result.lastInsertRowid) as any;
    }

    const token = createToken(user);
    setSessionCookie(res, token);

    return res.redirect("/dashboard");
  } catch (error) {
    console.error("Google OAuth error:", error);
    return res.redirect("/login?error=google_login_failed");
  }
});
export default router;
