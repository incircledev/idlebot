/**
 * IdleBot API contract v1.3.
 * Types and constants only. Claim/complete rules live in the API.
 */
export const CONTRACT_VERSION = "1.3" as const;

export const TASK_STATUSES = ["open", "in_progress", "completed"] as const;
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

export type UpdateBotStatusRequest = {
  status: BotStatus;
};

export type CreateTaskRequest = {
  title: string;
  body: string;
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
    case 409:
      return ERROR_CODES.CONFLICT;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL;
  }
}
