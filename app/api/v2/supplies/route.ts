import { billsHttp } from "@/v2/modules/bills/http";
export async function GET(request: Request) { return billsHttp(request, "supplies"); }
export async function POST(request: Request) { return billsHttp(request, "supplies"); }
