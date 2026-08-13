import { describe, it, vi } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, screen } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { PortConfigurationStep } from "../PortConfigurationStep";

const context = {
  id: "ctx-1",
  name: "billing",
  description: "",
  infrastructureTarget: "nestjs",
  coreDomainEntities: [],
  valueObjects: [],
  domainEvents: [],
  entities: [],
  useCases: [],
  portConfiguration: { inboundPorts: [], outboundPorts: [] },
  uiFramework: "",
  persistenceAdapter: "",
  messagingAdapter: "",
  telemetryProvider: "",
};

function Harness({
  manifestSource,
  importedManifestYaml,
}: {
  manifestSource?: "wizard" | "imported";
  importedManifestYaml?: string | null;
}) {
  const form = useForm<ProjectConfig>({
    defaultValues: {
      boundedContexts: [context],
      ...(manifestSource ? { manifestSource } : {}),
    } as unknown as ProjectConfig,
  });
  return (
    <FormProvider {...form}>
      <PortConfigurationStep
        onNext={vi.fn()}
        onBack={vi.fn()}
        canProceed
        importedManifestYaml={importedManifestYaml}
      />
    </FormProvider>
  );
}

const importedYaml = [
  "bounded_contexts:",
  "  - name: billing",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ProcessPaymentPort]",
  "          out: [PaymentGatewayPort]",
].join("\n");

describe("PortConfigurationStep (imported-manifest banner)", () => {
  it("replaces the checkbox catalog with a read-only banner listing the manifest's real ports", () => {
    render(
      <Harness manifestSource="imported" importedManifestYaml={importedYaml} />,
    );
    // Banner present…
    assert.ok(screen.getByRole("status").textContent);
    assert.match(
      screen.getByRole("status").textContent ?? "",
      /managed by the imported manifest/,
    );
    // …with the manifest's REAL named ports (not the checkbox catalog)…
    assert.ok(screen.getByText(/ProcessPaymentPort/));
    assert.ok(screen.getByText(/PaymentGatewayPort/));
    // …and no editable checkboxes at all.
    assert.strictEqual(screen.queryAllByRole("checkbox").length, 0);
  });

  it("keeps the editable checkbox catalog for wizard-authored projects", () => {
    render(<Harness importedManifestYaml={null} />);
    assert.ok(screen.queryAllByRole("checkbox").length > 0);
    assert.strictEqual(screen.queryByRole("status"), null);
  });
});
