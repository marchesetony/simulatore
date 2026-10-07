import { cteHttp } from "@/v2/modules/cte/http";
type Context = { readonly params: Promise<{ readonly id: string }> };
export async function GET(request: Request, context: Context) { return cteHttp(request, (await context.params).id); }
