import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apps, users, payments } from "../db/schema.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { getAccountDiskUsageMb } from "../services/cpanel.js";

const router = Router();
router.use(requireAuth);

/** GET /api/overview — everything the Overview screen needs in one call */
router.get("/overview", async (req: AuthedRequest, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.userId!) });
  if (!user) return res.status(404).json({ error: "User not found" });

  const userApps = await db.query.apps.findMany({ where: eq(apps.userId, user.id) });

  let storageUsedMb = 0;
  try {
    storageUsedMb = await getAccountDiskUsageMb();
  } catch {
    // fall back to 0 if cPanel Quota API is temporarily unavailable
  }

  res.json({
    fullName: user.fullName,
    apps: { used: userApps.length, limit: user.appLimit },
    storage: { usedMb: storageUsedMb, limitMb: user.storageLimitMb },
    recentApps: userApps.slice(0, 5),
  });
});

/** GET /api/billing — Billing & plan screen */
router.get("/billing", async (req: AuthedRequest, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.userId!) });
  if (!user) return res.status(404).json({ error: "User not found" });

  const userApps = await db.query.apps.findMany({ where: eq(apps.userId, user.id) });
  let storageUsedMb = 0;
  try {
    storageUsedMb = await getAccountDiskUsageMb();
  } catch {
    // ignore
  }

  const history = await db.query.payments.findMany({
    where: eq(payments.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.paidAt)],
  });

  res.json({
    plan: user.plan,
    appLimit: user.appLimit,
    storageLimitMb: user.storageLimitMb,
    appsUsed: userApps.length,
    storageUsedMb,
    renewsAt: user.planRenewsAt,
    paymentHistory: history,
  });
});

/** GET /api/account — Account settings screen */
router.get("/account", async (req: AuthedRequest, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.userId!) });
  if (!user) return res.status(404).json({ error: "User not found" });
  const { passwordHash, ...safe } = user;
  res.json(safe);
});

export default router;
