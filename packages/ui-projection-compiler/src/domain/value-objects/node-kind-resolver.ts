import { NodeKind } from "@hexagen/core-domain";

export type HexagonNodeType =
  | "bounded-context"
  | "entity"
  | "port"
  | "use-case"
  | "adapter"
  | "peer"
  | "group"
  | "inner";

export type HexagonSide = "north" | "south" | "east" | "west";

export function nodeKindFromHexagonType(
  type: HexagonNodeType | string,
  side?: HexagonSide | string,
): NodeKind {
  switch (type) {
    case "entity":
      return NodeKind.Entity;
    case "use-case":
      return NodeKind.UseCase;
    case "port":
      return NodeKind.Port;
    case "adapter": {
      if (side === "north") return NodeKind.Controller;
      if (side === "south") return NodeKind.PersistenceAdapter;
      if (side === "west") return NodeKind.Driver;
      if (side === "east") return NodeKind.Adapter;
      return NodeKind.Adapter;
    }
    default:
      return NodeKind.Extension;
  }
}
