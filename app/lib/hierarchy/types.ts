export type OrgLevel = "AZIENDA" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE" | "SUB_AGENTE";
export type LimitVector = "EE" | "GAS";
export type LimitCustomerCategory = "RESIDENTIAL" | "NON_RESIDENTIAL";

/** Limits a node adds for itself and its whole branch. `null` means "no extra restriction at this level". */
export interface CommercialLimits {
  readonly vectors: readonly LimitVector[] | null;
  readonly customerCategories: readonly LimitCustomerCategory[] | null;
  readonly excludedCteArchiveIds: readonly string[];
}

export interface CtePermissionGrant {
  readonly grantedBy: string;
  readonly grantedAt: string;
}

export interface OrgNode {
  readonly userId: string;
  readonly level: OrgLevel;
  readonly parentUserId: string | null;
  readonly displayName: string | null;
  readonly limits: CommercialLimits;
  /** "Può forzare": may authorize, for one bill, a CTE the eligibility rules leave out; it holds only while every manager
   *  above holds it too. */
  readonly canAuthorizeCte?: boolean;
  /** "Può delegare" (Tony 20/11/2026): may pass "Può forzare" (and, to a manager, "Può delegare") to its own branch. It requires
   *  "Può forzare" on the same node and holds only while every manager above holds it too. */
  readonly canDelegateCte?: boolean;
  /** Who turned "Può forzare" on, and when: written by the server, never taken from the request. */
  readonly cteForcingGrant?: CtePermissionGrant;
  /** Who turned "Può delegare" on, and when: written by the server, never taken from the request. */
  readonly cteDelegationGrant?: CtePermissionGrant;
  /** Tony (1/11): may manage the company's commercial discount and pass the permission on to their branch. */
  readonly canManageDiscount?: boolean;
  readonly updatedBy: string;
}

export interface OrgNodeView extends OrgNode {
  readonly version: number;
  readonly updatedAt: string;
  readonly effectiveLimits: CommercialLimits;
  readonly effectiveCanAuthorizeCte: boolean;
  readonly effectiveCanDelegateCte: boolean;
  readonly effectiveCanManageDiscount: boolean;
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
