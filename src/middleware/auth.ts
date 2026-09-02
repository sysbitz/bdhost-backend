import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
	throw new Error("JWT_SECRET is not set. Add it to backend/.env.");
}

export interface AuthedRequest extends Request {
	userId?: number;
}

export function requireAuth(
	req: AuthedRequest,
	res: Response,
	next: NextFunction,
) {
	const token = req.cookies?.token as string | undefined;
	if (!token) {
		return res.status(401).json({ error: "Not authenticated" });
	}
	try {
		const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
		req.userId = payload.userId;
		next();
	} catch {
		return res.status(401).json({ error: "Invalid or expired session" });
	}
}

export function signToken(userId: number): string {
	return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}
