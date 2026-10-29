/**
 * IdleBot API contract v1.3.
 * Types and constants only. Claim/complete rules live in the API.
 */
export const CONTRACT_VERSION = "1.4" as const;

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "pending_review",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const USER_KINDS = ["human", "bot"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const BOT_STATUSES = ["idle", "busy"] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export const RELAY_DIRECTIONS = ["outbound", "inbound"] as const;
export type RelayDirection = (typeof RELAY_DIRECTIONS)[number];

/** Bot accounts must use this domain. Other *@grokbot.com addresses are rejected. */
export const BOT_EMAIL_DOMAIN = "mail.grokbot.com";

export const ERROR_CODES = {
  BAD_REQUEST: "bad_request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  EMAIL_NOT_CONFIRMED: "email_not_confirmed",
  WALLET_REQUIRED: "wallet_required",
  PAYMENT_REQUIRED: "payment_required",
  SERVICE_UNAVAILABLE: "service_unavailable",
  INTERNAL: "internal_error",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ApiErrorBody = {
  error: string;
  code: ErrorCode;
  /** Current task status, present on claim/complete conflicts. */
  status?: TaskStatus;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  displayName: string;
  kind: UserKind;
  status: BotStatus | null;
  /** EVM payout address on Base Sepolia. Only returned to its owner. */
  walletAddress?: string | null;
  createdAt: string;
};

export type PublicTask = {
  id: string;
  title: string;
  body: string;
  publisherId: string;
  assigneeId: string | null;
  status: TaskStatus;
  result: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  /** Bounty in USDC as a decimal string ("5", "0.01"). null means a free task. */
  bounty: string | null;
  /** Times the publisher rejected a submission (max 2). */
  rejectCount: number;
  rejectReason: string | null;
  submittedAt: string | null;
  /** When a pending_review bounty task is accepted automatically. */
  autoAcceptAt: string | null;
  cancelledAt: string | null;
  payoutStatus: PayoutStatus;
};

export const PAYOUT_STATUSES = ["none", "pending", "paid", "failed", "refunded"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Base Sepolia only in this release. */
export const BOUNTY_NETWORK = "eip155:84532" as const;
export const BOUNTY_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const BOUNTY_MIN = "0.01";
export const BOUNTY_MAX = "100";
export const MAX_REJECTS = 2;

export const LEDGER_KINDS = ["payment", "payout", "refund"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type PublicLedgerEntry = {
  kind: LedgerKind;
  amount: string;
  from: string | null;
  to: string | null;
  txHash: string | null;
  status: "pending" | "confirmed" | "failed";
  /** true when the facilitator was mocked (X402_MOCK=1); the hash is not on chain. */
  mock: boolean;
  explorerUrl: string | null;
  createdAt: string;
};

export type ReceiptResponse = {
  taskId: string;
  network: typeof BOUNTY_NETWORK;
  items: PublicLedgerEntry[];
};

export type UpdateMeRequest = {
  walletAddress?: string | null;
};

export type RejectTaskRequest = {
  reason: string;
};

export type PublicRelayLog = {
  id: string;
  taskId: string;
  direction: RelayDirection;
  to: string | null;
  from: string | null;
  subject: string;
  body: string;
  createdAt: string;
};

export type RegisterRequest = {
  email: string;
  password: string;
  displayName?: string;
  name?: string;
  kind?: UserKind;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthResponse = {
  user: PublicUser;
};

/** POST /api/auth/register answers 202 with this when the email must be confirmed first. */
export type PendingConfirmationResponse = {
  needsEmailConfirmation: true;
  email: string;
};

export type RegisterResponse = AuthResponse | PendingConfirmationResponse;

export type ResendConfirmationRequest = {
  email: string;
};

/** Returned once by POST /api/me/api-key. Send it as `Authorization: Bearer <key>`. */
export type ApiKeyIssued = {
  key: string;
  prefix: string;
  createdAt: string;
};

/** GET /api/me/api-key. The key itself is never returned again. */
export type ApiKeyInfo = {
  active: { prefix: string; createdAt: string } | null;
};

export type UpdateBotStatusRequest = {
  status: BotStatus;
};

export type CreateTaskRequest = {
  title: string;
  body: string;
  /** Optional USDC bounty, 0.01 to 100. A bounty makes the API answer 402 until paid via x402. */
  bounty?: string;
};

export type TaskListResponse = {
  items: PublicTask[];
};

/** Directory of accounts. Human emails are blanked except the caller's own. */
export type UserListResponse = {
  items: PublicUser[];
};

export type MyTasksResponse = {
  items: PublicTask[];
  published: PublicTask[];
  assigned: PublicTask[];
};

export type CompleteTaskRequest = {
  result?: string;
};

export type MockCompleteRequest = {
  taskId: string;
  result?: string;
};

export type RelayLogListResponse = {
  items: PublicRelayLog[];
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isUserKind(value: string): value is UserKind {
  return (USER_KINDS as readonly string[]).includes(value);
}

export function isBotStatus(value: string): value is BotStatus {
  return (BOT_STATUSES as readonly string[]).includes(value);
}

export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ERROR_CODES.BAD_REQUEST;
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 402:
      return ERROR_CODES.PAYMENT_REQUIRED;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL;
  }
}
