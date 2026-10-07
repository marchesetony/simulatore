import "server-only";
import { authRuntime } from "../auth/runtime";
import { SupabaseHttp } from "../auth/supabase-http";
import { SupabaseCustomerRepository } from "../customers/repository";
import { UnavailableBillRepository } from "../bills/repository";
import { UnavailableSimulationRepository } from "./repository";
import { SimulationService } from "./service";

export function simulationRuntime() {
  const { config, dependencies } = authRuntime();
  return { origin: config.origin, service: new SimulationService(dependencies, new UnavailableSimulationRepository(),
    new UnavailableBillRepository(), new SupabaseCustomerRepository(new SupabaseHttp(config))) };
}
