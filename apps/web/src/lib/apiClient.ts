/**
 * Thin HTTP client for apps/api. The hall does not call this.
 * The local mock store in ./store.ts stays the default.
 * Opt in with VITE_USE_API=1; Vite proxies /api to http://127.0.0.1:3000.
 */
import {
  ERROR_CODES,
  errorCodeForStatus,
  type ApiErrorBody,
  type AuthResponse,
  type ErrorCode,
  type PublicUser,
  type TaskListResponse,
} from '@idlebot/contract'

export const useRemoteApi = import.meta.env.VITE_USE_API === '1'

export class ApiClientError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error || fallback)
    this.name = 'ApiClientError'
    this.status = status
    this.code = body?.code ?? errorCodeForStatus(status)
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
  return (await res.json()) as T
}

/** Unused unless a caller checks `useRemoteApi` and invokes these methods. */
export const remoteApi = {
  enabled: useRemoteApi,
  me: () => request<PublicUser>('/api/me'),
  tasks: () => request<TaskListResponse>('/api/tasks'),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
}
