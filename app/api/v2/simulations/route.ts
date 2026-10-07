import { simulationsHttp } from "@/v2/modules/simulations/http";
export const GET = (request: Request) => simulationsHttp(request);
export const POST = (request: Request) => simulationsHttp(request);
