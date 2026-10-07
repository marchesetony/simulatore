import "server-only";
import { SimulationError, type Simulation } from "./types";

/** create atomically persists the complete snapshot/result; existing IDs must never be replaced. */
export interface SimulationRepository {
  list(tenantId: string): Promise<readonly Simulation[]>;
  get(tenantId: string, id: string): Promise<Simulation | null>;
  create(simulation: Simulation): Promise<Simulation>;
}
export class UnavailableSimulationRepository implements SimulationRepository {
  async list(): Promise<readonly Simulation[]> { throw new SimulationError("UNAVAILABLE"); }
  async get(): Promise<Simulation | null> { throw new SimulationError("UNAVAILABLE"); }
  async create(): Promise<Simulation> { throw new SimulationError("UNAVAILABLE"); }
}
