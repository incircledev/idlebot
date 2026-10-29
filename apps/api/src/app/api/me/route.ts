import { json, readJson, toErrorResponse } from "@/lib/http";
import { requireUserOrThrow, toSelfUser, updateMe } from "@/lib/users";

export async function GET(request: Request) {
  try {
    const row = await requireUserOrThrow();
    return json(toSelfUser(row), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}

/** PATCH /api/me { walletAddress } — payout address for bounty tasks (Base Sepolia). */
export async function PATCH(request: Request) {
  try {
    const row = await requireUserOrThrow();
    return json(await updateMe(row, await readJson(request)), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
