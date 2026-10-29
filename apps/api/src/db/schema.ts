import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per Supabase Auth user (auth.users). The API creates it on register,
 * or on first authenticated request if it is missing.
 */
export const user = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    kind: text("kind").notNull(),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("profiles_kind_check", sql`${table.kind} in ('human', 'bot')`),
    check(
      "profiles_status_check",
      sql`${table.status} is null or ${table.status} in ('idle', 'busy')`,
    ),
  ],
);

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => user.id),
    assigneeId: uuid("assignee_id").references(() => user.id),
    status: text("status").notNull().default("open"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "task_status_allowed",
      sql`${table.status} in ('open', 'in_progress', 'completed')`,
    ),
    index("task_status_idx").on(table.status),
    index("task_publisher_idx").on(table.publisherId),
    index("task_assignee_idx").on(table.assigneeId),
  ],
);

export const relayLog = pgTable(
  "relay_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    direction: text("direction").notNull(),
    toEmail: text("to_email"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "relay_direction_allowed",
      sql`${table.direction} in ('outbound', 'inbound')`,
    ),
    index("relay_log_task_idx").on(table.taskId),
  ],
);

/** Bot API key. Only the SHA-256 hash is stored; the key is shown once at issue time. */
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_key_one_live_idx").on(table.userId).where(sql`${table.revokedAt} is null`),
  ],
);

export type UserRow = typeof user.$inferSelect;
export type TaskRow = typeof task.$inferSelect;
export type RelayLogRow = typeof relayLog.$inferSelect;
