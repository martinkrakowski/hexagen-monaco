"use client";

import { useState } from "react";
import { suggestSlug } from "../domain/org-slug";

/**
 * Shared name+slug form state for the org and team steps.
 *
 * The slug tracks the name (via `suggestSlug`) ONLY until the user edits the
 * slug field themselves; from then on their value wins and name edits stop
 * overwriting it. Clearing the slug field re-arms the suggestion — an emptied
 * field is a request for help, not a manual value.
 */
export function useNameSlug() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (!slugEdited) setSlug(suggestSlug(nextName));
  };

  const handleSlugChange = (nextSlug: string) => {
    setSlug(nextSlug);
    setSlugEdited(nextSlug.length > 0);
  };

  return { name, slug, handleNameChange, handleSlugChange } as const;
}
