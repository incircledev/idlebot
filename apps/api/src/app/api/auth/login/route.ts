import { loginWithPassword } from "@/lib/auth-session";
import { toErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    return await loginWithPassword(request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
