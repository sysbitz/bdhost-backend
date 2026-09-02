import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
	throw new Error(
		"DATABASE_URL is not set. Add it to backend/.env (see render.yaml for the required vars).",
	);
}
const usingPooler = connectionString.includes(":6543");
const isLocalHost =
	connectionString.includes("localhost") ||
	connectionString.includes("127.0.0.1");

const client = postgres(connectionString, {
	ssl: isLocalHost ? false : "require",
	prepare: !usingPooler,
});

export const db = drizzle(client, { schema });
