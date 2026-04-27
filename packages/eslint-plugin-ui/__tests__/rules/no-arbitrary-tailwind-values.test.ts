/**
 * Test Suite: no-arbitrary-tailwind-values
 *
 * This file documents the expected behavior of the ESLint rule.
 * Note: This project does not have a Jest test runner configured.
 * Rule validation is performed via:
 * 1. yarn lint integration (active in web app)
 * 2. Manual code inspection during refactoring
 * 3. Type checking via TypeScript strict mode
 *
 * Expected behaviors:
 */

describe("no-arbitrary-tailwind-values", () => {
  describe("Should detect arbitrary values", () => {
    // ❌ text-[12px] — arbitrary font size (not on semantic scale)
    void `className="text-[12px]"`;

    // ❌ w-[180px] — arbitrary width
    void `className="w-[180px]"`;

    // ❌ px-[18px] — arbitrary horizontal padding (not multiple of 4px)
    void `className="px-[18px]"`;

    // ❌ h-[30px] — arbitrary height
    void `className="h-[30px]"`;

    // ❌ text-[10.5px] — arbitrary font size with decimal
    void `className="text-[10.5px]"`;

    // ❌ Multiple violations in single string
    void `className="text-[12px] w-[180px] px-[18px]"`;
  });

  describe("Should allow documented exceptions", () => {
    // ✅ active:scale-[0.98] — permitted for press feedback (DESIGN.md §4.7)
    void `className="active:scale-[0.98]"`;
  });

  describe("Should not flag semantic tokens", () => {
    // ✅ text-sm — on semantic scale
    void `className="text-sm"`;

    // ✅ w-32 — standard Tailwind scale
    void `className="w-32"`;

    // ✅ px-4 — 16px, multiple of 4px baseline grid
    void `className="px-4"`;

    // ✅ h-10 — 40px, standard component height
    void `className="h-10"`;

    // ✅ gap-6 — 24px, standard spacing
    void `className="gap-6"`;
  });

  describe("Should not flag color values", () => {
    // Note: Color values are checked separately by DESIGN.md §4 audit
    // This rule focuses on spacing, sizing, and dimension values
    void `className="bg-blue-500"`;
  });
});

/**
 * Integration Validation:
 *
 * After this rule is activated in the web app's .eslintrc,
 * run: yarn lint
 *
 * Expected output should show violations in these files (Phase 3.3):
 * - ModelProgressCard.tsx (12 violations)
 * - model-card.tsx (8 violations)
 * - cloud-models-section.tsx (7 violations)
 * - BoundedContext.tsx (8+ violations)
 * - StepHeader.tsx (4 violations)
 * - PeerContextNode.tsx (4+ violations)
 *
 * After refactoring (Phase 3.3), yarn lint should report 0 violations.
 */
