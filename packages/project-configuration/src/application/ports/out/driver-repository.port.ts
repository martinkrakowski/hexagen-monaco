import type { Driver } from "../../../domain/model/driver/driver";

export interface IDriverRepository {
  save(entity: Driver): Promise<Driver>;
  findById(_id: string): Promise<Driver | null>;
}
