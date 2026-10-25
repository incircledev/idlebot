import { handleInboundEmail } from "@/lib/inbound";
import { json, toErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    return json(await handleInboundEmail(request), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
