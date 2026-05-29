import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Example schema — replace with your tables, then generate/apply a migration
// with `yarn migrate`. Enable RLS on every table before production.
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
