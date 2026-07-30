import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ApprovalRequest, RegulatoryRepository } from "./regulatory-ports";
import type {
  EvidenceReference,
  MarketDataPoint,
  MarketDataSeries,
  OfficialSource,
  RegulatoryEntity,
  RegulatoryEntityType,
  RegulatoryDocument,
  RegulatoryRuleVersion,
  ReviewDecision,
  VersionStateRecord,
} from "./regulatory-types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { checksumFor, deterministicId, isRegulatoryEntityType, nextVersion as bumpVersion, overlaps, validateApprovedEntityProvenance, validateChecksum, validateEvidenceReference, validateInterval, validatePoints, validateReviewDecision, validateSeries, validateSource, validateTenantId } from "./regulatory-validation.ts";

type Store = {
  readonly revision: number;
  readonly sources: OfficialSource[];
  readonly documents: RegulatoryDocument[];
  readonly rules: RegulatoryRuleVersion[];
  readonly series: MarketDataSeries[];
  readonly points: MarketDataPoint[];
  readonly evidence: EvidenceReference[];
  readonly reviews: ReviewDecision[];
  readonly versionStates: VersionStateRecord[];
};

type EntityMap = {
  OfficialSource: OfficialSource;
  RegulatoryDocument: RegulatoryDocument;
  RegulatoryRuleVersion: RegulatoryRuleVersion;
  MarketDataSeries: MarketDataSeries;
  MarketDataPoint: MarketDataPoint;
};

type CollectionKey = "sources" | "documents" | "rules" | "series" | "points";

const emptyStore = (): Store => ({ revision: 0, sources: [], documents: [], rules: [], series: [], points: [], evidence: [], reviews: [], versionStates: [] });

const collectionKeyFor = (subjectType: RegulatoryEntityType): CollectionKey => {
  switch (subjectType) {
    case "OfficialSource": return "sources";
    case "RegulatoryDocument": return "documents";
    case "RegulatoryRuleVersion": return "rules";
    case "MarketDataSeries": return "series";
    case "MarketDataPoint": return "points";
  }
};

const parseVersion = (value: string): readonly number[] => value.split(".").map((item) => Number.parseInt(item, 10));
const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const businessIdOf = (entity: RegulatoryEntity): string => entity.officialIdentifier;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDate = (value: unknown): value is string => nonEmpty(value) && Number.isFinite(Date.parse(value));

export class LocalRegulatoryRepository implements RegulatoryRepository {
  private readonly file: string;

  constructor(root = path.join(process.cwd(), "var", "foundation-regulatory-data")) {
    this.file = path.resolve(root, "records.json");
  }

