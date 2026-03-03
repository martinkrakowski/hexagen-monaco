import type { IValueObjectRepository } from '../../application/ports/out/value-object-repository.port';
import type { ValueObject } from '../../domain/model/value-object/value-object';

/**
 * Concrete adapter implementing the outbound port IValueObjectRepository.
 * Handles persistence operations for ValueObject entities.
 */
export class ValueObjectRepositoryAdapter implements IValueObjectRepository {
  async save(entity: ValueObject): Promise<ValueObject> {
    // TODO: Replace with real persistence logic (e.g. Drizzle / Prisma)
    // Value objects are typically immutable and embedded, so persistence may be different
    // Example placeholder:
    // await db.insert(valueObjects).values(entity);
    return entity;
  }

  async findById(_id: string): Promise<ValueObject | null> {
    // TODO: Replace with real query logic
    // Example placeholder:
    // const result = await db.select().from(valueObjects).where(eq(valueObjects.id, id));
    // return result[0] ?? null;
    void _id;
    return null;
  }
}
