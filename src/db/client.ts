import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}
const usingPooler = connectionString.includes(":6543");

const client = postgres(connectionString, {
  ssl: "require",
  prepare: !usingPooler,
});

export const db = drizzle(client, { schema });