import { json } from "@/lib/http";

export async function GET(request: Request) {
  return json(
    {
      ok: true,
      relay: process.env.RELAY_MODE ?? "mock",
      taskStatus: ["open", "in_progress", "completed"],
    },
    200,
    request,
  );
}
