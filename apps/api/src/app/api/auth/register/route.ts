import { registerWithPassword } from "@/lib/auth-session";
import { toErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    return await registerWithPassword(request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
