'use client';

import { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Card } from '@/components/ui/Card';
// import { cn } from '@/lib/utils';

interface ResizableLayoutProps {
  left: ReactNode;
  middle: ReactNode;
  right: ReactNode;
}

export function ResizableLayout({ left, middle, right }: ResizableLayoutProps) {
  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left Sidebar - Wizard */}
        <Panel defaultSize={25} minSize={15} maxSize={35}>
          <Card className="h-full overflow-auto border-r rounded-none">
            {left}
          </Card>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

        {/* Middle Pane - Main Content / Preview */}
        <Panel defaultSize={50} minSize={30}>
          <Card className="h-full overflow-auto rounded-none border-r">
            {middle}
          </Card>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

        {/* Right Sidebar - AI / Monaco */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <Card className="h-full overflow-auto rounded-none">{right}</Card>
        </Panel>
      </PanelGroup>
    </div>
  );
}
