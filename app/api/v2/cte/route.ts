import { cteHttp } from "@/v2/modules/cte/http";
export const GET = (request: Request) => cteHttp(request, undefined);
export const POST = (request: Request) => cteHttp(request, undefined);
