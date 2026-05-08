import { Card, CardContent } from "@hexagen/ui";

interface ProjectsShellProps {
  title?: string;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function ProjectsShell({
  title,
  headerContent,
  children,
  footer,
}: ProjectsShellProps) {
  return (
    <Card className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/30 shrink-0 h-12">
        {headerContent ?? (
          <span className="font-semibold text-sm truncate">{title}</span>
        )}
      </div>
      <CardContent className="flex-1 min-h-0 overflow-y-auto p-0">
        {children}
      </CardContent>
      {footer && (
        <footer className="shrink-0 bg-background border-t border-border p-4 flex justify-between items-center">
          {footer}
        </footer>
      )}
    </Card>
  );
}
