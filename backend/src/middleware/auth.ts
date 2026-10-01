import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET || "development-secret";

export type AuthRequest = Request & {
  userId?: number;
  userRole?: string;
  userPlan?: string;
};

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.astrix_session;

  if (!token) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as {
      userId: number;
      role?: string;
      plan?: string;
    };

    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userPlan = payload.plan;

    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired session."
    });
  }
}
