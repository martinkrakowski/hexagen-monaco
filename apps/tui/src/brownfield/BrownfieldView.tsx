import React, { useCallback, useEffect, useRef, useState } from "react";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import {
  clean,
  listGrantFiles,
  loadGrantShow,
  loadSliceSummary,
  loadTraceTail,
  runGrantShow,
  type GrantShowRunner,
  type Loaded,
  type SliceSummary,
  type TraceTail,
} from "./read-files.js";

type Pane = "slice" | "grant" | "trace";
const PANES: readonly Pane[] = ["slice", "grant", "trace"];

export interface BrownfieldViewProps {
  readonly workspaceRoot: string;
  readonly onQuit: () => void;
  /** Whether keyboard input is wired (false when stdin is not a TTY). */
  readonly interactive: boolean;
  /** Test seam for the `hexagen grant show` child process. */
  readonly grantShowRunner?: GrantShowRunner;
}

interface Snapshot {
  readonly slice: Loaded<SliceSummary>;
  readonly grants: Loaded<readonly string[]>;
  readonly trace: Loaded<TraceTail>;
  /** Bumped on every load, so a reload re-runs `grant show`. */
  readonly version: number;
}

function Message({ text }: { readonly text: string }) {
  return <Text color="yellow">{text}</Text>;
}

function SlicePane({ slice }: { readonly slice: Loaded<SliceSummary> }) {
  if (!slice.ok) return <Message text={slice.message} />;
  const { paths, excludes, commit, observed } = slice.value;
  const observedText = !observed.present
    ? "observed.json: not found"
    : "invalid" in observed
      ? `observed.json: ${observed.invalid}`
      : `observed.json: present, edgesComplete: ${observed.edgesComplete}`;
  return (
    <>
      <Text>commit: {commit}</Text>
      <Text>paths:</Text>
      {paths.length === 0 ? <Text> (none)</Text> : null}
      {paths.map((p) => (
        <Text key={`p-${p}`}> {p}</Text>
      ))}
      <Text>excludes:</Text>
      {excludes.length === 0 ? <Text> (none)</Text> : null}
      {excludes.map((p) => (
        <Text key={`e-${p}`}> {p}</Text>
      ))}
      <Text>{observedText}</Text>
    </>
  );
}

function GrantPane(props: {
  readonly grants: Loaded<readonly string[]>;
  readonly selected: number;
  readonly shown: Loaded<string> | undefined;
}) {
  const { grants, selected, shown } = props;
  if (!grants.ok) return <Message text={grants.message} />;
  return (
    <>
      {grants.value.map((file, i) => (
        <Text key={file} color={i === selected ? "green" : undefined}>
          {i === selected ? ">" : " "} {clean(path.basename(file))}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        {shown === undefined ? (
          <Text>loading grant...</Text>
        ) : shown.ok ? (
          <Text>{shown.value}</Text>
        ) : (
          <Message text={shown.message} />
        )}
      </Box>
    </>
  );
}

function TracePane({ trace }: { readonly trace: Loaded<TraceTail> }) {
  if (!trace.ok) return <Message text={trace.message} />;
  const { rows, unreadable, total, truncated } = trace.value;
  return (
    <>
      <Text>
        last {rows.length + unreadable} of {truncated ? "≥" : ""}
        {total} line(s)
      </Text>
      <Text dimColor>
        unverified tail: chain and signatures not checked; `hexagen evidence
        pack` verifies
      </Text>
      {rows.map((row, i) => (
        <Text
          key={`${row.seq ?? "x"}-${i}`}
          color={row.denial ? "red" : undefined}
        >
          #{row.seq ?? "?"} {row.time} {row.tool} {row.reason}
          {row.denial ? " DENIAL" : ""}
        </Text>
      ))}
      {unreadable > 0 ? (
        <Message text={`${unreadable} line(s) unreadable`} />
      ) : null}
    </>
  );
}

/**
 * The read-only brownfield projection: slice, grant, trace tail. It reads
 * `.hexagen/` itself, constructs no MCP client and binds no refactor action;
 * `r` is not handled here at all.
 */
export function BrownfieldView(props: BrownfieldViewProps) {
  const { workspaceRoot, onQuit, interactive } = props;
  const run = props.grantShowRunner ?? runGrantShow;
  const loads = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [pane, setPane] = useState<Pane>("slice");
  const [grantIndex, setGrantIndex] = useState(0);
  const [shown, setShown] = useState<Loaded<string> | undefined>();

  const reload = useCallback(async () => {
    const [slice, grants, trace] = await Promise.all([
      loadSliceSummary(workspaceRoot),
      listGrantFiles(workspaceRoot),
      loadTraceTail(workspaceRoot),
    ]);
    loads.current += 1;
    setSnapshot({ slice, grants, trace, version: loads.current });
  }, [workspaceRoot]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grantCount =
    snapshot?.grants.ok === true ? snapshot.grants.value.length : 0;
  const selectedGrant = Math.min(grantIndex, Math.max(0, grantCount - 1));
  const grantFile =
    snapshot?.grants.ok === true
      ? snapshot.grants.value[selectedGrant]
      : undefined;
  useEffect(() => {
    if (grantFile === undefined) return undefined;
    let cancelled = false;
    setShown(undefined);
    void loadGrantShow(grantFile, workspaceRoot, run).then((r) => {
      if (!cancelled) setShown(r);
    });
    return () => {
      cancelled = true;
    };
  }, [grantFile, workspaceRoot, run, snapshot?.version]);

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) {
        onQuit();
      } else if (key.tab) {
        setPane(PANES[(PANES.indexOf(pane) + 1) % PANES.length] as Pane);
      } else if (input === "u") {
        void reload();
      } else if (pane === "grant" && snapshot?.grants.ok) {
        const last = snapshot.grants.value.length - 1;
        if (input === "j" || key.downArrow) {
          setGrantIndex(Math.min(selectedGrant + 1, last));
        } else if (input === "k" || key.upArrow) {
          setGrantIndex(Math.max(selectedGrant - 1, 0));
        }
      }
    },
    { isActive: interactive },
  );

  const border = (p: Pane) => (pane === p ? "green" : "gray");
  return (
    <Box flexDirection="column" padding={1}>
      <Text>HexaGen TUI | brownfield (read-only) | {clean(workspaceRoot)}</Text>
      {snapshot === undefined ? (
        <Text>Loading...</Text>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Box
            borderStyle="round"
            borderColor={border("slice")}
            flexDirection="column"
            paddingX={1}
          >
            <Text>Slice</Text>
            <SlicePane slice={snapshot.slice} />
          </Box>
          <Box
            borderStyle="round"
            borderColor={border("grant")}
            flexDirection="column"
            paddingX={1}
          >
            <Text>Grant</Text>
            <GrantPane
              grants={snapshot.grants}
              selected={selectedGrant}
              shown={shown}
            />
          </Box>
          <Box
            borderStyle="round"
            borderColor={border("trace")}
            flexDirection="column"
            paddingX={1}
          >
            <Text>Trace tail</Text>
            <TracePane trace={snapshot.trace} />
          </Box>
        </Box>
      )}
      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text>
          Footer: Tab switch pane | j/k pick grant | u reload | q quit
        </Text>
      </Box>
    </Box>
  );
}
