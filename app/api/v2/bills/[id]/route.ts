import { billsHttp } from "@/v2/modules/bills/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return billsHttp(request, "bills", (await context.params).id); }
export async function PUT(request: Request, context: Context) { return billsHttp(request, "bills", (await context.params).id); }
