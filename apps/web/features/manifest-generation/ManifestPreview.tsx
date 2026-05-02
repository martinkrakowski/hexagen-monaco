import { useState, useMemo } from "react";
import {
  Network,
  Hexagon,
  Component,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
  RefreshCw,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@hexagen/ui";
import { ManifestYamlSidebar } from "./ManifestYamlSidebar";
import { ContextMapView } from "./ContextMapView";
import { HexagonalArchitectureView } from "./HexagonalArchitectureView";
import { MermaidDiagramView } from "./MermaidDiagramView";
import { ValidationReportView } from "./ValidationReportView";
import { ManifestAutoFixDrawer } from "./ManifestAutoFixDrawer";
import type { ValidationItem } from "./manifest-view-data";
import { parseYamlToViewData } from "./parse-yaml-to-view-data";
import { generateMermaidDiagram } from "./generate-mermaid-diagram";

interface ManifestPreviewProps {
  manifestYaml: string;
  onApprove: (manifestYaml: string) => void;
  onRegenerate: () => void;
  onStartOver: () => void;
}

type ViewTab = "context-map" | "hexagonal" | "mermaid" | "validation";

export function ManifestPreview({
  manifestYaml,
  onApprove,
  onRegenerate,
  onStartOver,
}: ManifestPreviewProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("context-map");
  const [activeContext, setActiveContext] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Local state for manifest to allow inline auto-fixes
  const [localManifestYaml, setLocalManifestYaml] = useState(manifestYaml);
  const [activeFixViolation, setActiveFixViolation] =
    useState<ValidationItem | null>(null);

  // Sync with prop if parent regenerates
  useMemo(() => setLocalManifestYaml(manifestYaml), [manifestYaml]);

  const viewData = useMemo(
    () => parseYamlToViewData(localManifestYaml),
    [localManifestYaml],
  );
  const mermaidCode = useMemo(
    () => generateMermaidDiagram(viewData),
    [viewData],
  );

  const hasFailures = viewData.validationItems.some((v) => v.status === "fail");

  const handleSelectContext = (name: string) => {
    setActiveContext(name);
    setActiveTab("hexagonal");
  };

  return (
    <div
      className={`flex flex-col bg-background text-foreground overflow-hidden ${isFullScreen ? "fixed inset-0 z-50 w-screen h-screen" : "relative w-full rounded-xl border border-border"}`}
      style={!isFullScreen ? { height: "70vh", minHeight: "600px" } : undefined}
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

      <header className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onStartOver}>
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
        <div className="flex gap-1">
          <button
            onClick={() => {
              setActiveTab("context-map");
              setActiveContext(null);
            }}
            className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "context-map" ? "bg-accent/10 text-accent border border-accent/20" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
          >
            <Network className="w-3.5 h-3.5 mr-1.5" /> Context Map
          </button>
          <button
            onClick={() => setActiveTab("hexagonal")}
            className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "hexagonal" ? "bg-accent/10 text-accent border border-accent/20" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
          >
            <Hexagon className="w-3.5 h-3.5 mr-1.5" /> Hexagonal
          </button>
          <button
            onClick={() => setActiveTab("mermaid")}
            className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "mermaid" ? "bg-accent/10 text-accent border border-accent/20" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
          >
            <Component className="w-3.5 h-3.5 mr-1.5" /> Mermaid
          </button>
          <button
            onClick={() => setActiveTab("validation")}
            className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${activeTab === "validation" ? "bg-accent/10 text-accent border border-accent/20" : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"}`}
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Validation
          </button>

          <div className="w-px h-6 bg-border mx-1 self-center" />

          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="flex items-center px-3 py-1.5 rounded-md text-sm transition-colors text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
          >
            {isFullScreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 overflow-hidden">
        <ManifestYamlSidebar
          yamlString={localManifestYaml}
          viewData={viewData}
          activeContextName={activeTab === "hexagonal" ? activeContext : null}
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
              <ContextMapView
                viewData={viewData}
                onSelectContext={handleSelectContext}
              />
            </div>
          )}
          {activeTab === "hexagonal" && (
            <div className="absolute inset-0 overflow-auto custom-scrollbar">
              {activeContext ? (
                <HexagonalArchitectureView
                  context={
                    viewData.contexts.find((c) => c.name === activeContext)!
                  }
                  onBack={() => {
                    setActiveTab("context-map");
                    setActiveContext(null);
                  }}
                  onRequestFix={(v) =>
                    setActiveFixViolation(v as ValidationItem)
                  }
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a context from the map
                </div>
              )}
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

      <footer className="relative z-10 flex items-center justify-between px-5 py-3 border-t border-border bg-surface shrink-0">
        <div className="flex gap-3">
          <Button variant="outline" onClick={onRegenerate}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Regenerate
          </Button>
        </div>
        <Button
          onClick={() => onApprove(localManifestYaml)}
          disabled={hasFailures}
          className={
            !hasFailures
              ? "bg-gradient-to-br from-accent to-amber-600 text-black hover:shadow-lg hover:shadow-accent/30 transition-all"
              : ""
          }
        >
          Use This Manifest <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </footer>

      <ManifestAutoFixDrawer
        isOpen={!!activeFixViolation}
        onClose={() => setActiveFixViolation(null)}
        violation={activeFixViolation}
        currentYaml={localManifestYaml}
        onApply={(patchedYaml) => {
          setLocalManifestYaml(patchedYaml);
          setActiveFixViolation(null);
        }}
      />
    </div>
  );
}
