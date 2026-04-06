import { create } from "zustand";

export interface NavigationItem {
  id: string;
  label: string;
  type: string;
  dependsOn: string[];
}

export interface RuleItem {
  id: string;
  text: string;
}

export interface ViolationItem {
  ruleId: string;
  severity: "error" | "warning";
  file: string;
  message: string;
  snippet?: string;
}

export interface TUIState {
  navigationTree: NavigationItem[];
  ruleEngine: RuleItem[];
  violationInspector: ViolationItem[];
  selectedDomainIndex: number;
  selectedViolationIndex: number;
  selectedPane: "navigation" | "rules" | "violations";
  isLoading: boolean;
  statusMessage: string;
  setNavigationTree: (value: NavigationItem[]) => void;
  setRuleEngine: (value: RuleItem[]) => void;
  setViolationInspector: (value: ViolationItem[]) => void;
  setSelectedDomainIndex: (value: number) => void;
  setSelectedViolationIndex: (value: number) => void;
  setSelectedPane: (value: "navigation" | "rules" | "violations") => void;
  setIsLoading: (value: boolean) => void;
  setStatusMessage: (value: string) => void;
}

export const useTUIStore = create<TUIState>((set) => ({
  navigationTree: [],
  ruleEngine: [],
  violationInspector: [],
  selectedDomainIndex: 0,
  selectedViolationIndex: 0,
  selectedPane: "navigation",
  isLoading: true,
  statusMessage: "Loading architecture data...",
  setNavigationTree: (value) => set({ navigationTree: value }),
  setRuleEngine: (value) => set({ ruleEngine: value }),
  setViolationInspector: (value) => set({ violationInspector: value }),
  setSelectedDomainIndex: (value) => set({ selectedDomainIndex: value }),
  setSelectedViolationIndex: (value) => set({ selectedViolationIndex: value }),
  setSelectedPane: (value) => set({ selectedPane: value }),
  setIsLoading: (value) => set({ isLoading: value }),
  setStatusMessage: (value) => set({ statusMessage: value }),
}));
