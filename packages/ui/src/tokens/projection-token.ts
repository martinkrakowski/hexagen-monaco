import {
  isForbiddenToken,
  type ForbiddenToken,
} from "../types/forbidden-brand";

export type ProjectionTokenBrand = {
  readonly __projectionTokenBrand__: unique symbol;
};

export type ProjectionToken<T extends string = string> = T & ProjectionTokenBrand;

export type SafeProjectionToken<T extends string> = T extends ForbiddenToken
  ? never
  : ProjectionToken<T>;

export function createProjectionToken<T extends string>(
  token: T
): SafeProjectionToken<T> {
  if (isForbiddenToken(token)) {
    throw new Error(
      `Forbidden token "${token}" cannot be used in projection layer`
    );
  }
  return token as SafeProjectionToken<T>;
}

export function validateProjectionToken(token: string): token is ProjectionToken {
  return !isForbiddenToken(token);
}

export function getAllowedTokens<T extends string>(
  tokens: T[]
): ProjectionToken<T>[] {
  return tokens.filter(validateProjectionToken) as ProjectionToken<T>[];
}

export { isForbiddenToken, type ForbiddenToken } from "../types/forbidden-brand";