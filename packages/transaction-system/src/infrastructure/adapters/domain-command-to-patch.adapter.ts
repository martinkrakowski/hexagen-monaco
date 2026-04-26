import type {
  DomainCommand,
  CreateNodeCommand,
  UpdateNodeCommand,
  DeleteNodeCommand,
  CreateEdgeCommand,
  UpdateEdgeCommand,
  DeleteEdgeCommand,
} from "@hexagen/core-domain";
import {
  isCreateNodeCommand,
  isUpdateNodeCommand,
  isDeleteNodeCommand,
  isCreateEdgeCommand,
  isUpdateEdgeCommand,
  isDeleteEdgeCommand,
  isBatchCommand,
} from "@hexagen/core-domain";
import type { Patch } from "@hexagen/core-domain";
import { createPatch } from "@hexagen/core-domain";

export class DomainCommandToManifestPatchAdapter {
  convert(commands: DomainCommand[]): Patch[] {
    const patches: Patch[] = [];
    for (const command of commands) {
      this.convertOne(command, patches);
    }
    return patches;
  }

  private convertOne(command: DomainCommand, out: Patch[]): void {
    if (isBatchCommand(command)) {
      for (const sub of command.payload.commands) {
        this.convertOne(sub, out);
      }
      return;
    }

    if (isCreateNodeCommand(command)) {
      out.push(this.mapCreateNode(command));
    } else if (isUpdateNodeCommand(command)) {
      out.push(this.mapUpdateNode(command));
    } else if (isDeleteNodeCommand(command)) {
      out.push(this.mapDeleteNode(command));
    } else if (isCreateEdgeCommand(command)) {
      out.push(this.mapCreateEdge(command));
    } else if (isUpdateEdgeCommand(command)) {
      out.push(this.mapUpdateEdge(command));
    } else if (isDeleteEdgeCommand(command)) {
      out.push(this.mapDeleteEdge(command));
    }
  }

  private mapCreateNode(cmd: CreateNodeCommand): Patch {
    return createPatch("add_node", cmd.payload.kind as string, {
      kind: cmd.payload.kind,
      attributes: cmd.payload.attributes,
    });
  }

  private mapUpdateNode(cmd: UpdateNodeCommand): Patch {
    return createPatch("update_node", cmd.payload.nodeId, {
      attributes: cmd.payload.attributes,
    });
  }

  private mapDeleteNode(cmd: DeleteNodeCommand): Patch {
    return createPatch("remove_node", cmd.payload.nodeId, {});
  }

  private mapCreateEdge(cmd: CreateEdgeCommand): Patch {
    return createPatch(
      "add_edge",
      `${cmd.payload.source}-${cmd.payload.target}`,
      {
        kind: cmd.payload.kind,
        source: cmd.payload.source,
        target: cmd.payload.target,
        attributes: cmd.payload.attributes,
      },
    );
  }

  private mapUpdateEdge(cmd: UpdateEdgeCommand): Patch {
    return createPatch("update_edge", cmd.payload.edgeId, {
      attributes: cmd.payload.attributes,
    });
  }

  private mapDeleteEdge(cmd: DeleteEdgeCommand): Patch {
    return createPatch("remove_edge", cmd.payload.edgeId, {});
  }
}
