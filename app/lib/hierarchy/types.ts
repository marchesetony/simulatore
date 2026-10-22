export type OrgLevel = "AZIENDA" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE" | "SUB_AGENTE";
export type LimitVector = "EE" | "GAS";
export type LimitCustomerCategory = "RESIDENTIAL" | "NON_RESIDENTIAL";

/** Limits a node adds for itself and its whole branch. `null` means "no extra restriction at this level". */
export interface CommercialLimits {
  readonly vectors: readonly LimitVector[] | null;
  readonly customerCategories: readonly LimitCustomerCategory[] | null;
  readonly excludedCteArchiveIds: readonly string[];
}

export interface OrgNode {
  readonly userId: string;
  readonly level: OrgLevel;
  readonly parentUserId: string | null;
  readonly displayName: string | null;
  readonly limits: CommercialLimits;
  readonly updatedBy: string;
}

export interface OrgNodeView extends OrgNode {
  readonly version: number;
  readonly updatedAt: string;
  readonly effectiveLimits: CommercialLimits;
  readonly ancestorUserIds: readonly string[];
}

export type CteAssignmentScope = "ALL" | "BRANCHES";

/** Company-level decision on who may sell a CTE and when. */
export interface CteAssignment {
  readonly archiveId: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly scope: CteAssignmentScope;
  /** Branch roots: each assignee and everybody below them may use the CTE. */
  readonly assigneeUserIds: readonly string[];
  readonly assignedBy: string;
}

export interface CteAssignmentView extends CteAssignment {
  readonly version: number;
  readonly updatedAt: string;
}
