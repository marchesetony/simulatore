import { customersHttp } from "@/v2/modules/customers/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return customersHttp(request, (await context.params).id); }
export async function PUT(request: Request, context: Context) { return customersHttp(request, (await context.params).id); }
