import React from "react";
import { render } from "ink";
import { BrownfieldView } from "./BrownfieldView.js";

/**
 * Starts the brownfield view. Imports nothing that talks to the MCP server,
 * the network or the filesystem for writing.
 */
export function startBrownfield(workspaceRoot: string): void {
  const app = render(
    <BrownfieldView
      workspaceRoot={workspaceRoot}
      interactive={Boolean(process.stdin.isTTY)}
      onQuit={() => {
        app.unmount();
        process.exit(0);
      }}
    />,
  );
}