  private async read(): Promise<Store> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT") return emptyStore();
      throw new Error("REPOSITORY_READ_ERROR");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("REPOSITORY_CORRUPT");
    }
    const store = this.validateStoreShape(parsed);
    this.validateStoreContents(store);
    return store;
  }

  private validateStoreShape(parsed: unknown): Store {
    if (!isObject(parsed)) throw new Error("REPOSITORY_SCHEMA_INVALID");
    const candidate = parsed as Record<string, unknown>;
    const arrayKeys = ["sources", "documents", "rules", "series", "points", "evidence", "reviews", "versionStates"] as const;
    if (typeof candidate.revision !== "number" || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0) throw new Error("REPOSITORY_SCHEMA_INVALID");
    if (arrayKeys.some((key) => !Array.isArray(candidate[key]))) throw new Error("REPOSITORY_SCHEMA_INVALID");
    return {
      revision: candidate.revision,
      sources: candidate.sources as OfficialSource[],
      documents: candidate.documents as RegulatoryDocument[],
      rules: candidate.rules as RegulatoryRuleVersion[],
      series: candidate.series as MarketDataSeries[],
      points: candidate.points as MarketDataPoint[],
      evidence: candidate.evidence as EvidenceReference[],
      reviews: candidate.reviews as ReviewDecision[],
      versionStates: candidate.versionStates as VersionStateRecord[],
    };
  }

  private validateStoreContents(store: Store): void {
    for (const source of store.sources) this.validateEntity(source);
    for (const document of store.documents) this.validateEntity(document);
    for (const rule of store.rules) this.validateEntity(rule);
    for (const series of store.series) this.validateEntity(series);
    for (const point of store.points) this.validateEntity(point);
    for (const evidence of store.evidence) validateEvidenceReference(evidence);
    for (const review of store.reviews) validateReviewDecision(review);
    const stateGroups = new Map<string, number>();
    for (const state of store.versionStates) {
      validateTenantId(state.tenantId);
      if (!isRegulatoryEntityType(state.subjectType) || !nonEmpty(state.subjectId) || !nonEmpty(state.recordId) || !validDate(state.changedAt)) throw new Error("REPOSITORY_SCHEMA_INVALID");
      if (state.state !== "CURRENT" && state.state !== "SUPERSEDED") throw new Error("REPOSITORY_SCHEMA_INVALID");
      if (!(state.supersededBy === null || nonEmpty(state.supersededBy))) throw new Error("REPOSITORY_SCHEMA_INVALID");
      const key = `${state.tenantId}|${state.subjectType}|${state.subjectId}`;
      stateGroups.set(key, (stateGroups.get(key) ?? 0) + (state.state === "CURRENT" ? 1 : 0));
    }
    for (const currentCount of stateGroups.values()) if (currentCount !== 1) throw new Error("REPOSITORY_SCHEMA_INVALID");
  }

  private async lock(): Promise<() => Promise<void>> {
    const lockPath = `${this.file}.lock`;
    await mkdir(path.dirname(this.file), { recursive: true });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await mkdir(lockPath);
        return async () => { await rm(lockPath, { recursive: true, force: false }); };
      } catch (error) {
        if (!(error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "EEXIST")) throw new Error("REPOSITORY_LOCK_ERROR");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    throw new Error("REPOSITORY_LOCK_TIMEOUT");
  }

  private async write(store: Store, expectedRevision: number): Promise<void> {
    const release = await this.lock();
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      const current = await this.read();
      if (current.revision !== expectedRevision) throw new Error("CONCURRENT_MODIFICATION");
      const handle = await open(temp, "wx");
      try {
        await handle.writeFile(JSON.stringify({ ...store, revision: expectedRevision + 1 }, null, 2), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.file);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
      await release();
    }
  }

  private collection<TType extends RegulatoryEntityType>(store: Store, subjectType: TType): EntityMap[TType][] {
    return store[collectionKeyFor(subjectType)] as EntityMap[TType][];
  }

  private findRecord<TType extends RegulatoryEntityType>(store: Store, subjectType: TType, tenantId: string, id: string): EntityMap[TType] | null {
    return this.collection(store, subjectType).find((item) => item.tenantId === tenantId && item.id === id) ?? null;
  }

  private currentState(store: Store, tenantId: string, subjectType: RegulatoryEntityType, subjectId: string): VersionStateRecord | null {
    return store.versionStates.find((state) => state.tenantId === tenantId && state.subjectType === subjectType && state.subjectId === subjectId && state.state === "CURRENT") ?? null;
  }

  private stateForRecord(store: Store, tenantId: string, subjectType: RegulatoryEntityType, recordId: string): VersionStateRecord | null {
    return store.versionStates.find((state) => state.tenantId === tenantId && state.subjectType === subjectType && state.recordId === recordId) ?? null;
  }

  private currentRecordByBusiness<TType extends RegulatoryEntityType>(store: Store, subjectType: TType, tenantId: string, subjectId: string): EntityMap[TType] | null {
    const state = this.currentState(store, tenantId, subjectType, subjectId);
    return state ? this.findRecord(store, subjectType, tenantId, state.recordId) : null;
  }

  private historyFor<TType extends RegulatoryEntityType>(store: Store, subjectType: TType, tenantId: string, id: string): readonly EntityMap[TType][] {
    const record = this.findRecord(store, subjectType, tenantId, id);
    if (!record) return [];
    return [...this.collection(store, subjectType).filter((item) => item.tenantId === tenantId && businessIdOf(item) === businessIdOf(record)).sort((left, right) => compareVersions(left.version, right.version))];
  }

  private ensureCurrentInsert(store: Store, tenantId: string, subjectType: RegulatoryEntityType, subjectId: string): void {
    if (this.currentState(store, tenantId, subjectType, subjectId)) throw new Error("CURRENT_VERSION_EXISTS");
  }

  private addState(store: Store, tenantId: string, subjectType: RegulatoryEntityType, subjectId: string, recordId: string, changedAt: string): VersionStateRecord {
    return { tenantId, subjectType, subjectId, recordId, state: "CURRENT", supersededBy: null, changedAt };
  }

  private withCurrentReplaced(store: Store, tenantId: string, subjectType: RegulatoryEntityType, subjectId: string, currentId: string, replacementId: string, changedAt: string): VersionStateRecord[] {
    return [
      ...store.versionStates.map((state) => state.tenantId === tenantId && state.subjectType === subjectType && state.recordId === currentId
        ? { ...state, state: "SUPERSEDED" as const, supersededBy: replacementId, changedAt }
        : state),
      this.addState(store, tenantId, subjectType, subjectId, replacementId, changedAt),
    ];
  }

  private relatedCurrentId(store: Store, tenantId: string, subjectType: RegulatoryEntityType, id: string): string {
    const referenced = this.findRecord(store, subjectType, tenantId, id);
    if (!referenced) throw new Error("APPROVAL_DEPENDENCY_DENIED");
    const current = this.currentRecordByBusiness(store, subjectType, tenantId, businessIdOf(referenced));
    if (!current || current.approvalStatus !== "APPROVED") throw new Error("APPROVAL_DEPENDENCY_DENIED");
    return current.id;
  }

  private normalizeApprovedEntity<TType extends RegulatoryEntityType>(store: Store, subjectType: TType, entity: EntityMap[TType]): EntityMap[TType] {
    if (subjectType === "RegulatoryDocument") {
      const document = entity as RegulatoryDocument;
      return { ...document, sourceId: this.relatedCurrentId(store, document.tenantId, "OfficialSource", document.sourceId) } as EntityMap[TType];
    }
    if (subjectType === "RegulatoryRuleVersion") {
      const rule = entity as RegulatoryRuleVersion;
      return { ...rule, documentId: this.relatedCurrentId(store, rule.tenantId, "RegulatoryDocument", rule.documentId) } as EntityMap[TType];
    }
    if (subjectType === "MarketDataSeries") {
      const series = entity as MarketDataSeries;
      return {
        ...series,
        sourceId: this.relatedCurrentId(store, series.tenantId, "OfficialSource", series.sourceId),
        documentId: series.documentId ? this.relatedCurrentId(store, series.tenantId, "RegulatoryDocument", series.documentId) : series.documentId,
        ruleId: series.ruleId ? this.relatedCurrentId(store, series.tenantId, "RegulatoryRuleVersion", series.ruleId) : series.ruleId,
      } as EntityMap[TType];
    }
    if (subjectType === "MarketDataPoint") {
      const point = entity as MarketDataPoint;
      return {
        ...point,
        sourceId: this.relatedCurrentId(store, point.tenantId, "OfficialSource", point.sourceId),
        seriesId: this.relatedCurrentId(store, point.tenantId, "MarketDataSeries", point.seriesId),
      } as EntityMap[TType];
    }
    return entity;
  }

  private rebuildWithChecksum<T extends { readonly checksum: string } & object>(value: T): T {
    const payload = { ...(value as unknown as Record<string, unknown>) };
    delete (payload as { checksum?: string }).checksum;
    return { ...payload, checksum: checksumFor(payload) } as T;
  }

  private validateEntity(entity: RegulatoryEntity): void {
    switch (true) {
      case "sourceInstitution" in entity && !("effectiveFrom" in entity):
        validateSource(entity as OfficialSource);
        validateApprovedEntityProvenance("OfficialSource", entity as OfficialSource);
        return;
      case "seriesId" in entity:
        validateTenantId(entity.tenantId);
        validateInterval(entity as MarketDataPoint);
        validateChecksum(entity as MarketDataPoint);
        validateApprovedEntityProvenance("MarketDataPoint", entity as MarketDataPoint);
        return;
      case "structure" in entity:
        validateSeries(entity as MarketDataSeries);
        validateApprovedEntityProvenance("MarketDataSeries", entity as MarketDataSeries);
        return;
      default:
        validateTenantId(entity.tenantId);
        validateInterval(entity as RegulatoryDocument | RegulatoryRuleVersion);
        validateChecksum(entity as RegulatoryDocument | RegulatoryRuleVersion);
        validateApprovedEntityProvenance("documentType" in entity ? "RegulatoryDocument" : "RegulatoryRuleVersion", entity as RegulatoryDocument | RegulatoryRuleVersion);
    }
  }

  async get(tenantId: string, id: string): Promise<OfficialSource | null> {
    validateTenantId(tenantId);
    return this.findRecord(await this.read(), "OfficialSource", tenantId, id);
  }

  async getCurrentSource(tenantId: string, id: string): Promise<OfficialSource | null> {
    validateTenantId(tenantId);
    const store = await this.read();
    const requested = this.findRecord(store, "OfficialSource", tenantId, id);
    return requested ? this.currentRecordByBusiness(store, "OfficialSource", tenantId, businessIdOf(requested)) : null;
  }

  isAllowed(source: OfficialSource): boolean {
    return ["ARERA", "GME", "TERNA", "ACQUIRENTE_UNICO", "SII", "OTHER_COMPETENT"].includes(source.sourceInstitution);
  }

  async save(source: OfficialSource): Promise<void> {
    this.validateEntity(source);
    const store = await this.read();
    const existing = this.findRecord(store, "OfficialSource", source.tenantId, source.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(source)) throw new Error("SOURCE_IMMUTABLE");
      return;
    }
    this.ensureCurrentInsert(store, source.tenantId, "OfficialSource", source.officialIdentifier);
    await this.write({
      ...store,
      sources: [...store.sources, source],
      versionStates: [...store.versionStates, this.addState(store, source.tenantId, "OfficialSource", source.officialIdentifier, source.id, source.retrievedAt)],
    }, store.revision);
  }

  async importDocument(document: RegulatoryDocument): Promise<RegulatoryDocument> {
    this.validateEntity(document);
    const store = await this.read();
    if (this.findRecord(store, "RegulatoryDocument", document.tenantId, document.id)) throw new Error("DOCUMENT_DUPLICATE");
    this.ensureCurrentInsert(store, document.tenantId, "RegulatoryDocument", document.officialIdentifier);
    if (overlaps([...store.documents.filter((item) => item.tenantId === document.tenantId && item.officialIdentifier === document.officialIdentifier), document])) throw new Error("EFFECTIVE_INTERVAL_CONFLICT");
    await this.write({
      ...store,
      documents: [...store.documents, document],
      versionStates: [...store.versionStates, this.addState(store, document.tenantId, "RegulatoryDocument", document.officialIdentifier, document.id, document.retrievedAt)],
    }, store.revision);
    return document;
  }

  async importRule(rule: RegulatoryRuleVersion): Promise<RegulatoryRuleVersion> {
    this.validateEntity(rule);
    const store = await this.read();
    if (this.findRecord(store, "RegulatoryRuleVersion", rule.tenantId, rule.id)) throw new Error("RULE_DUPLICATE");
    this.ensureCurrentInsert(store, rule.tenantId, "RegulatoryRuleVersion", rule.officialIdentifier);
    await this.write({
      ...store,
      rules: [...store.rules, rule],
      versionStates: [...store.versionStates, this.addState(store, rule.tenantId, "RegulatoryRuleVersion", rule.officialIdentifier, rule.id, rule.retrievedAt)],
    }, store.revision);
    return rule;
  }

  async importSeries(series: MarketDataSeries, points: readonly MarketDataPoint[]): Promise<MarketDataSeries> {
    validatePoints(series, points);
    this.validateEntity(series);
    for (const point of points) this.validateEntity(point);
    const store = await this.read();
    const source = this.findRecord(store, "OfficialSource", series.tenantId, series.sourceId);
    if (!source || source.approvalStatus !== "APPROVED") throw new Error("SOURCE_UNAPPROVED");
    if (this.findRecord(store, "MarketDataSeries", series.tenantId, series.id)) throw new Error("SERIES_IMMUTABLE");
    this.ensureCurrentInsert(store, series.tenantId, "MarketDataSeries", series.officialIdentifier);
    if (overlaps([...store.series.filter((item) => item.tenantId === series.tenantId && item.officialIdentifier === series.officialIdentifier), series])) throw new Error("EFFECTIVE_INTERVAL_CONFLICT");
    for (const point of points) {
      if (this.findRecord(store, "MarketDataPoint", point.tenantId, point.id)) throw new Error("POINT_IMMUTABLE");
      this.ensureCurrentInsert(store, point.tenantId, "MarketDataPoint", point.officialIdentifier);
    }
    await this.write({
      ...store,
      series: [...store.series, series],
      points: [...store.points, ...points],
      versionStates: [
        ...store.versionStates,
        this.addState(store, series.tenantId, "MarketDataSeries", series.officialIdentifier, series.id, series.retrievedAt),
        ...points.map((point) => this.addState(store, point.tenantId, "MarketDataPoint", point.officialIdentifier, point.id, point.retrievedAt)),
      ],
    }, store.revision);
    return series;
  }

  async getDocument(tenantId: string, id: string): Promise<RegulatoryDocument | null> {
    const store = await this.read();
    const document = this.findRecord(store, "RegulatoryDocument", tenantId, id);
    const state = document ? this.stateForRecord(store, tenantId, "RegulatoryDocument", document.id) : null;
    return document && document.approvalStatus === "APPROVED" && state?.state === "CURRENT" ? document : null;
  }

  async getDocumentVersion(tenantId: string, id: string): Promise<RegulatoryDocument | null> {
    return this.findRecord(await this.read(), "RegulatoryDocument", tenantId, id);
  }

  async getRule(tenantId: string, id: string): Promise<RegulatoryRuleVersion | null> {
    return this.findRecord(await this.read(), "RegulatoryRuleVersion", tenantId, id);
  }

  async getSeries(tenantId: string, id: string): Promise<MarketDataSeries | null> {
    const store = await this.read();
    const series = this.findRecord(store, "MarketDataSeries", tenantId, id);
    const state = series ? this.stateForRecord(store, tenantId, "MarketDataSeries", series.id) : null;
    return series && series.approvalStatus === "APPROVED" && state?.state === "CURRENT" ? series : null;
  }

  async getSeriesVersion(tenantId: string, id: string): Promise<MarketDataSeries | null> {
    return this.findRecord(await this.read(), "MarketDataSeries", tenantId, id);
  }

  async getSeriesHistory(tenantId: string, id: string): Promise<readonly MarketDataSeries[]> {
    validateTenantId(tenantId);
    return this.historyFor(await this.read(), "MarketDataSeries", tenantId, id);
  }

  async getPoints(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]> {
    const store = await this.read();
    const series = this.findRecord(store, "MarketDataSeries", tenantId, seriesId);
    const state = series ? this.stateForRecord(store, tenantId, "MarketDataSeries", series.id) : null;
    if (!series || series.approvalStatus !== "APPROVED" || state?.state !== "CURRENT") return [];
    return store.points.filter((point) => point.tenantId === tenantId && point.seriesId === seriesId && point.approvalStatus === "APPROVED" && this.stateForRecord(store, tenantId, "MarketDataPoint", point.id)?.state === "CURRENT");
  }

  async getPointVersions(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]> {
    validateTenantId(tenantId);
    return (await this.read()).points.filter((point) => point.tenantId === tenantId && point.seriesId === seriesId).sort((left, right) => compareVersions(left.version, right.version));
  }

  async getPointHistory(tenantId: string, seriesId: string): Promise<readonly MarketDataPoint[]> {
    validateTenantId(tenantId);
    const store = await this.read();
    const series = this.findRecord(store, "MarketDataSeries", tenantId, seriesId);
    if (!series) return [];
    const seriesHistoryIds = new Set(this.historyFor(store, "MarketDataSeries", tenantId, seriesId).map((item) => item.id));
    return [...store.points.filter((point) => point.tenantId === tenantId && seriesHistoryIds.has(point.seriesId)).sort((left, right) => compareVersions(left.version, right.version))];
  }

  async approve(input: ApprovalRequest): Promise<void> {
    validateTenantId(input.tenantId);
    validateReviewDecision(input.decision);
    if (input.reviewer.trim() !== input.decision.reviewer.trim()) throw new Error("REVIEW_INVALID");
    if (input.tenantId !== input.decision.tenantId || input.subjectType !== input.decision.subjectType) throw new Error("REVIEW_INVALID");
    const store = await this.read();
    const subject = this.findRecord(store, input.subjectType, input.tenantId, input.subjectId);
    if (!subject) throw new Error("REVIEW_SUBJECT_NOT_FOUND");
    const subjectBusinessId = businessIdOf(subject);
    if (input.decision.subjectId !== subjectBusinessId || input.decision.subjectVersionId !== subject.id) throw new Error("REVIEW_INVALID");
    const state = this.stateForRecord(store, input.tenantId, input.subjectType, subject.id);
    if (!state || state.state !== "CURRENT") throw new Error("INVALID_LIFECYCLE_TRANSITION");
    if (subject.approvalStatus === "APPROVED" || subject.approvalStatus === "REJECTED") throw new Error("INVALID_LIFECYCLE_TRANSITION");
    for (const reference of input.decision.evidenceReferences) {
      const stored = store.evidence.find((item) => item.tenantId === input.tenantId && item.id === reference.id);
      if (!stored) throw new Error("REVIEW_EVIDENCE_INVALID");
      if (stored.subjectType !== input.subjectType || stored.subjectId !== subjectBusinessId || stored.subjectVersionId !== subject.id) throw new Error("REVIEW_EVIDENCE_SUBJECT_MISMATCH");
      if (stored.ingestionStatus !== "APPROVED" || stored.reviewerApprovalStatus !== "APPROVED") throw new Error("REVIEW_EVIDENCE_INVALID");
      validateChecksum(stored);
    }
    const nextVersion = bumpVersion(subject.version);
    const nextEntityId = deterministicId(input.subjectType, `${input.tenantId}|${subjectBusinessId}`, nextVersion);
    const approvedEvidence = input.decision.evidenceReferences
      .map((reference) => store.evidence.find((item) => item.tenantId === input.tenantId && item.id === reference.id)!)
      .map((reference) => this.rebuildWithChecksum({
        ...reference,
        id: deterministicId("EvidenceReference", `${input.tenantId}|${reference.id}`, nextEntityId),
        subjectVersionId: nextEntityId,
      }));
    for (const reference of approvedEvidence) validateEvidenceReference(reference);
    const approvedDecision = {
      ...input.decision,
      subjectVersionId: nextEntityId,
      evidenceReferences: approvedEvidence.map((reference) => ({ ...reference })),
    };
    validateReviewDecision(approvedDecision);
    const existingReview = store.reviews.find((review) => review.tenantId === input.tenantId && review.id === approvedDecision.id);
    if (existingReview && JSON.stringify(existingReview) !== JSON.stringify(approvedDecision)) throw new Error("REVIEW_DECISION_CONFLICT");
    const nextStatus = input.decision.decision === "APPROVED" ? "APPROVED" : input.decision.decision === "REJECTED" ? "REJECTED" : "VALIDATED";
    const nextEntityBase = {
      ...subject,
      id: nextEntityId,
      version: nextVersion,
      parentVersionId: subject.id,
      approvalStatus: nextStatus,
      reviewer: input.reviewer,
      reviewDecisionId: approvedDecision.id,
      provenance: approvedEvidence.map((reference) => ({ ...reference })),
    } as EntityMap[typeof input.subjectType];
    const nextEntity = this.rebuildWithChecksum(this.normalizeApprovedEntity(store, input.subjectType, nextEntityBase as EntityMap[typeof input.subjectType])) as EntityMap[typeof input.subjectType];
    this.validateEntity(nextEntity);
    const collection = this.collection(store, input.subjectType);
    await this.write({
      ...store,
      [collectionKeyFor(input.subjectType)]: [...collection, nextEntity],
      evidence: [...store.evidence, ...approvedEvidence],
      reviews: existingReview ? store.reviews : [...store.reviews, approvedDecision],
      versionStates: this.withCurrentReplaced(store, input.tenantId, input.subjectType, subjectBusinessId, subject.id, nextEntity.id, input.decision.reviewedAt),
    } as Store, store.revision);
  }

  async put(reference: EvidenceReference): Promise<void> {
    validateEvidenceReference(reference);
    const store = await this.read();
    const existing = store.evidence.find((item) => item.tenantId === reference.tenantId && item.id === reference.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(reference)) throw new Error("EVIDENCE_IMMUTABLE");
      return;
    }
    await this.write({ ...store, evidence: [...store.evidence, reference] }, store.revision);
  }

  async getEvidence(tenantId: string, id: string): Promise<EvidenceReference | null> {
    validateTenantId(tenantId);
    return (await this.read()).evidence.find((item) => item.tenantId === tenantId && item.id === id) ?? null;
  }

  async getReview(tenantId: string, id: string): Promise<ReviewDecision | null> {
    validateTenantId(tenantId);
    return (await this.read()).reviews.find((item) => item.tenantId === tenantId && item.id === id) ?? null;
  }

  async getVersionState(tenantId: string, subjectType: RegulatoryEntityType, recordId: string): Promise<VersionStateRecord | null> {
    validateTenantId(tenantId);
    return this.stateForRecord(await this.read(), tenantId, subjectType, recordId);
  }
}
