import type { BoundedContext } from "../../../domain/model/bounded-context/bounded-context";

export interface IBoundedContextRepository {
  save(entity: BoundedContext): Promise<BoundedContext>;
  findById(_id: string): Promise<BoundedContext | null>;
}
