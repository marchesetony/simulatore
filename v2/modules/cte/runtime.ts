import "server-only";
import { authRuntime } from "../auth/runtime";
import { CteService } from "./service";
import { UnavailableCteRepository } from "./repository";
export function cteRuntime() { const { config, dependencies } = authRuntime(); return { origin: config.origin, service: new CteService(dependencies, new UnavailableCteRepository()) }; }
