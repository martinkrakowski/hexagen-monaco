import { useMemo } from "react";
import { FileCode } from "lucide-react";
import type { ManifestViewData, ValidationItem } from "./manifest-view-data";

interface ManifestYamlSidebarProps {
  yamlString: string;
  viewData: ManifestViewData;
  activeContextName?: string | null;
}

export function ManifestYamlSidebar({
  yamlString,
  viewData,
  activeContextName,
}: ManifestYamlSidebarProps) {
  const lines = useMemo(() => yamlString.split("\n"), [yamlString]);

  const lineNotes = useMemo(() => {
    const notes = new Map<number, ValidationItem>();
    lines.forEach((line, index) => {
      viewData.validationItems.forEach((item) => {
        if (item.status === "pass") return;
        if (item.contextName && line.includes(item.contextName)) {
          if (!notes.has(index)) notes.set(index, item);
        }
        if (line.includes("!") && item.title.includes("YAML Tag")) {
          if (!notes.has(index)) notes.set(index, item);
        }
      });
    });
    return notes;
  }, [lines, viewData.validationItems]);

  const activeContext = viewData.contexts.find(
    (c) => c.name === activeContextName,
  );
  const activeRange = activeContext?.yamlLineRange;

  return (
    <aside
      className="flex flex-col border-r border-border bg-sidebar shrink-0 overflow-hidden resize-x"
      style={{ width: "24rem", minWidth: "16rem", maxWidth: "60%" }}
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <FileCode className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-muted-foreground font-mono">
          manifest.yaml
        </span>
        <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-card text-muted-foreground font-mono">
          read-only
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed custom-scrollbar">
        {lines.map((line, i) => {
          const note = lineNotes.get(i);
          const isHL =
            activeRange && i >= activeRange.start && i <= activeRange.end;
          const hlCls = isHL
            ? activeContext?.health === "error"
              ? "manifest-yaml-hl-error"
              : "manifest-yaml-hl"
            : "";

          let gutClass = "";
          let gutIcon = "";
          let gutTooltip = "";

          if (note) {
            gutClass =
              note.status === "fail"
                ? "manifest-yaml-gut-error"
                : "manifest-yaml-gut-warn";
            gutIcon = note.status === "fail" ? "●" : "○";
            gutTooltip = note.description;
          }

          let hlLine = escapeHtml(line);
          if (hlLine.trim().startsWith("#")) {
            hlLine = `<span class="text-muted-foreground">${hlLine}</span>`;
          } else {
            hlLine = hlLine.replace(
              /!/g,
              '<span class="font-bold bg-destructive/10 text-destructive px-[2px] rounded-[2px]">!</span>',
            );
            hlLine = hlLine.replace(
              /"([^"]+)"/g,
              '<span class="text-destructive">"$1"</span>',
            );
            hlLine = hlLine.replace(
              /^(\s*)([\w_-]+)(:)/,
              '$1<span class="text-cyan-400">$2</span><span class="text-muted-foreground">$3</span>',
            );
            hlLine = hlLine.replace(
              /^(\s*)(- )/g,
              '$1<span class="text-foreground">$2</span>',
            );
          }

          return (
            <div key={i} className={`manifest-yaml-line ${hlCls}`}>
              <span className="manifest-yaml-ln">{i + 1}</span>
              <span
                className={`manifest-yaml-gut cursor-help ${gutClass}`}
                title={gutTooltip}
              >
                {gutIcon}
              </span>
              <span
                className="flex-1 whitespace-pre"
                dangerouslySetInnerHTML={{ __html: hlLine }}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
