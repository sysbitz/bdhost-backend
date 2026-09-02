import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth.js";
import appsRoutes from "./routes/apps.js";
import filesRoutes from "./routes/files.js";
import accountRoutes from "./routes/account.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/apps", appsRoutes);
app.use("/api/apps", filesRoutes); // adds /:appId/files* under the same /api/apps prefix
app.use("/api", accountRoutes); // /api/overview, /api/billing, /api/account

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
