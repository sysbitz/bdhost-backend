import { Router } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { apps } from "../db/schema.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { listAppFiles, uploadAppFile, deleteAppFile } from "../services/cpanel.js";

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function getOwnedApp(userId: number, appId: number) {
  return db.query.apps.findFirst({
    where: and(eq(apps.id, appId), eq(apps.userId, userId)),
  });
}

/** GET /api/apps/:appId/files?path=sub/folder — File manager listing screen */
router.get("/:appId/files", async (req: AuthedRequest, res) => {
  const app = await getOwnedApp(req.userId!, Number(req.params.appId));
  if (!app) return res.status(404).json({ error: "App not found" });

  const subPath = (req.query.path as string) ?? "";
  const files = await listAppFiles(app.slug, subPath);
  res.json({ path: subPath, files, landingFile: app.landingFile });
});

/** POST /api/apps/:appId/files/upload?path=sub/folder — "Upload files" button */
router.post(
  "/:appId/files/upload",
  upload.array("files", 20),
  async (req: AuthedRequest, res) => {
    const app = await getOwnedApp(req.userId!, Number(req.params.appId));
    if (!app) return res.status(404).json({ error: "App not found" });

    const subPath = (req.query.path as string) ?? "";
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "No files provided" });

    for (const f of files) {
      await uploadAppFile(app.slug, f.buffer, f.originalname, subPath);
    }
    res.status(201).json({ uploaded: files.map((f) => f.originalname) });
  }
);

/** DELETE /api/apps/:appId/files?path=relative/path — trash icon in File manager */
router.delete("/:appId/files", async (req: AuthedRequest, res) => {
  const app = await getOwnedApp(req.userId!, Number(req.params.appId));
  if (!app) return res.status(404).json({ error: "App not found" });

  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: "path query param required" });

  await deleteAppFile(app.slug, relPath);
  res.json({ ok: true });
});

export default router;
