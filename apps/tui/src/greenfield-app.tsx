import React, { useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import { Box, render, Text, useInput } from "ink";
import { useTUIStore } from "./state/use-tui-store.js";
import { refactorWithAI } from "./services/action-service.js";
import {
  loadNavigationTree,
  deriveRulesForDomain,
} from "./services/manifest-service.js";
import { MCPClientService } from "./services/mcp-client.service.js";
import { MessagingService } from "./services/messaging-service.js";
import { loadViolations } from "./services/sync-service.js";

function resolveWorkspaceRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, ".architecture", "manifest.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return startDir;
}

const workspaceRoot = resolveWorkspaceRoot(process.cwd());
const mcpClient = new MCPClientService();
const messagingService = new MessagingService();

async function refreshAllData() {
  const state = useTUIStore.getState();
  state.setIsLoading(true);
  state.setStatusMessage("Refreshing architecture state...");

  const tree = await loadNavigationTree(mcpClient);
  state.setNavigationTree(tree);
  const selected = tree[state.selectedDomainIndex] ?? tree[0];
  state.setRuleEngine(deriveRulesForDomain(selected));

  const violations = await loadViolations(mcpClient);
  state.setViolationInspector(violations.violations);
  state.setStatusMessage(
    violations.compliant
      ? "Architecture compliant"
      : `Found ${violations.violations.length} violation(s)`,
  );
  state.setIsLoading(false);
}

function App() {
  const {
    navigationTree,
    ruleEngine,
    violationInspector,
    selectedDomainIndex,
    selectedViolationIndex,
    selectedPane,
    isLoading,
    statusMessage,
    setSelectedDomainIndex,
    setSelectedViolationIndex,
    setSelectedPane,
    setRuleEngine,
    setStatusMessage,
  } = useTUIStore();

  useEffect(() => {
    const boot = async () => {
      await mcpClient.connect(workspaceRoot);
      await refreshAllData();
      messagingService.start(workspaceRoot, {
        onBoundaryViolated: async () => {
          const result = await loadViolations(mcpClient);
          useTUIStore.getState().setViolationInspector(result.violations);
          useTUIStore
            .getState()
            .setStatusMessage("Live update: boundary/linter changes detected");
        },
        onDependencyChanged: async () => {
          const tree = await loadNavigationTree(mcpClient);
          useTUIStore.getState().setNavigationTree(tree);
          const selected =
            tree[useTUIStore.getState().selectedDomainIndex] ?? tree[0];
          useTUIStore.getState().setRuleEngine(deriveRulesForDomain(selected));
          useTUIStore
            .getState()
            .setStatusMessage(
              "Live update: manifest/dependency changes detected",
            );
        },
      });
    };

    void boot();
    return () => {
      messagingService.stop();
    };
  }, []);

  useInput(
    (
      input: string,
      key: {
        tab?: boolean;
        escape?: boolean;
        downArrow?: boolean;
        upArrow?: boolean;
      },
    ) => {
      if (input === "q" || key.escape) {
        messagingService.stop();
        process.exit(0);
      }

      if (key.tab) {
        setSelectedPane(
          selectedPane === "navigation"
            ? "rules"
            : selectedPane === "rules"
              ? "violations"
              : "navigation",
        );
        return;
      }

      if (input === "j" || key.downArrow) {
        if (selectedPane === "navigation") {
          const next = Math.min(
            selectedDomainIndex + 1,
            Math.max(0, navigationTree.length - 1),
          );
          setSelectedDomainIndex(next);
          setRuleEngine(deriveRulesForDomain(navigationTree[next]));
        } else if (selectedPane === "violations") {
          const next = Math.min(
            selectedViolationIndex + 1,
            Math.max(0, violationInspector.length - 1),
          );
          setSelectedViolationIndex(next);
        }
        return;
      }

      if (input === "k" || key.upArrow) {
        if (selectedPane === "navigation") {
          const next = Math.max(selectedDomainIndex - 1, 0);
          setSelectedDomainIndex(next);
          setRuleEngine(deriveRulesForDomain(navigationTree[next]));
        } else if (selectedPane === "violations") {
          setSelectedViolationIndex(Math.max(selectedViolationIndex - 1, 0));
        }
        return;
      }

      if (input === "r") {
        const violation = violationInspector[selectedViolationIndex];
        if (!violation) {
          setStatusMessage("No violation selected.");
          return;
        }

        setStatusMessage("Invoking AI fix via local MCP server...");
        void (async () => {
          const outcome = await refactorWithAI(mcpClient, violation);
          setStatusMessage(outcome);
          await refreshAllData();
        })();
        return;
      }

      if (input === "u") {
        void refreshAllData();
      }
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Text>
        HexaGen TUI | Pane: {selectedPane} |{" "}
        {isLoading ? "Loading..." : "Ready"}
      </Text>
      <Box marginTop={1} flexDirection="row" height={20}>
        <Box
          width="33%"
          borderStyle="round"
          borderColor={selectedPane === "navigation" ? "green" : "gray"}
          flexDirection="column"
          paddingX={1}
        >
          <Text>Navigation Tree</Text>
          {navigationTree.map((item, index) => (
            <Text
              key={item.id}
              color={index === selectedDomainIndex ? "green" : undefined}
            >
              {index === selectedDomainIndex ? ">" : " "} {item.label} [
              {item.type}]
            </Text>
          ))}
        </Box>
        <Box
          width="33%"
          borderStyle="round"
          borderColor={selectedPane === "rules" ? "green" : "gray"}
          flexDirection="column"
          paddingX={1}
        >
          <Text>Rule Engine</Text>
          {ruleEngine.map((rule) => (
            <Text key={rule.id}>- {rule.text}</Text>
          ))}
        </Box>
        <Box
          width="34%"
          borderStyle="round"
          borderColor={selectedPane === "violations" ? "green" : "gray"}
          flexDirection="column"
          paddingX={1}
        >
          <Text>Violation Inspector</Text>
          {violationInspector.length === 0 ? (
            <Text color="green">No active violations</Text>
          ) : (
            violationInspector.map((violation, index) => (
              <Text
                key={`${violation.file}-${violation.ruleId}-${index}`}
                color={index === selectedViolationIndex ? "yellow" : undefined}
              >
                {index === selectedViolationIndex ? ">" : " "} [
                {violation.severity}] {violation.ruleId}
              </Text>
            ))
          )}
        </Box>
      </Box>
      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text>
          Footer: j/k move | Tab switch pane | r refactor with AI | u refresh |
          q quit
        </Text>
      </Box>
      <Text color="cyan">Status: {statusMessage}</Text>
    </Box>
  );
}

render(<App />);
