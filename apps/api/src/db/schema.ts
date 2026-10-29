import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
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
    walletAddress: text("wallet_address"),
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
    /** USDC base units (6 decimals). 0 = free task. */
    bountyAmount: bigint("bounty_amount", { mode: "number" }).notNull().default(0),
    payerAddress: text("payer_address"),
    payoutAddress: text("payout_address"),
    payoutStatus: text("payout_status").notNull().default("none"),
    rejectCount: integer("reject_count").notNull().default(0),
    rejectReason: text("reject_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "task_status_allowed",
      sql`${table.status} in ('open', 'in_progress', 'pending_review', 'completed', 'cancelled')`,
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

/** One row per on-chain money movement. Unique (task_id, kind) makes payout and refund exactly-once. */
export const bountyLedger = pgTable(
  "bounty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    kind: text("kind").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    txHash: text("tx_hash"),
    status: text("status").notNull().default("pending"),
    mock: boolean("mock").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("bounty_ledger_kind_check", sql`${table.kind} in ('payment', 'payout', 'refund')`),
    uniqueIndex("bounty_ledger_task_kind_idx").on(table.taskId, table.kind),
    uniqueIndex("bounty_ledger_tx_idx").on(table.txHash).where(sql`${table.txHash} is not null`),
  ],
);

export type LedgerRow = typeof bountyLedger.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type TaskRow = typeof task.$inferSelect;
export type RelayLogRow = typeof relayLog.$inferSelect;
