import type {
  BoundedContext,
  PortConfiguration,
} from "@hexagen/project-configuration";

import type { InboundPortValue, OutboundPortValue } from "./port-catalog";

type PortDirection = "inbound" | "outbound";

/**
 * Pure reducer: returns a new boundedContexts array with the given
 * port toggled on/off for the specified context + direction.
 *
 * The two direction branches share structure but operate on
 * differently-typed arrays (InboundPortValue[] vs
 * OutboundPortValue[]), so they remain separate to preserve
 * type correctness without widening to string[].
 */
export function toggleContextPort(
  boundedContexts: BoundedContext[],
  contextIndex: number,
  direction: PortDirection,
  port: InboundPortValue | OutboundPortValue,
): BoundedContext[] {
  const currentContext = boundedContexts[contextIndex];
  if (!currentContext) return boundedContexts;

  const currentConfig = currentContext.portConfiguration ?? {
    inboundPorts: [],
    outboundPorts: [],
  };

  const nextConfig: PortConfiguration =
    direction === "inbound"
      ? {
          inboundPorts: toggleInArray(
            currentConfig.inboundPorts ?? [],
            port as InboundPortValue,
          ),
          outboundPorts: currentConfig.outboundPorts ?? [],
        }
      : {
          inboundPorts: currentConfig.inboundPorts ?? [],
          outboundPorts: toggleInArray(
            currentConfig.outboundPorts ?? [],
            port as OutboundPortValue,
          ),
        };

  const next = [...boundedContexts];
  next[contextIndex] = { ...currentContext, portConfiguration: nextConfig };
  return next;
}

function toggleInArray<T>(array: readonly T[], value: T): T[] {
  return array.includes(value)
    ? array.filter((item) => item !== value)
    : [...array, value];
}
