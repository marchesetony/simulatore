import { simulationsHttp } from "@/v2/modules/simulations/http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return simulationsHttp(request, (await context.params).id);
}
