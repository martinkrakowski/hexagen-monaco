-- Example Row Level Security policies. Uncomment and adapt to your tables.
-- RLS must be ENABLED on every table before going to production — without a
-- policy, an RLS-enabled table denies all access by default (which is the safe
-- starting point).

-- Enable RLS:
-- ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- Users can read only their own rows:
-- CREATE POLICY "users can read own items"
--   ON items FOR SELECT
--   USING (auth.uid() = user_id);

-- Authenticated users can insert (and only as themselves):
-- CREATE POLICY "authenticated users can insert items"
--   ON items FOR INSERT
--   WITH CHECK (auth.uid() = user_id);

-- Users can update/delete only their own rows:
-- CREATE POLICY "users can modify own items"
--   ON items FOR UPDATE USING (auth.uid() = user_id);
-- CREATE POLICY "users can delete own items"
--   ON items FOR DELETE USING (auth.uid() = user_id);
