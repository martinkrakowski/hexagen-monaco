import { renderHook, act } from "@testing-library/react";
import { useManifestParser } from "./useManifestParser";

describe("useManifestParser", () => {
  const validManifestYaml = `
system: test-system
scope: "@hexagen/test"
architecture: "modular-monolith"
bounded_contexts:
  - name: "UserContext"
    description: "Handles user management"
    layers:
      domain:
        entities: ["User", "Profile"]
        value_objects: ["EmailAddress"]
      application:
        use_cases: ["CreateUser", "UpdateUser"]
        ports:
          in: ["rest-controller"]
          out: ["relational-db"]
      infrastructure:
        adapters: ["Prisma"]
`;

  it("should start in idle state", () => {
    const { result } = renderHook(() => useManifestParser());
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("should parse manifest successfully", async () => {
    const { result } = renderHook(() => useManifestParser());
    
    await act(async () => {
      result.current.parseManifest(validManifestYaml);
    });
    
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBeDefined();
    expect(result.current.result?.boundedContexts).toHaveLength(1);
    expect(result.current.result?.boundedContexts[0].name).toBe("UserContext");
    expect(result.current.error).toBeNull();
  });

  it("should handle parsing errors", async () => {
    const { result } = renderHook(() => useManifestParser());
    
    await act(async () => {
      result.current.parseManifest("invalid: [unclosed bracket");
    });
    
    expect(result.current.status).toBe("error");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toContain("Failed to parse YAML");
  });

  it("should reset state correctly", async () => {
    const { result } = renderHook(() => useManifestParser());
    
    await act(async () => {
      result.current.parseManifest(validManifestYaml);
    });
    
    expect(result.current.status).toBe("success");
    
    act(() => {
      result.current.reset();
    });
    
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});