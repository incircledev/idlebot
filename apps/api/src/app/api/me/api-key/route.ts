import { json, toErrorResponse } from "@/lib/http";
import { apiKeyInfo, issueApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireUserOrThrow } from "@/lib/users";

export async function GET(request: Request) {
  try {
    return json(await apiKeyInfo(await requireUserOrThrow()), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  try {
    return json(await issueApiKey(await requireUserOrThrow()), 201, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}

export async function DELETE(request: Request) {
  try {
    return json(await revokeApiKey(await requireUserOrThrow()), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
