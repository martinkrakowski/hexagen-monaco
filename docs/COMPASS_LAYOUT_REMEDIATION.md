# Compass Layout Remediation Summary

## Diagnosis

After multiple rounds of ELK layout changes with no visible effect on adapter/port positions, the root cause was identified:

### The Actual Problem

Adapters and ports are generated as **root-level nodes** (no `parentId`) in `generate-bounded-context-nodes.ts` with hardcoded positions using config offsets (`NORTH_OFFSET_BASE`, `WEST_PORT_OFFSET_X`, etc.).

```typescript
nodes.push({
  id: adapter.id,
  type: "port",
  side: adapter.side, // north | south
  position: { x: hexX + xOffset, y: yOffset }, // hardcoded
  // NO parentId — treated as root-level in ELK
});
```

Once fed into ELK, the root-level partitioning kicks in (`useElkLayout.ts:getPartitionLane`):

```typescript
if (type === "port") {
  return side === "west" || side === "north" ? 2 : 4;
}
```

This conflates two orthogonal axes:

- **Lane 2**: north adapters + west inbound ports
- **Lane 4**: south adapters + east outbound ports

ELK's `layered` algorithm with `direction: RIGHT` arranges lanes **horizontally**. Result:

- North adapters appear in the **west column** (next to west ports) → "presentation children render west"
- South adapters appear in the **east column** (next to east ports) → "3rd south connector in north region"
- East/west ports are packed into narrow lanes next to the bounded context → "driven ports overlap"

### Why Previous Fixes Didn't Work

| Attempted Change                                  | Why It Had No Effect                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `WEST_PORT_OFFSET_X`, `EAST_PORT_OFFSET_X` tweaks | ELK overwrites initial positions with its partition-lane output                           |
| `SOUTH_OFFSET_STEP`, handleIndex\*60 x-offset     | Same — these set initial position, discarded by ELK                                       |
| Direction-specific layout (`northTypes`, etc.)    | Gated inside `if (node.parentId && ...)` — adapters have no parentId, so code is bypassed |
| `style: { width, zIndex }`                        | Affects rendering only, not layout                                                        |
| Clean-up button clearing localStorage             | Clears cache, but ELK recomputes the same broken layout                                   |

## Fix

**Commit:** `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts`

In `calculateElkLayout`, preserve the original hardcoded positions for root-level adapters/ports instead of letting ELK's partition-lane layout overwrite them:

```typescript
return nodes.map((node) => {
  const isRootAdapterOrPort =
    node.type === "port" && node.side !== undefined && !node.parentId;
  if (isRootAdapterOrPort) {
    return node; // keep original hardcoded position
  }
  const position = positionMap.get(node.id);
  return position ? { ...node, position } : node;
});
```

### Effect

- Adapter/port positions are now controlled by `config.ts` offsets (as originally intended)
- Editing `NORTH_OFFSET_BASE`, `WEST_PORT_OFFSET_X`, etc. now has visible effect
- ELK still lays out the bounded-context hierarchy (contexts, domains, entities, use cases)
- The `getPartitionLane` conflation bug still exists but is now dormant for these nodes

## Future Work

If the architecture is restructured so adapters/ports become children of bounded contexts (`parentId: contextId`), the dormant compass-direction logic in `useElkLayout.ts:322-344` will activate. That path uses `calculateCompassX/Y` to explicitly position compass groups around the parent hexagon and would be the correct long-term design.

## Files Changed

- `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts` — the fix
- `apps/web/features/hexagon-canvas/hooks/useElkLayout.ts` — removed debug logs, kept dormant compass logic with explanatory comment
- `packages/visualization/src/infrastructure/adapters/hexagonal-map-generator/config.ts` — offset values users can now tune
- `packages/visualization/src/infrastructure/adapters/hexagonal-map-generator/generate-bounded-context-nodes.ts` — minor style additions for port visibility
