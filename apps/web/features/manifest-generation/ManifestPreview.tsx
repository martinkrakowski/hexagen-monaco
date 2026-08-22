import { useState, useMemo, useEffect, useRef } from "react";
import {
  Network,
  Component,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
  RefreshCw,
  Maximize2,
  Minimize2,
  FileCode,
  X,
} from "lucide-react";
import { Button } from "@hexagen/ui";
import { ManifestYamlSidebar } from "./ManifestYamlSidebar";
import { ManifestResizeHandle } from "./ManifestResizeHandle";
import {
  Panel,
  PanelGroup,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useIsDesktop } from "./useIsDesktop";
import { ContextMapView } from "./ContextMapView";
import { useContextChatPanel } from "./store/useContextChatPanel";
import {
  ContextGovernanceChatPanel,
  ContextChatCollapsedStrip,
} from "./ContextGovernanceChatPanel";
import { ContextGovernanceChatDrawer } from "./ContextGovernanceChatDrawer";
import { MermaidDiagramView } from "./MermaidDiagramView";
import { ValidationReportView } from "./ValidationReportView";
import { ValidationFindingsPanel } from "./ValidationFindingsPanel";
import { ManifestAutoFixDrawer } from "./ManifestAutoFixDrawer";
import type { ValidationItem } from "@hexagen/manifest-generation";
import {
  parseYamlToViewData,
  canAutoFix,
  applyDeterministicFix,
} from "@hexagen/manifest-generation";
import type { StageValidationReport } from "../../app/lib/useStagedGenerationStream";
import {
  toAdvisoryValidationItems,
  computeHasBlockingFailures,
} from "./manifest-validation-display";
import { generateMermaidDiagram } from "./generate-mermaid-diagram";

interface ManifestPreviewProps {
  manifestYaml: string;
  onApprove: (manifestYaml: string) => void;
  onRegenerate: () => void;
  onStartOver: () => void;
  onYamlChange?: (yaml: string) => void;
  hideActions?: boolean;
  hideHeader?: boolean;
  activeTab?: ViewTab;
  onTabChange?: (tab: ViewTab) => void;
  embedded?: boolean;
  isApproveDisabled?: boolean;
  /**
   * Opt in to the in-frame AI governance chat column (accept view). On desktop
   * it renders as a collapsible third resizable column; below md it falls back
   * to a slide-in overlay. Clicking a Context Map card opens/seeds it.
   */
  showContextChat?: boolean;
  /**
   * The server pipeline's Stage-6 report for EXACTLY this manifestYaml
   * (usePendingManifest.validationReport). When present, the client auto-fix
   * loop is skipped (the server already validated — and where needed
   * repaired — this YAML), the Validation tab renders the server's findings,
   * and the parser's connectivity heuristics stop gating approve. Absent/null
   * for report-less YAML (hand-written manifests, legacy imports), where the
   * fixer and heuristics remain the only validation there is.
   */
  validationReport?: StageValidationReport | null;
}

export type ViewTab = "context-map" | "mermaid" | "validation";

/** Default width (%) the AI chat column opens to when revealed. */
const AI_PANEL_DEFAULT_SIZE = 28;

