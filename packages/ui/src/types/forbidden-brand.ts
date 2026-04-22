declare const __hexagen_forbidden_information_state: unique symbol;

export type __HexagenForbiddenInformationState = {
  readonly [__hexagen_forbidden_information_state]?: never;
};

export type InformationStateBrand = __HexagenForbiddenInformationState;

export type ForbiddenInformationState = {
  readonly data?: unknown;
  readonly loading?: boolean;
  readonly error?: unknown;
  readonly result?: unknown;
  readonly isFetching?: boolean;
  readonly status?: string;
  readonly governance?: unknown;
  readonly llm?: unknown;
  readonly isPending?: boolean;
  readonly isSuccess?: boolean;
  readonly isError?: boolean;
};

declare const __hexagen_interaction_state: unique symbol;

export type __HexagenInteractionState = {
  readonly [__hexagen_interaction_state]?: never;
};

export type InteractionStateOnly<T> = T & __HexagenInteractionState;

declare const __hexagen_semantic_state: unique symbol;

export type __HexagenSemanticState = {
  readonly [__hexagen_semantic_state]?: never;
};

export type NoSemanticState<T extends object> = Omit<T, ForbiddenPropKeys> &
  __HexagenSemanticState;

export const FORBIDDEN_TOKENS = [
  "data",
  "loading",
  "error",
  "result",
  "isFetching",
  "governance",
  "llm",
  "status",
  "isPending",
  "isSuccess",
  "isError",
] as const;

export type ForbiddenToken = (typeof FORBIDDEN_TOKENS)[number];

export function isForbiddenToken(token: string): token is ForbiddenToken {
  return (FORBIDDEN_TOKENS as readonly string[]).includes(token);
}

export type ForbiddenPropKeys = keyof ForbiddenInformationState;

export type AllowedProps<T extends object> = {
  [K in keyof T]: K extends ForbiddenPropKeys ? never : T[K];
};
