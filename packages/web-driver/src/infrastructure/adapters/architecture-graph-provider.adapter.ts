import type {
  IArchitectureGraphProviderPort,
  ArchitectureGraphData,
} from "@hexagen/visualization";
import type { Result } from "@hexagen/visualization";

const DEMO_DATA: ArchitectureGraphData = {
  nodes: [
    { id: "bc-user-mgmt", label: "User Management", type: "bounded-context", position: { x: 0, y: 0 } },
    { id: "entity-user", label: "User", type: "entity", position: { x: 0, y: 0 } },
    { id: "entity-role", label: "Role", type: "entity", position: { x: 0, y: 0 } },
    { id: "uc-register", label: "Register User", type: "use-case", position: { x: 0, y: 0 } },
    { id: "uc-assign-role", label: "Assign Role", type: "use-case", position: { x: 0, y: 0 } },
    { id: "port-user-repo", label: "UserRepository", type: "port", position: { x: 0, y: 0 } },
    { id: "port-notify", label: "NotificationPort", type: "port", position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "bc-user-mgmt", target: "uc-register", type: "default" },
    { id: "e2", source: "bc-user-mgmt", target: "uc-assign-role", type: "default" },
    { id: "e3", source: "uc-register", target: "entity-user", type: "default" },
    { id: "e4", source: "uc-assign-role", target: "entity-user", type: "default" },
    { id: "e5", source: "uc-assign-role", target: "entity-role", type: "default" },
    { id: "e6", source: "uc-register", target: "port-user-repo", type: "animated" },
    { id: "e7", source: "uc-register", target: "port-notify", type: "animated" },
  ],
};

export class ArchitectureGraphProviderAdapter implements IArchitectureGraphProviderPort {
  async getArchitectureGraph(
    projectId: string,
  ): Promise<Result<ArchitectureGraphData, Error>> {
    if (projectId === "demo") {
      return { success: true, data: DEMO_DATA };
    }
    return { success: false, error: new Error(`Project "${projectId}" not found`) };
  }
}
