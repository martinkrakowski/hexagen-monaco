import { GraphCanvasWrapper } from '../components/canvas/GraphCanvasWrapper';

export default function ArchitectureViewerPage() {
  return (
    <div className="h-screen w-full">
      <GraphCanvasWrapper projectId="demo" />
    </div>
  );
}
