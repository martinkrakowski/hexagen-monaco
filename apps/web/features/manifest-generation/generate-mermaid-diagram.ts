import type { ManifestViewData } from "@hexagen/manifest-generation";

export function generateMermaidDiagram(viewData: ManifestViewData): string {
  let c = `%%{init:{"theme":"dark","themeVariables":{"primaryColor":"#111c30","primaryTextColor":"#f1f5f9","primaryBorderColor":"#1a2744","lineColor":"#334155","secondaryColor":"#0c1322","tertiaryColor":"#060b14","background":"#060b14","mainBkg":"#111c30","nodeBorder":"#334155","clusterBkg":"#0c1322","clusterBorder":"#1a2744","edgeLabelBackground":"#111c30","fontFamily":"Outfit","fontSize":"12px"}}}%%\nclassDiagram\n\n`;

  viewData.contexts.forEach((ctx) => {
    const s = ctx.name.replace(/[^a-zA-Z0-9]/g, "_");
    c += `    class ${s} {\n`;
    c += `        <<Bounded Context>>\n`;
    c += `        <<${ctx.type}>>\n`;
    c += `        -- Ports In --\n`;
    ctx.portsIn.forEach((p) => {
      c += `        +${p.hasIssue ? "[!] " : ""}${p.name}\n`;
    });
    c += `        -- Ports Out --\n`;
    ctx.portsOut.forEach((p) => {
      const adapter = ctx.adapters.find((a) => a.implements === p.name);
      c += `        -${p.name}${adapter ? " -> " + adapter.name : " -> [MISSING]"}\n`;
    });
    c += `    }\n\n`;
  });

  return c;
}
