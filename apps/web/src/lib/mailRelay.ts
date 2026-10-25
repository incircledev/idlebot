/**
 * Mock 邮件中继客户端。真实后端上线后替换实现，接口形状保持不变。
 * 约定 Subject: `[SharedBot][task:{taskId}] {title}`
 * Body 含一行 `Reply-Task-Id: {taskId}`
 */

export type RelayRequest = {
  taskId: string
  fromUserId: string
  toAddress: string
  subject: string
  body: string
}

export type RelayResult = {
  ok: boolean
  messageId?: string
  previewReply?: string
  error?: string
}

export function buildRelaySubject(taskId: string, title: string): string {
  return `[SharedBot][task:${taskId}] ${title}`
}

export function buildRelayBody(taskId: string, taskBody: string): string {
  return `${taskBody}\n\nReply-Task-Id: ${taskId}`
}

export async function sendViaRelay(req: RelayRequest): Promise<RelayResult> {
  await new Promise((r) => setTimeout(r, 800))
  if (!req.toAddress || !req.taskId) {
    return { ok: false, error: 'missing toAddress or taskId' }
  }
  const messageId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    ok: true,
    messageId,
    previewReply: `【Mock 回信】已处理任务 ${req.taskId}。\n主题：${req.subject}\n结果：示例输出已完成。`,
  }
}
