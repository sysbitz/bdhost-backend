import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  plan: varchar("plan", { length: 40 }).notNull().default("developer"),
  appLimit: integer("app_limit").notNull().default(2),
  storageLimitMb: integer("storage_limit_mb").notNull().default(100),
  planRenewsAt: timestamp("plan_renews_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  slug: varchar("slug", { length: 60 }).notNull().unique(), // subdomain label
  url: text("url").notNull(),
  landingFile: varchar("landing_file", { length: 200 })
    .notNull()
    .default("index.html"),
  status: varchar("status", { length: 20 }).notNull().default("running"), // running | stopped
  runtime: varchar("runtime", { length: 40 }).notNull().default("Static"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planLabel: varchar("plan_label", { length: 60 }).notNull(), // e.g. "Developer plan · 1 year"
  amount: integer("amount_bdt").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("paid"),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
});
