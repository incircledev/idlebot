/**
 * HTTP client for apps/api.
 * Dev keeps the local mock unless `VITE_USE_API=1`.
 * `vite build` calls same-origin `/api` unless `VITE_USE_API=0`.
 * Requests stay on relative `/api` URLs. The dev server proxies that prefix;
 * the production bundle does not.
 */
import {
  ERROR_CODES,
  errorCodeForStatus,
  type ApiErrorBody,
  type AuthResponse,
  type BotStatus,
  type CompleteTaskRequest,
  type CreateTaskRequest,
  type ErrorCode,
  type MockCompleteRequest,
  type MyTasksResponse,
  type PublicTask,
  type PublicUser,
  type RegisterRequest,
  type RegisterResponse,
  type RelayLogListResponse,
  type TaskListResponse,
  type TaskStatus,
  type UpdateBotStatusRequest,
  type UserListResponse,
} from '@idlebot/contract'

export const useRemoteApi =
  import.meta.env.VITE_USE_API === '1' ||
  (import.meta.env.PROD && import.meta.env.VITE_USE_API !== '0')

export class ApiClientError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly taskStatus?: TaskStatus

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error || fallback)
    this.name = 'ApiClientError'
    this.status = status
    this.code = body?.code ?? errorCodeForStatus(status)
    this.taskStatus = body?.status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  })
  if (!res.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      body = null
    }
    throw new ApiClientError(res.status, body, res.statusText || ERROR_CODES.INTERNAL)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiClientError(res.status, null, '响应不是 JSON')
  }
}

export type SignOutResponse = {
  success?: boolean
}

export const remoteApi = {
  enabled: useRemoteApi,
  me: () => request<PublicUser>('/api/me'),
  users: () => request<UserListResponse>('/api/users'),
  register: (body: RegisterRequest) =>
    request<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  resendConfirmation: (email: string) =>
    request<{ sent: boolean }>('/api/auth/resend', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  signOut: () =>
    request<SignOutResponse>('/api/auth/sign-out', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  tasks: (status?: TaskStatus) => {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<TaskListResponse>(`/api/tasks${query}`)
  },
  mine: () => request<MyTasksResponse>('/api/tasks/mine'),
  task: (id: string) => request<PublicTask>(`/api/tasks/${encodeURIComponent(id)}`),
  createTask: (body: CreateTaskRequest) =>
    request<PublicTask>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  claim: (id: string) =>
    request<PublicTask>(`/api/tasks/${encodeURIComponent(id)}/claim`, { method: 'POST' }),
  complete: (id: string, body: CompleteTaskRequest) =>
    request<PublicTask>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mockComplete: (body: MockCompleteRequest) =>
    request<PublicTask>('/api/relay/mock-complete', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateStatus: (status: BotStatus) =>
    request<PublicUser>('/api/me/status', {
      method: 'PATCH',
      body: JSON.stringify({ status } satisfies UpdateBotStatusRequest),
    }),
  relayLogs: (taskId: string) =>
    request<RelayLogListResponse>(`/api/relay/logs?taskId=${encodeURIComponent(taskId)}`),
}
