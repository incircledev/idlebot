import { openApiDocument } from "@/lib/openapi";
import { json } from "@/lib/http";

export async function GET(request: Request) {
  return json(openApiDocument, 200, request);
}
