import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import {
	requireAuth,
	signToken,
	type AuthedRequest,
} from "../middleware/auth.js";

const router = Router();

// Frontend and backend are on different domains in production (e.g. Vercel
// front + Render back), so the auth cookie needs SameSite=None; Secure or
// the browser silently drops it and every request looks logged-out.
const isCrossSite = process.env.NODE_ENV === "production";

const registerSchema = z.object({
	fullName: z.string().min(2).max(120),
	email: z.string().email(),
	password: z.string().min(8),
});

router.post("/register", async (req, res) => {
	const parsed = registerSchema.safeParse(req.body);
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.flatten() });
	}
	const { fullName, email, password } = parsed.data;

	const existing = await db.query.users.findFirst({
		where: eq(users.email, email),
	});
	if (existing) {
		return res.status(409).json({ error: "Email already registered" });
	}

	const passwordHash = await bcrypt.hash(password, 10);
	const [user] = await db
		.insert(users)
		.values({ fullName, email, passwordHash })
		.returning();

	const token = signToken(user.id);
	res.cookie("token", token, {
		httpOnly: true,
		sameSite: isCrossSite ? "none" : "lax",
		secure: isCrossSite,
		maxAge: 30 * 24 * 3600 * 1000,
	});
	res.json({ id: user.id, fullName: user.fullName, email: user.email });
});

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

router.post("/login", async (req, res) => {
	const parsed = loginSchema.safeParse(req.body);
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.flatten() });
	}
	const { email, password } = parsed.data;

	const user = await db.query.users.findFirst({
		where: eq(users.email, email),
	});
	if (!user) {
		return res.status(401).json({ error: "Invalid email or password" });
	}
	const ok = await bcrypt.compare(password, user.passwordHash);
	if (!ok) {
		return res.status(401).json({ error: "Invalid email or password" });
	}

	const token = signToken(user.id);
	res.cookie("token", token, {
		httpOnly: true,
		sameSite: isCrossSite ? "none" : "lax",
		secure: isCrossSite,
		maxAge: 30 * 24 * 3600 * 1000,
	});
	res.json({ id: user.id, fullName: user.fullName, email: user.email });
});

router.post("/logout", (_req, res) => {
	res.clearCookie("token");
	res.json({ ok: true });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
	const user = await db.query.users.findFirst({
		where: eq(users.id, req.userId!),
	});
	if (!user) return res.status(404).json({ error: "User not found" });
	const { passwordHash, ...safe } = user;
	res.json(safe);
});

export default router;
