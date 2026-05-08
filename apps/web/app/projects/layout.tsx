import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HexaGen Monaco — Projects",
  description: "Select or create a hexagonal architecture project",
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground bg-ambient">
      {children}
    </div>
  );
}
