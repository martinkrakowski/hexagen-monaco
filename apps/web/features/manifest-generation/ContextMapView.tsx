import {
  ArrowRight,
  ArrowLeft,
  Cuboid,
  Plug,
  AlertTriangle,
} from "lucide-react";
import type { ManifestViewData } from "./manifest-view-data";

interface ContextMapViewProps {
  viewData: ManifestViewData;
  onSelectContext: (name: string) => void;
  isFullScreen?: boolean;
}

export function ContextMapView({
  viewData,
  onSelectContext,
  isFullScreen,
}: ContextMapViewProps) {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6 animate-fade-in-up">
        <span className="text-xs font-semibold px-2 py-1 rounded bg-card text-muted-foreground font-mono tracking-widest uppercase">
          SCOPE: {viewData.scope || "UNKNOWN"} &middot;{" "}
          {viewData.architecture || "MODULAR-MONOLITH"}
        </span>
      </div>
      <div
        className={`grid gap-5 ${isFullScreen ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}
      >
        {viewData.contexts.map((ctx, index) => {
          const isError = ctx.health === "error";
          const isWarn = ctx.health === "warning";
          const hasBang =
            ctx.portsIn.some((p) => p.hasIssue) ||
            ctx.portsOut.some((p) => p.hasIssue);
          const okPortsOutCount = ctx.portsOut.filter(
            (p) => !p.hasIssue,
          ).length;

          let cardBorder = "border-border";
          if (isError) cardBorder = "border-destructive/20";
          else if (isWarn) cardBorder = "border-warning/30";

          return (
            <div
              key={ctx.name}
              className={`rounded-xl p-5 bg-card border ${cardBorder} cursor-pointer transition-all duration-200 hover:scale-[1.01] shadow-sm hover:shadow-md animate-fade-in-up`}
              style={{ animationDelay: `${index * 80}ms` }}
              onClick={() => onSelectContext(ctx.name)}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded font-mono tracking-wider uppercase"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${ctx.colorToken} 10%, transparent)`,
                    color: ctx.colorToken,
                  }}
                >
                  {ctx.type}
                </span>
                <div className="flex items-center gap-2">
                  {hasBang && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-mono">
                      !
                    </span>
                  )}
                  <span
                    className={`w-2 h-2 rounded-full animate-soft-pulse ${isError ? "bg-destructive" : isWarn ? "bg-warning" : "bg-success"}`}
                  ></span>
                </div>
              </div>
              <h3
                className="text-sm font-bold mb-1"
                style={{ color: ctx.colorToken }}
              >
                {ctx.name}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {ctx.description}
              </p>

              <div className="mb-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-success font-mono tracking-wider">
                  <ArrowRight className="w-3 h-3" /> PORTS IN (
                  {ctx.portsIn.length})
                </div>
                <div className="space-y-1">
                  {ctx.portsIn.map((p) => (
                    <div
                      key={p.name}
                      className={`text-xs px-2 py-1 rounded border font-mono ${p.hasIssue ? "bg-destructive/5 border-destructive/10 text-destructive" : "bg-success/5 border-success/10 text-muted-foreground"}`}
                    >
                      <div className="flex items-center">
                        <ArrowRight
                          className={`w-3 h-3 mr-1.5 ${p.hasIssue ? "text-destructive" : "text-success"}`}
                        />
                        {p.name}
                      </div>
                      {p.hasIssue && (
                        <span className="text-xs mt-0.5 text-destructive/80 block ml-4 opacity-80">
                          {p.issueMessage}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-info font-mono tracking-wider uppercase">
                  <ArrowLeft className="w-3 h-3" /> PORTS OUT ({okPortsOutCount}
                  /{ctx.portsOut.length} connected)
                </div>
                <div className="space-y-1">
                  {ctx.portsOut.map((p) => (
                    <div
                      key={p.name}
                      className={`text-xs px-2 py-1.5 rounded border ${p.hasIssue ? "bg-destructive/5 border-destructive/10" : "bg-info/5 border-info/10"}`}
                    >
                      <div
                        className={`font-mono flex items-center ${p.hasIssue ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        <ArrowLeft
                          className={`w-3 h-3 mr-1.5 ${p.hasIssue ? "text-destructive" : "text-info"}`}
                        />
                        {p.name}
                      </div>
                      {!p.hasIssue ? (
                        <div className="text-xs mt-0.5 ml-5 font-mono text-muted-foreground flex items-center">
                          <Plug className="w-3 h-3 mr-1" />
                          {ctx.adapters.find((a) => a.implements === p.name)
                            ?.name || "UNKNOWN"}
                        </div>
                      ) : (
                        <div className="text-xs mt-0.5 ml-5 font-mono text-destructive/80 flex items-center">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          NO ADAPTER DEFINED
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {ctx.adapters.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-info font-mono tracking-wider uppercase">
                    <Cuboid className="w-3 h-3" /> ADAPTERS (
                    {ctx.adapters.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ctx.adapters.map((a) => (
                      <span
                        key={a.name}
                        className="text-xs px-2 py-0.5 rounded border bg-card border-border font-mono text-muted-foreground"
                      >
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs px-3 py-2 rounded border border-dashed bg-destructive/5 border-destructive/20 text-destructive font-mono flex items-center">
                  <Cuboid className="w-3 h-3 mr-1.5" /> No adapters defined
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
