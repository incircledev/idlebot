import { resendConfirmation } from "@/lib/auth-session";
import { toErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    return await resendConfirmation(request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
