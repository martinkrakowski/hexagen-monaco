import { useEffect, useState, useRef } from "react";
import Script from "next/script";
import { Share2, Copy, Check } from "lucide-react";

interface MermaidDiagramViewProps {
  mermaidCode: string;
}

declare global {
  interface Window {
    mermaid: {
      initialize: (config: { startOnLoad: boolean; theme: string }) => void;
      render: (id: string, code: string) => Promise<{ svg: string }>;
    };
  }
}

export function MermaidDiagramView({ mermaidCode }: MermaidDiagramViewProps) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scriptLoaded || !window.mermaid) return;

    const renderDiagram = async () => {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
        });
        const id = `mermaid-${Date.now()}`;
        const { svg } = await window.mermaid.render(id, mermaidCode);
        setSvg(svg);
        setError(null);
      } catch {
        setError("Mermaid render issue — source code available below");
      }
    };

    renderDiagram();
  }, [mermaidCode, scriptLoaded]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <Script
        src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
      />

      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-card/85 backdrop-blur-md shrink-0">
        <Share2 className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">
          Mermaid Class Diagram
        </span>
        <button
          onClick={handleCopy}
          className="ml-auto flex items-center px-2 py-1 rounded text-xs font-medium text-muted-foreground bg-card border border-border hover:text-foreground hover:border-muted transition-colors font-mono"
        >
          {copied ? (
            <Check className="w-3 h-3 mr-1 text-success" />
          ) : (
            <Copy className="w-3 h-3 mr-1" />
          )}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        {error ? (
          <div className="text-warning text-sm flex items-center">{error}</div>
        ) : svg ? (
          <div
            ref={diagramRef}
            dangerouslySetInnerHTML={{ __html: svg }}
            className="w-full h-full flex justify-center [&>svg]:max-w-none [&>svg]:bg-transparent"
          />
        ) : (
          <div className="text-muted-foreground text-sm animate-pulse">
            Rendering...
          </div>
        )}
      </div>

      <div
        className="relative border-t border-border bg-surface shrink-0 overflow-hidden resize-y"
        style={{ height: "12rem", minHeight: "4rem", maxHeight: "60%" }}
      >
        <div className="absolute top-2 left-4 text-xs font-semibold text-muted-foreground font-mono tracking-wider">
          MERMAID SOURCE
        </div>
        <pre className="absolute inset-0 overflow-auto p-4 pt-8 font-mono text-xs text-muted-foreground leading-relaxed custom-scrollbar">
          {mermaidCode}
        </pre>
      </div>
    </div>
  );
}
