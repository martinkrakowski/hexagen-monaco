import type { UserContext } from "../../domain/value-objects/user-context";

export interface RequestContext {
  user?: UserContext;
}

export class GetCurrentUserUseCase {
  execute(ctx: RequestContext): UserContext | null {
    return ctx.user ?? null;
  }
}
