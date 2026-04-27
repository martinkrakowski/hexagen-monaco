# Remediation Plan — Code Drift Updates

> **Date:** 2026-04-23
> **Status:** Pending Approval
> **Scope:** Source code changes only (no DESIGN.md changes)
> **Version:** 1.0.0

---

## Summary

2 code drift items identified where implementation diverges from `DESIGN.md` v1.0.0. Both are in `Card.tsx`.

---

## 1. Card Border Radius Violation

| Field        | Value                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **File**     | `packages/ui/src/elements/Card.tsx:13`                                                                                                |
| **Current**  | `rounded-md`                                                                                                                          |
| **Required** | `rounded-lg` per DESIGN.md §4.6                                                                                                       |
| **Severity** | Low                                                                                                                                   |
| **Reason**   | DESIGN.md §4.6 states: "Cards, panels, modals → `rounded-lg`". The `Card` component is the canonical card primitive and must conform. |

### Change

```diff
- "rounded-md border border-border bg-card shadow-sm",
+ "rounded-lg border border-border bg-card shadow-sm",
```

### Impact

- Visual: Border radius increases from `calc(var(--radius) - 2px)` (4px) to `var(--radius)` (6px). Subtle rounding increase on all cards.
- Breaking: No API change. CSS-only.
- Downstream: All consumers of `Card` inherit the new radius.

---

## 2. Card Header Spacing Violation

| Field        | Value                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**     | `packages/ui/src/elements/Card.tsx:33`                                                                                                                |
| **Current**  | `space-y-1.5` (6px)                                                                                                                                   |
| **Required** | `space-y-1` (4px) or `space-y-2` (8px) per DESIGN.md §4.6 4px baseline grid                                                                           |
| **Severity** | Low                                                                                                                                                   |
| **Reason**   | DESIGN.md §4.6 states: "The 4px baseline grid is absolute. All spacing must resolve to a multiple of 4px." `1.5` = 6px, which is not a multiple of 4. |

### Change

Two options — requires design decision:

| Option | Class       | px  | Visual Effect                                       |
| ------ | ----------- | --- | --------------------------------------------------- |
| **A**  | `space-y-1` | 4px | Tighter header gap between title and subtitle       |
| **B**  | `space-y-2` | 8px | Current feel preserved (6px → 8px, slight increase) |

### Impact

- Visual: Either slightly tighter (A) or slightly looser (B) vertical spacing in `CardHeader`.
- Breaking: No API change. CSS-only.
- Downstream: All consumers of `CardHeader` inherit the new spacing.

---

## Execution

| Step | Item                                            | Decision Required                                                 |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------- |
| 1    | Card radius (#1)                                | None — straightforward fix                                        |
| 2    | Card spacing (#2)                               | **Yes** — choose Option A (`space-y-1`) or Option B (`space-y-2`) |
| 3    | Run `yarn build && yarn typecheck && yarn lint` | None                                                              |
| 4    | Run `yarn test`                                 | None                                                              |

---

## Estimated Effort

| Item         | Lines Changed |
| ------------ | ------------- |
| Card radius  | 1             |
| Card spacing | 1             |
| **Total**    | **2**         |
