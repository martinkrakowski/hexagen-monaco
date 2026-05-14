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
import { ContextMapView } from "./ContextMapView";
import { MermaidDiagramView } from "./MermaidDiagramView";
import { ValidationReportView } from "./ValidationReportView";
import { ManifestAutoFixDrawer } from "./ManifestAutoFixDrawer";
import type { ValidationItem } from "@hexagen/manifest-generation";
import {
  parseYamlToViewData,
  canAutoFix,
  applyDeterministicFix,
} from "@hexagen/manifest-generation";
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
}

export type ViewTab = "context-map" | "mermaid" | "validation";

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
}: ManifestPreviewProps) {
  const [internalActiveTab, setInternalActiveTab] =
    useState<ViewTab>("context-map");
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showYamlMobile, setShowYamlMobile] = useState(false);

  // Local state for manifest to allow inline auto-fixes
  const [localManifestYaml, setLocalManifestYaml] = useState(manifestYaml);
  const [activeFixViolation, setActiveFixViolation] =
    useState<ValidationItem | null>(null);

  const autoFixAppliedRef = useRef(false);
  useEffect(() => {
    setLocalManifestYaml(manifestYaml);
    autoFixAppliedRef.current = false;
  }, [manifestYaml]);
  useEffect(() => {
    if (autoFixAppliedRef.current) return;
    autoFixAppliedRef.current = true;
    let yaml = localManifestYaml;
    let changed = true;
    while (changed) {
      changed = false;
      const data = parseYamlToViewData(yaml);
      for (const v of data.validationItems) {
        if (v.status !== "pass" && canAutoFix(v)) {
          const patched = applyDeterministicFix(yaml, v);
          if (patched && patched !== yaml) {
            yaml = patched;
            changed = true;
            break;
          }
        }
      }
    }
    if (yaml !== localManifestYaml) {
      setLocalManifestYaml(yaml);
      onYamlChange?.(yaml);
    }
  }, [localManifestYaml, onYamlChange]);

  const viewData = useMemo(
    () => parseYamlToViewData(localManifestYaml),
    [localManifestYaml],
  );
  const mermaidCode = useMemo(
    () => generateMermaidDiagram(viewData),
    [viewData],
  );

  const hasFailures = viewData.validationItems.some((v) => v.status === "fail");

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

      <main className="relative z-10 flex flex-col md:flex-row flex-1 overflow-hidden">
        <ManifestYamlSidebar
          yamlString={localManifestYaml}
          viewData={viewData}
        />

        <div
          className="flex-1 relative bg-background overflow-hidden"
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
              <ValidationReportView
                viewData={viewData}
                onRequestFix={(v) => setActiveFixViolation(v)}
              />
            </div>
          )}
        </div>
      </main>

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
