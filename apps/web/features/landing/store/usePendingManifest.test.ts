import { describe, it, assert, afterEach } from "node:test";
import { usePendingManifest } from "./usePendingManifest";
import { ProjectSpec } from "@hexagen/project-configuration";

describe("usePendingManifest", () => {
  afterEach(() => {
    // Reset store after each test
    usePendingManifest.setState({
      yaml: null,
      formValues: null,
      projectName: null,
    });
  });

  it("should initialize with null values", () => {
    const store = usePendingManifest.getState();
    assert.strictEqual(store.yaml, null);
    assert.strictEqual(store.formValues, null);
    assert.strictEqual(store.projectName, null);
  });

  it("should set state with yaml, formValues, and projectName", () => {
    const yaml = "test: manifest";
    const formValues: ProjectSpec = {
      boundedContexts: [],
      externalContexts: [],
      governance: { workspaceName: "test-workspace" },
      peerMappings: [],
    };
    const projectName = "Test Project";

    usePendingManifest.getState().set(yaml, formValues, projectName);

    const store = usePendingManifest.getState();
    assert.strictEqual(store.yaml, yaml);
    assert.deepStrictEqual(store.formValues, formValues);
    assert.strictEqual(store.projectName, projectName);
  });

  it("should clear state back to null values", () => {
    const yaml = "test: manifest";
    const formValues: ProjectSpec = {
      boundedContexts: [],
      externalContexts: [],
      governance: { workspaceName: "test-workspace" },
      peerMappings: [],
    };
    const projectName = "Test Project";

    usePendingManifest.getState().set(yaml, formValues, projectName);
    usePendingManifest.getState().clear();

    const store = usePendingManifest.getState();
    assert.strictEqual(store.yaml, null);
    assert.strictEqual(store.formValues, null);
    assert.strictEqual(store.projectName, null);
  });

  it("should handle set/clear lifecycle correctly", () => {
    const formValues1: ProjectSpec = {
      boundedContexts: [],
      externalContexts: [],
      governance: { workspaceName: "workspace1" },
      peerMappings: [],
    };

    usePendingManifest.getState().set("yaml1", formValues1, "Project 1");
    assert.strictEqual(usePendingManifest.getState().projectName, "Project 1");

    usePendingManifest.getState().clear();
    assert.strictEqual(usePendingManifest.getState().projectName, null);

    const formValues2: ProjectSpec = {
      boundedContexts: [],
      externalContexts: [],
      governance: { workspaceName: "workspace2" },
      peerMappings: [],
    };

    usePendingManifest.getState().set("yaml2", formValues2, "Project 2");
    assert.strictEqual(usePendingManifest.getState().projectName, "Project 2");
  });

  it("should store complex ProjectSpec objects", () => {
    const complexFormValues: ProjectSpec = {
      boundedContexts: [
        {
          id: "auth-context",
          name: "Authentication",
          description: "Authentication context",
          infrastructureTarget: "nestjs",
          coreDomainEntities: ["User", "Role"],
          valueObjects: ["Email", "Password"],
          domainEvents: ["UserCreated", "UserAuthenticated"],
          portConfiguration: {
            inboundPorts: ["rest-controller", "event-listener"],
            outboundPorts: ["relational-db", "external-service-client"],
          },
        },
      ],
      externalContexts: [
        {
          id: "external-payment",
          name: "Payment Gateway",
          relationshipType: "OHS",
          isEventDriven: false,
          entityNames: ["Transaction"],
        },
      ],
      governance: {
        workspaceName: "My Workspace",
        workspaceTemplate: "modular-monolith",
        workspaceDescription: "Test workspace",
        packageManager: "yarn",
        topologyStrictness: "strict",
      },
      peerMappings: [
        {
          consumerContext: "auth-context",
          providerContext: "external-payment",
          integrationPattern: "acl",
          communicationBoundary: "networked",
        },
      ],
    };

    usePendingManifest
      .getState()
      .set("complex-yaml", complexFormValues, "Complex Project");

    const store = usePendingManifest.getState();
    assert.deepStrictEqual(store.formValues, complexFormValues);
    assert.strictEqual(store.projectName, "Complex Project");
    assert.strictEqual(store.yaml, "complex-yaml");
  });
});
