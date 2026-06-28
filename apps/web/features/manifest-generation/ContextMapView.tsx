import {
  ArrowRight,
  ArrowLeft,
  Cuboid,
  Plug,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import type { ManifestViewData } from "@hexagen/manifest-generation";
import { useContextChatPanel } from "./store/useContextChatPanel";

interface ContextMapViewProps {
  viewData: ManifestViewData;
  isFullScreen?: boolean;
}

export function ContextMapView({
  viewData,
  isFullScreen,
}: ContextMapViewProps) {
  const openChat = useContextChatPanel((s) => s.open);
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6 animate-fade-in-up">
        <span className="text-xs font-semibold px-2 py-1 rounded bg-card text-muted-foreground font-mono tracking-widest uppercase">
          SCOPE: {viewData.scope || "UNKNOWN"} &middot;{" "}
          {viewData.architecture || "MODULAR-MONOLITH"}
        </span>
      </div>
      <div
        className={`grid gap-6 ${isFullScreen ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}
      >
        {viewData.contexts.map((ctx, ctxIndex) => {
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
              key={`${ctx.name}-${ctxIndex}`}
              role="button"
              tabIndex={0}
              onClick={() => openChat(ctx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openChat(ctx);
                }
              }}
              aria-label={`Ask AI about the ${ctx.name} context`}
              className={`rounded-lg p-4 bg-card border ${cardBorder} transition-all duration-200 shadow-sm animate-fade-in-up cursor-pointer hover:border-info/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-info`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold px-2 py-1 rounded-sm font-mono tracking-wider uppercase text-info bg-info/10">
                  {ctx.type}
                </span>
                <div className="flex items-center gap-2">
                  {hasBang && (
                    <span className="text-xs px-2 py-1 rounded-sm bg-destructive/10 text-destructive font-mono">
                      !
                    </span>
                  )}
                  {/* AI affordance: health-tinted so it doubles as the status
                      cue the old pulsing dot carried (card border + "!" badge
                      also reflect health). Clicking the card asks the AI. */}
                  <Sparkles
                    aria-hidden="true"
                    className={`w-4 h-4 animate-soft-pulse ${isError ? "text-destructive" : isWarn ? "text-warning" : "text-success"}`}
                  />
                </div>
              </div>
              <h3 className="text-sm font-bold mb-1 text-foreground">
                {ctx.name}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {ctx.description}
              </p>

              <div className="mb-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-2 text-success font-mono tracking-wider">
                  <ArrowRight className="w-3 h-3" /> PORTS IN (
                  {ctx.portsIn.length})
                </div>
                <div className="space-y-1">
                  {ctx.portsIn.map((p, pi) => (
                    <div
                      key={`in-${p.name}-${pi}`}
                      className={`text-xs px-2 py-1 rounded-sm border font-mono ${p.hasIssue ? "bg-destructive/5 border-destructive/10 text-destructive" : "bg-success/5 border-success/10 text-muted-foreground"}`}
                    >
                      <div className="flex items-center">
                        <ArrowRight
                          className={`w-3 h-3 mr-2 ${p.hasIssue ? "text-destructive" : "text-success"}`}
                        />
                        {p.name}
                      </div>
                      {p.hasIssue && (
                        <span className="text-xs mt-1 text-destructive/80 block ml-4 opacity-80">
                          {p.issueMessage}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="text-xs font-semibold mb-2 flex items-center gap-2 text-info font-mono tracking-wider uppercase">
                  <ArrowLeft className="w-3 h-3" /> PORTS OUT ({okPortsOutCount}
                  /{ctx.portsOut.length} connected)
                </div>
                <div className="space-y-1">
                  {ctx.portsOut.map((p, pi) => (
                    <div
                      key={`out-${p.name}-${pi}`}
                      className={`text-xs px-2 py-1 rounded-sm border ${p.hasIssue ? "bg-destructive/5 border-destructive/10" : "bg-info/5 border-info/10"}`}
                    >
                      <div
                        className={`font-mono flex items-center ${p.hasIssue ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        <ArrowLeft
                          className={`w-3 h-3 mr-2 ${p.hasIssue ? "text-destructive" : "text-info"}`}
                        />
                        {p.name}
                      </div>
                      {!p.hasIssue ? (
                        <div className="text-xs mt-1 ml-4 font-mono text-muted-foreground flex items-center">
                          <Plug className="w-3 h-3 mr-1" />
                          {ctx.adapters.find((a) => a.implements === p.name)
                            ?.name || "UNKNOWN"}
                        </div>
                      ) : (
                        <div className="text-xs mt-1 ml-4 font-mono text-destructive/80 flex items-center">
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
                  <div className="text-xs font-semibold mb-2 flex items-center gap-2 text-info font-mono tracking-wider uppercase">
                    <Cuboid className="w-3 h-3" /> ADAPTERS (
                    {ctx.adapters.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ctx.adapters.map((a, i) => (
                      <span
                        key={`${a.name}-${a.implements}-${i}`}
                        className="text-xs px-2 py-1 rounded-sm border bg-card border-border font-mono text-muted-foreground"
                      >
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs px-3 py-2 rounded border border-dashed bg-destructive/5 border-destructive/20 text-destructive font-mono flex items-center">
                  <Cuboid className="w-3 h-3 mr-2" /> No adapters defined
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
