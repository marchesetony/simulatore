import { billsHttp } from "@/v2/modules/bills/http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return billsHttp(request, "supplies", (await context.params).id);
}
