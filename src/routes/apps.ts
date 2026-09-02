import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { apps, users } from "../db/schema.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import {
  createAppHosting,
  deleteAppHosting,
  slugifyAppName,
  listAppFiles,
} from "../services/cpanel.js";

const router = Router();
router.use(requireAuth);

/** GET /api/apps — list current user's apps (Overview + Applications list) */
router.get("/", async (req: AuthedRequest, res) => {
  const list = await db.query.apps.findMany({ where: eq(apps.userId, req.userId!) });
  res.json(list);
});

/** GET /api/apps/:id — single app detail (Applications detail screen) */
router.get("/:id", async (req: AuthedRequest, res) => {
  const app = await db.query.apps.findFirst({
    where: and(eq(apps.id, Number(req.params.id)), eq(apps.userId, req.userId!)),
  });
  if (!app) return res.status(404).json({ error: "App not found" });

  let fileCount = 0;
  try {
    const files = await listAppFiles(app.slug);
    fileCount = files.filter((f) => f.type === "file").length;
  } catch {
    // cPanel might be temporarily unreachable; don't fail the whole request
  }
  res.json({ ...app, fileCount });
});

const createSchema = z.object({ name: z.string().min(2).max(80) });

/** POST /api/apps — "Create app" (step 1 of Simple setup) */
router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await db.query.users.findFirst({ where: eq(users.id, req.userId!) });
  if (!user) return res.status(404).json({ error: "User not found" });

  const currentCount = (await db.query.apps.findMany({ where: eq(apps.userId, user.id) }))
    .length;
  if (currentCount >= user.appLimit) {
    return res.status(403).json({
      error: `Application limit reached (${user.appLimit}). Upgrade your plan to create more.`,
    });
  }

  const slug = `${slugifyAppName(parsed.data.name)}-${user.id}`;

  let url: string;
  try {
    ({ url } = await createAppHosting(slug));
  } catch (err) {
    console.error("[apps] createAppHosting failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(502).json({
      error: `Could not provision hosting on cPanel: ${detail}`,
    });
  }

  const [app] = await db
    .insert(apps)
    .values({ userId: user.id, name: parsed.data.name, slug, url })
    .returning();

  res.status(201).json(app);
});

const landingSchema = z.object({ landingFile: z.string().min(1).max(200) });

/** PATCH /api/apps/:id/landing — "Link landing page" (step 3 of Simple setup) */
router.patch("/:id/landing", async (req: AuthedRequest, res) => {
  const parsed = landingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const app = await db.query.apps.findFirst({
    where: and(eq(apps.id, Number(req.params.id)), eq(apps.userId, req.userId!)),
  });
  if (!app) return res.status(404).json({ error: "App not found" });

  const [updated] = await db
    .update(apps)
    .set({ landingFile: parsed.data.landingFile })
    .where(eq(apps.id, app.id))
    .returning();

  res.json(updated);
});

/** POST /api/apps/:id/restart — "Restart" button */
router.post("/:id/restart", async (req: AuthedRequest, res) => {
  const app = await db.query.apps.findFirst({
    where: and(eq(apps.id, Number(req.params.id)), eq(apps.userId, req.userId!)),
  });
  if (!app) return res.status(404).json({ error: "App not found" });
  // Static sites don't need a real restart; flip status for UI feedback.
  const [updated] = await db
    .update(apps)
    .set({ status: "running" })
    .where(eq(apps.id, app.id))
    .returning();
  res.json(updated);
});

/** DELETE /api/apps/:id */
router.delete("/:id", async (req: AuthedRequest, res) => {
  const app = await db.query.apps.findFirst({
    where: and(eq(apps.id, Number(req.params.id)), eq(apps.userId, req.userId!)),
  });
  if (!app) return res.status(404).json({ error: "App not found" });

  await deleteAppHosting(app.slug, true);
  await db.delete(apps).where(eq(apps.id, app.id));
  res.json({ ok: true });
});

export default router;