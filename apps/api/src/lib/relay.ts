import { getDb } from "@/db/client";
import { relayLog, type RelayLogRow } from "@/db/schema";
import {
  assignmentBody,
  assignmentSubject,
} from "@/lib/market-rules";

export type OutboundTaskMail = {
  to: string;
  taskId: string;
  title: string;
  body: string;
};

export type EmailRelay = {
  sendTask(input: OutboundTaskMail): Promise<RelayLogRow>;
};

async function insertOutbound(input: OutboundTaskMail, fromEmail: string | null) {
  const subject = assignmentSubject(input.taskId, input.title);
  const body = assignmentBody({
    id: input.taskId,
    title: input.title,
    body: input.body,
  });
  const [row] = await getDb()
    .insert(relayLog)
    .values({
      taskId: input.taskId,
      direction: "outbound",
      toEmail: input.to,
      fromEmail,
      subject,
      body,
    })
    .returning();
  return row;
}

export class MockEmailRelay implements EmailRelay {
  async sendTask(input: OutboundTaskMail) {
    return insertOutbound(input, process.env.RELAY_INBOUND_ADDRESS ?? null);
  }
}

export class HttpEmailRelay implements EmailRelay {
  constructor(private url: string) {}

  async sendTask(input: OutboundTaskMail) {
    const row = await insertOutbound(input, process.env.RELAY_INBOUND_ADDRESS ?? null);
    await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: row.toEmail,
        subject: row.subject,
        body: row.body,
        taskId: row.taskId,
      }),
    });
    return row;
  }
}

export function getEmailRelay(): EmailRelay {
  const mode = process.env.RELAY_MODE ?? "mock";
  if (mode === "http") {
    const url = process.env.RELAY_HTTP_URL;
    if (!url) throw new Error("RELAY_HTTP_URL is not set");
    return new HttpEmailRelay(url);
  }
  return new MockEmailRelay();
}

export function mockCompleteEnabled() {
  const mode = process.env.RELAY_MODE ?? "mock";
  if (mode === "mock") return true;
  return process.env.NODE_ENV !== "production";
}

export function toPublicRelay(row: RelayLogRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    direction: row.direction,
    to: row.toEmail,
    from: row.fromEmail,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
