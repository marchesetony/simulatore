import { authRuntime } from "@/v2/modules/auth/runtime";
import { handleLogin, loginResponse } from "@/v2/modules/auth/http";
import { loginFailure } from "@/v2/modules/auth/service";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const { config, dependencies } = authRuntime();
    return await handleLogin(request, config.origin, dependencies);
  } catch (error) { return loginResponse(loginFailure(error)); }
}
