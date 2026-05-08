import Link from "next/link";

export function PreviousProjectsSection() {
  return (
    <div>
      <Link
        href="/projects"
        className="inline-flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>View Previous Projects</span>
      </Link>
    </div>
  );
}
