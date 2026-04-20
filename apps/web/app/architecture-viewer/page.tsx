import type { Metadata } from "next";
import { GraphCanvasWrapper } from "../components/canvas/GraphCanvasWrapper";

export const metadata: Metadata = {
  title: "HexaGen Monaco — Architecture Viewer",
  description: "Visualize bounded contexts and hexagonal architecture graphs",
};

export default function ArchitectureViewerPage() {
  return (
    <div className="h-screen w-full">
      <GraphCanvasWrapper projectId="demo" />
    </div>
  );
}
