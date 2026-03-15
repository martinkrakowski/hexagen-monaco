import { GraphCanvasWrapper } from "../components/canvas/graph-canvas-wrapper";

export default function ArchitectureViewerPage() {
  return (
    <div className="h-screen w-full">
      <GraphCanvasWrapper projectId="demo" />
    </div>
  );
}
