import "server-only";
import { unavailableRepository, type AtomicBatch, type SnapshotRepository } from "../market/repository";
import type { RegulatoryComponent, RegulatorySnapshot, RegulatorySource, RegulatoryVersion } from "./types";

export type RegulatoryBatch = AtomicBatch<RegulatorySource, RegulatoryVersion, RegulatoryComponent, RegulatorySnapshot>;
export type RegulatoryRepository = SnapshotRepository<RegulatorySource, RegulatoryVersion, RegulatoryComponent, RegulatorySnapshot>;
export const regulatoryRepository: RegulatoryRepository = unavailableRepository();
