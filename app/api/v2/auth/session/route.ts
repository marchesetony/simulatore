import { authRuntime } from "@/v2/modules/auth/runtime";
import { handleSession, loginResponse } from "@/v2/modules/auth/http";
import { loginFailure } from "@/v2/modules/auth/service";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try { return await handleSession(request, authRuntime().dependencies); }
  catch (error) { return loginResponse(loginFailure(error)); }
}
