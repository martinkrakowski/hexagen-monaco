export type ReconciliationState = {
  version: number;
  lastUpdated: number;
  isStable: boolean;
  conflictCount: number;
  pendingVerdicts: string[]; // verdict IDs
};

export function createInitialState(): ReconciliationState {
  return {
    version: 0,
    lastUpdated: Date.now(),
    isStable: true,
    conflictCount: 0,
    pendingVerdicts: [],
  };
}

export function promoteState(
  state: ReconciliationState,
  verdictId: string,
): ReconciliationState {
  return {
    ...state,
    version: state.version + 1,
    lastUpdated: Date.now(),
    pendingVerdicts: state.pendingVerdicts.filter((id) => id !== verdictId),
    isStable: state.pendingVerdicts.length <= 1,
    conflictCount: Math.max(0, state.conflictCount - 1),
  };
}

export function addVerdict(
  state: ReconciliationState,
  verdictId: string,
): ReconciliationState {
  return {
    ...state,
    version: state.version + 1,
    lastUpdated: Date.now(),
    pendingVerdicts: [...state.pendingVerdicts, verdictId],
    isStable: false,
    conflictCount: state.conflictCount + 1,
  };
}
