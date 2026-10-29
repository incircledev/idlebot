import { confirmEmail } from "@/lib/auth-session";

export async function GET(request: Request) {
  return confirmEmail(request);
}
