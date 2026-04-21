import type { ValueObject } from "../../../domain/model/value-object/value-object";

export interface IValueObjectRepository {
  save(entity: ValueObject): Promise<ValueObject>;
  findById(_id: string): Promise<ValueObject | null>;
}
