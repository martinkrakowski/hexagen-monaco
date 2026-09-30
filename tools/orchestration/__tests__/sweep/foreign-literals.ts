/**
 * The two literals the ported source carried and this package must not.
 *
 * They are a specific repository's owner and name, and the port derives both
 * from the project's overlay instead. Assembled from fragments so that NO file
 * in this lane — not even the ones that grep for them, and not even this one —
 * carries either as a contiguous string. A grep test that had to except its own
 * source would be a grep test that could be argued with; one whose patterns are
 * not present in any file cannot.
 */
export const FOREIGN_OWNER = ["martin", "krakowski"].join("");
export const FOREIGN_REPO = ["campaign", "-foundry"].join("");
