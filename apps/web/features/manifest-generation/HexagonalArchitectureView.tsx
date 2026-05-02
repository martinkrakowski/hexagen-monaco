import {
  ArrowLeft,
  ArrowRight,
  Plug,
  AlertTriangle,
  HelpCircle,
  Cuboid,
} from "lucide-react";
import type { BoundedContextView } from "./manifest-view-data";

interface HexagonalArchitectureViewProps {
  context: BoundedContextView;
  onBack: () => void;
  onRequestFix?: (violation: {
    title: string;
    description: string;
    contextName: string;
  }) => void;
}

export function HexagonalArchitectureView({
  context,
  onBack,
  onRequestFix,
}: HexagonalArchitectureViewProps) {
  const isError = context.health === "error";
  const okPortsOut = context.portsOut.filter((p) => !p.hasIssue).length;

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-card/85 backdrop-blur-md shrink-0">
        <button
          onClick={onBack}
          className="flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground bg-card border border-border hover:text-foreground hover:border-muted transition-colors"
        >
          <ArrowLeft className="w-3 h-3 mr-1" /> Map
        </button>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-semibold text-foreground">
          <span style={{ color: context.colorToken }}>{context.name}</span>{" "}
          <span className="text-muted-foreground">— {context.type} domain</span>
        </span>
        {isError && (
          <span className="ml-auto text-xs px-2 py-1 rounded bg-destructive/10 border border-destructive/20 text-destructive font-mono flex items-center">
            <AlertTriangle className="w-3 h-3 mr-1" />{" "}
            {context.portsOut.length - okPortsOut} unconnected ports
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto animate-fade-in-up">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-lg border flex items-center justify-center"
              style={{
                backgroundColor: `color-mix(in srgb, ${context.colorToken} 10%, transparent)`,
                borderColor: `color-mix(in srgb, ${context.colorToken} 20%, transparent)`,
              }}
            >
              <Cuboid
                style={{ color: context.colorToken, width: 28, height: 28 }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  className="text-lg font-bold"
                  style={{ color: context.colorToken }}
                >
                  {context.name}
                </h2>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded font-mono tracking-wider uppercase"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${context.colorToken} 10%, transparent)`,
                    color: context.colorToken,
                  }}
                >
                  {context.type}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {context.description}
              </p>
            </div>
          </div>

          <div className="flex gap-5 items-stretch">
            {/* LEFT: Ports In */}
            <div className="flex-1 rounded-xl p-4 bg-card border border-border">
              <div className="text-xs font-bold mb-3 flex items-center gap-2 text-success font-mono tracking-wider uppercase">
                <ArrowRight className="w-3 h-3" /> APPLICATION PORTS IN
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-success/10 text-success">
                  {context.portsIn.length}
                </span>
              </div>
              <div className="space-y-2">
                {context.portsIn.map((p, i) => (
                  <div
                    key={p.name}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border animate-fade-in-up ${p.hasIssue ? "bg-destructive/5 border-destructive/10" : "bg-success/5 border-success/10"}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div
                      className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${p.hasIssue ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-semibold truncate font-mono ${p.hasIssue ? "text-destructive" : "text-foreground"}`}
                      >
                        {p.name.replace(/Port$/, "")}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {p.name}
                      </div>
                      {p.hasIssue && (
                        <div className="text-xs mt-0.5 text-destructive/80 flex items-center">
                          <AlertTriangle className="w-3 h-3 mr-1" />{" "}
                          {p.issueMessage}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-success/25" />
                  </div>
                ))}
              </div>
            </div>

            {/* CENTER: Hexagon */}
            <div className="flex flex-col items-center justify-center w-48 shrink-0">
              <svg width="180" height="200" viewBox="0 0 180 200">
                <polygon
                  points="90,8 165,47 165,133 90,172 15,133 15,47"
                  fill="none"
                  stroke={context.colorToken}
                  strokeOpacity=".1"
                  strokeWidth="1"
                />
                <polygon
                  points="90,22 152,55 152,135 90,168 28,135 28,55"
                  fill={`color-mix(in srgb, ${context.colorToken} 5%, transparent)`}
                  stroke={context.colorToken}
                  strokeOpacity=".4"
                  strokeWidth="1.5"
                />
                <polygon
                  points="90,52 125,72 125,118 90,138 55,118 55,72"
                  fill={`color-mix(in srgb, ${context.colorToken} 7%, transparent)`}
                  stroke={context.colorToken}
                  strokeOpacity=".15"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                <text
                  x="90"
                  y="92"
                  textAnchor="middle"
                  fill={context.colorToken}
                  fontSize="8.5"
                  className="font-sans font-semibold tracking-widest"
                >
                  DOMAIN
                </text>
                <text
                  x="90"
                  y="104"
                  textAnchor="middle"
                  fill={context.colorToken}
                  fontSize="8.5"
                  className="font-sans font-semibold tracking-widest"
                >
                  CORE
                </text>
                <text
                  x="90"
                  y="120"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.6"
                  fontSize="7"
                  className="font-mono"
                >
                  {context.name.length > 18
                    ? context.name.slice(0, 18) + "..."
                    : context.name}
                </text>
              </svg>
              <div className="text-xs text-center mt-2 text-muted-foreground font-mono">
                Dependency direction →
              </div>
            </div>

            {/* RIGHT: Ports Out */}
            <div className="flex-1 rounded-xl p-4 bg-card border border-border">
              <div className="text-xs font-bold mb-3 flex items-center gap-2 text-info font-mono tracking-wider uppercase">
                <ArrowLeft className="w-3 h-3" /> PORTS OUT & ADAPTERS
                <span
                  className={`ml-auto text-xs px-1.5 py-0.5 rounded ${isError ? "bg-destructive/10 text-destructive" : "bg-info/10 text-info"}`}
                >
                  {okPortsOut}/{context.portsOut.length}
                </span>
              </div>
              <div className="space-y-2">
                {context.portsOut.map((p, i) => {
                  const implementingAdapter = context.adapters.find(
                    (a) => a.implements === p.name,
                  );
                  return (
                    <div
                      key={p.name}
                      className={`px-3 py-2.5 rounded-lg border animate-fade-in-up ${p.hasIssue ? "bg-destructive/5 border-destructive border-dashed" : "bg-success/5 border-success/10"}`}
                      style={{ animationDelay: `${100 + i * 80}ms` }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <ArrowLeft
                          className={`w-3 h-3 ${p.hasIssue ? "text-destructive" : "text-info"}`}
                        />
                        <span
                          className={`text-xs font-semibold font-mono ${p.hasIssue ? "text-destructive" : "text-foreground"}`}
                        >
                          {p.name.replace(/Port$/, "")}
                        </span>
                      </div>
                      {implementingAdapter ? (
                        <div className="flex items-center gap-2 ml-5 px-3 py-2 rounded-lg bg-surface border border-border">
                          <div className="w-7 h-7 rounded-md bg-info/10 flex items-center justify-center shrink-0">
                            <Plug className="w-3.5 h-3.5 text-info" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate font-mono text-info">
                              {implementingAdapter.name}
                            </div>
                          </div>
                          <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-success/10 text-success font-mono uppercase">
                            Connected
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 ml-5 px-3 py-2.5 rounded-lg bg-destructive/5 border border-dashed border-destructive/20">
                          <div className="w-7 h-7 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                            <HelpCircle className="w-3.5 h-3.5 text-destructive/50" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold font-mono text-destructive">
                              NO ADAPTER
                            </div>
                            <div className="text-xs text-muted-foreground">
                              No infrastructure adapter defined
                            </div>
                          </div>
                          {onRequestFix ? (
                            <button
                              onClick={() =>
                                onRequestFix({
                                  title: "Missing Adapter",
                                  description: `No infrastructure adapter defined for port: ${p.name}`,
                                  contextName: context.name,
                                })
                              }
                              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded bg-accent/10 hover:bg-accent/20 text-accent text-xs font-semibold transition-colors"
                            >
                              ✨ Fix
                            </button>
                          ) : (
                            <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-mono">
                              MISSING
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