export function ManifestPreview({
  manifestYaml,
  onApprove,
  onRegenerate,
  onStartOver,
  onYamlChange,
  hideActions,
  hideHeader,
  activeTab: externalActiveTab,
  onTabChange,
  embedded,
  isApproveDisabled,
  showContextChat,
  validationReport,
}: ManifestPreviewProps) {
  const [internalActiveTab, setInternalActiveTab] =
    useState<ViewTab>("context-map");
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showYamlMobile, setShowYamlMobile] = useState(false);
  // Desktop (md+) shows the resizable YAML column; below md it's hidden and the
  // YAML lives in the mobile overlay, so the PanelGroup is desktop-only.
  const isDesktop = useIsDesktop();

  // --- AI governance chat column (accept view only; opt-in via showContextChat) ---
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const aiChatIsOpen = useContextChatPanel((s) => s.isOpen);
  const aiSelectedContext = useContextChatPanel((s) => s.selectedContext);
  const closeAiChat = useContextChatPanel((s) => s.close);
  const openAiChat = useContextChatPanel((s) => s.open);

  // Reveal the column whenever a context is opened from the map. We only force a
  // size when it's currently collapsed, so a click never disturbs a width the
  // user has dragged while the column is already open.
  useEffect(() => {
    if (!showContextChat || !isDesktop || !aiChatIsOpen) return;
    const panel = aiPanelRef.current;
    if (panel?.isCollapsed()) panel.resize(AI_PANEL_DEFAULT_SIZE);
  }, [aiChatIsOpen, showContextChat, isDesktop]);

  const collapseAiPanel = () => aiPanelRef.current?.collapse();
  const expandAiPanel = () => {
    // Re-opening the last context keeps its conversation; with no prior context
    // just size the (empty-state) column open.
    if (aiSelectedContext) openAiChat(aiSelectedContext);
    else aiPanelRef.current?.resize(AI_PANEL_DEFAULT_SIZE);
  };

  // Local state for manifest to allow inline auto-fixes
  const [localManifestYaml, setLocalManifestYaml] = useState(manifestYaml);
  const [activeFixViolation, setActiveFixViolation] =
    useState<ValidationItem | null>(null);
  // Disclosure for the auto-fix loop below: the violation titles it resolved,
  // listed on the Validation tab so the mutation is never silent.
  const [appliedAutoFixes, setAppliedAutoFixes] = useState<string[]>([]);

  const autoFixAppliedRef = useRef(false);
  useEffect(() => {
    setLocalManifestYaml(manifestYaml);
    autoFixAppliedRef.current = false;
    setAppliedAutoFixes([]);
  }, [manifestYaml]);
  useEffect(() => {
    // Server-validated manifests skip the client fixer entirely: the staged
    // pipeline already validated (and where needed repaired) exactly this
    // YAML, and the fixer's name-heuristic padding was re-adding adapters the
    // server knew were bound (alvaro field test: duplicated real adapters,
    // R12 uniqueness violations). The fixer stays live for report-less YAML
    // and re-arms when an edit clears the report (usePendingManifest.updateYaml
    // nulls it, and the parent re-render lands here with a fresh yaml prop).
    if (validationReport) return;
    if (autoFixAppliedRef.current) return;
    autoFixAppliedRef.current = true;
    let yaml = localManifestYaml;
    const applied: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      const data = parseYamlToViewData(yaml);
      for (const v of data.validationItems) {
        if (v.status !== "pass" && canAutoFix(v)) {
          const patched = applyDeterministicFix(yaml, v);
          if (patched && patched !== yaml) {
            yaml = patched;
            applied.push(v.title);
            changed = true;
            break;
          }
        }
      }
    }
    if (yaml !== localManifestYaml) {
      setLocalManifestYaml(yaml);
      // Disclose, don't silently mutate — the fixpoint loop can apply the
      // same fix class more than once, so dedupe for display.
      setAppliedAutoFixes(Array.from(new Set(applied)));
      onYamlChange?.(yaml);
    }
  }, [localManifestYaml, onYamlChange, validationReport]);

  const viewData = useMemo(
    () => parseYamlToViewData(localManifestYaml),
    [localManifestYaml],
  );
  // Display projection: with a server report, the parser's connectivity FAILs
  // are advisory (they can't see the server-validated declared bindings), so
  // the Validation tab must agree with the approve gate below. Contexts and
  // score are untouched.
  const displayViewData = useMemo(
    () =>
      validationReport
        ? {
            ...viewData,
            validationItems: toAdvisoryValidationItems(
              viewData.validationItems,
            ),
          }
        : viewData,
    [viewData, validationReport],
  );
  const mermaidCode = useMemo(
    () => generateMermaidDiagram(viewData),
    [viewData],
  );

  const hasFailures = computeHasBlockingFailures(
    viewData,
    validationReport ?? null,
  );

  // Tab content, extracted so it mounts once whether or not the desktop
  // resizable-panel layout wraps it.
  const content = (
    <div
      className="flex-1 relative bg-background overflow-hidden h-full"
      style={{
        backgroundImage:
          "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      {activeTab === "context-map" && (
        <div className="absolute inset-0 overflow-auto custom-scrollbar">
          <ContextMapView viewData={viewData} isFullScreen={isFullScreen} />
        </div>
      )}
      {activeTab === "mermaid" && (
        <MermaidDiagramView mermaidCode={mermaidCode} />
      )}
      {activeTab === "validation" && (
        <div className="absolute inset-0 overflow-auto custom-scrollbar">
          {validationReport && (
            <div className="max-w-2xl mx-auto px-4 sm:px-8 pt-6">
              {/* The pipeline's own findings for exactly this YAML — the
                  authoritative report. The parser checks below are local
                  display heuristics (connectivity items advisory here). */}
              <ValidationFindingsPanel validationReport={validationReport} />
            </div>
          )}
          {!validationReport && appliedAutoFixes.length > 0 && (
            <div className="max-w-2xl mx-auto px-4 sm:px-8 pt-6">
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
                <p className="font-medium text-foreground">
                  {appliedAutoFixes.length === 1
                    ? "1 automatic adjustment was"
                    : `${appliedAutoFixes.length} automatic adjustments were`}{" "}
                  applied to make this manifest approvable
                </p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                  {appliedAutoFixes.map((title) => (
                    <li key={title}>• {title}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <ValidationReportView
            viewData={displayViewData}
            onRequestFix={(v) => setActiveFixViolation(v)}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex flex-col bg-background text-foreground overflow-hidden ${isFullScreen ? "fixed inset-0 z-50 w-screen h-screen" : embedded ? "relative w-full h-full" : "relative w-full rounded-xl border border-border"}`}
    >
      {/* Decorative ambient background */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-20 rounded-full bg-accent/5"
          style={{ width: 600, height: 600, filter: "blur(120px)" }}
        />
        <div
          className="absolute -bottom-40 -right-20 rounded-full bg-primary/5"
          style={{ width: 500, height: 500, filter: "blur(100px)" }}
        />
      </div>

      {!hideHeader && (
        <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 pl-5 pr-14 py-3 border-b border-border bg-surface shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" size="sm" onClick={onStartOver}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Start Over
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-base font-bold tracking-wide">
                  Generated Manifest
                </h1>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-mono ${viewData.overallScore >= 80 ? "bg-success/10 text-success border-success/20" : viewData.overallScore >= 50 ? "bg-warning/10 text-warning border-warning/20" : "bg-destructive/10 text-destructive border-destructive/20"} border`}
                >
                  {viewData.overallScore}% Score
                </span>
              </div>
              <p className="text-xs mt-0.5 text-muted-foreground font-mono">
                {viewData.system} &middot; {viewData.architecture} &middot;{" "}
                {viewData.contexts.length} contexts
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => {
                setActiveTab("context-map");
              }}
              className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "context-map" ? "bg-accent text-accent-foreground border border-accent" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
            >
              <Network className="w-3.5 h-3.5 mr-1.5" /> Context Map
            </button>
            <button
              onClick={() => setActiveTab("mermaid")}
              className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "mermaid" ? "bg-accent text-accent-foreground border border-accent" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
            >
              <Component className="w-3.5 h-3.5 mr-1.5" /> Mermaid
            </button>
            <button
              onClick={() => setActiveTab("validation")}
              className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "validation" ? "bg-accent text-accent-foreground border border-accent" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Validation
            </button>
          </div>
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="absolute right-3 top-3 flex items-center p-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
          >
            {isFullScreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </header>
      )}

      <main className="relative z-10 flex flex-1 overflow-hidden">
        {isDesktop ? (
          <>
            <PanelGroup
              direction="horizontal"
              // Bump the persistence key when the AI column is present so a saved
              // two-column layout can't strand the third panel at a stale size.
              autoSaveId={
                showContextChat
                  ? "manifest-preview-layout-ai"
                  : "manifest-preview-layout"
              }
              className="flex flex-1"
            >
              <Panel
                id="manifest-yaml"
                order={1}
                defaultSize={showContextChat ? 26 : 30}
                minSize={22}
                maxSize={60}
              >
                <ManifestYamlSidebar
                  yamlString={localManifestYaml}
                  viewData={viewData}
                />
              </Panel>
              <ManifestResizeHandle />
              <Panel
                id="manifest-content"
                order={2}
                defaultSize={showContextChat ? 46 : 70}
                minSize={35}
              >
                {content}
              </Panel>
              {showContextChat && (
                <>
                  <ManifestResizeHandle />
                  <Panel
                    id="manifest-ai-chat"
                    order={3}
                    ref={aiPanelRef}
                    defaultSize={AI_PANEL_DEFAULT_SIZE}
                    minSize={22}
                    maxSize={45}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => {
                      setAiCollapsed(true);
                      closeAiChat();
                    }}
                    onExpand={() => setAiCollapsed(false)}
                  >
                    <ContextGovernanceChatPanel
                      onRequestCollapse={collapseAiPanel}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
            {showContextChat && aiCollapsed && (
              <ContextChatCollapsedStrip onExpand={expandAiPanel} />
            )}
          </>
        ) : (
          content
        )}
      </main>

      {/* Mobile: no room for a third column, so the chat is a slide-in overlay.
          Exactly one of the panel/overlay mounts (by viewport), so the shared
          chat state lives in a single place. */}
      {showContextChat && !isDesktop && <ContextGovernanceChatDrawer />}

      <button
        type="button"
        onClick={() => setShowYamlMobile(!showYamlMobile)}
        className="md:hidden fixed bottom-16 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border shadow-lg text-xs font-medium text-foreground hover:bg-accent transition-colors"
        aria-label={showYamlMobile ? "Hide YAML" : "View YAML"}
        aria-expanded={showYamlMobile}
        aria-controls="yaml-mobile-overlay"
      >
        <FileCode className="w-4 h-4 text-accent" />
        {showYamlMobile ? "Hide YAML" : "YAML"}
      </button>

      {showYamlMobile && (
        <div
          id="yaml-mobile-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="YAML source"
          className="md:hidden fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground font-mono">
              manifest.yaml
            </span>
            <button
              type="button"
              onClick={() => setShowYamlMobile(false)}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              aria-label="Close YAML view"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed custom-scrollbar">
            <pre className="whitespace-pre text-foreground">
              {localManifestYaml}
            </pre>
          </div>
        </div>
      )}

      {!hideActions && (
        <footer className="relative z-10 flex items-center justify-between px-5 py-3 border-t border-border bg-surface shrink-0">
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onRegenerate}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Regenerate
            </Button>
          </div>
          <Button
            onClick={() => onApprove(localManifestYaml)}
            disabled={hasFailures || isApproveDisabled}
          >
            Use This Manifest <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </footer>
      )}

      <ManifestAutoFixDrawer
        isOpen={!!activeFixViolation}
        onClose={() => setActiveFixViolation(null)}
        violation={activeFixViolation}
        currentYaml={localManifestYaml}
        onApply={(patchedYaml) => {
          setLocalManifestYaml(patchedYaml);
          onYamlChange?.(patchedYaml);
          setActiveFixViolation(null);
        }}
      />
    </div>
  );
}
