import { billsHttp } from "@/v2/modules/bills/http";
export async function GET(request: Request) { return billsHttp(request); }
export async function POST(request: Request) { return billsHttp(request); }
