"use client";

import type { PeerContextMapping } from "@hexagen/project-configuration";

interface MappingFormIntegrationProps {
  mapping: PeerContextMapping;
  consumerName: string;
  providerName: string;
  isStrictTemplate: boolean;
  onUpdate: (updates: Partial<PeerContextMapping>) => void;
}

const FIELD_LABEL_CLASSES =
  "block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1";
const SELECT_CLASSES =
  "w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none";

/**
 * Integration and communication fields for a peer mapping.
 * Two independent subsections:
 *   1. Integration Pattern — Open Host Service (OHS) vs
 *      Anticorruption Layer (ACL)
 *   2. Communication Boundary — In-Process vs Networked
 *
 * Under strict workspace templates (e.g. microservices), in-process
 * communication between contexts is disallowed; the "in-process"
 * option is hidden and an explanatory hint is rendered.
 */
export function MappingFormIntegration({
  mapping,
  consumerName,
  providerName,
  isStrictTemplate,
  onUpdate,
}: MappingFormIntegrationProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="pb-2 mb-4">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
            Integration Details
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {consumerName} → {providerName}
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>Integration Pattern</span>
            <select
              value={mapping.integrationPattern}
              onChange={(e) =>
                onUpdate({
                  integrationPattern: e.target.value as "open-host" | "acl",
                })
              }
              className={SELECT_CLASSES}
            >
              <option value="open-host">Open Host Service (OHS)</option>
              <option value="acl">Anticorruption Layer (ACL)</option>
            </select>
          </label>
        </div>
      </div>

      <div>
        <div className="pb-2 mb-4">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
            Communication
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            How contexts communicate
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>Communication Boundary</span>
            <select
              value={mapping.communicationBoundary}
              onChange={(e) =>
                onUpdate({
                  communicationBoundary: e.target.value as
                    | "in-process"
                    | "networked",
                })
              }
              className={SELECT_CLASSES}
            >
              {!isStrictTemplate && (
                <option value="in-process">In-Process</option>
              )}
              <option value="networked">Networked</option>
            </select>
            {isStrictTemplate && (
              <p className="text-xs text-muted-foreground mt-1">
                In-process communication is not allowed in this template. All
                cross-context calls must be networked.
              </p>
            )}
          </label>
        </div>
      </div>
    </div>
  );
}
