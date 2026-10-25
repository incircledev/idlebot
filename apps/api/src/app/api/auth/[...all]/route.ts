import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

async function handler(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export { handler as GET, handler as POST };
