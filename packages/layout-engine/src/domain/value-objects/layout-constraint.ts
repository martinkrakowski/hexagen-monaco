export interface LayoutConstraint {
  readonly id: string;
  readonly type: LayoutConstraintType;
  readonly payload: LayoutConstraintPayload;
}

export type LayoutConstraintType =
  | "min-distance"
  | "max-distance"
  | "alignment"
  | "containment"
  | "aspect-ratio"
  | "group-boundary";

export type LayoutConstraintPayload =
  | MinDistancePayload
  | MaxDistancePayload
  | AlignmentPayload
  | ContainmentPayload
  | AspectRatioPayload
  | GroupBoundaryPayload;

export interface MinDistancePayload {
  readonly axis: "x" | "y" | "both";
  readonly minPixels: number;
}

export interface MaxDistancePayload {
  readonly axis: "x" | "y" | "both";
  readonly maxPixels: number;
}

export interface AlignmentPayload {
  readonly axis: "x" | "y";
  readonly offset: number;
}

export interface ContainmentPayload {
  readonly containerId: string;
  readonly padding: number;
}

export interface AspectRatioPayload {
  readonly ratio: number;
}

export interface GroupBoundaryPayload {
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}
