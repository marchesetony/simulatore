import "server-only";
import { authRuntime } from "../auth/runtime";
import { SupabaseHttp } from "../auth/supabase-http";
import { SupabaseCustomerRepository } from "../customers/repository";
import { UnavailableBillRepository } from "./repository";
import { BillService } from "./service";

export function billRuntime() {
  const { config, dependencies } = authRuntime();
  return { origin: config.origin, service: new BillService(dependencies,
    new UnavailableBillRepository(), new SupabaseCustomerRepository(new SupabaseHttp(config))) };
}
