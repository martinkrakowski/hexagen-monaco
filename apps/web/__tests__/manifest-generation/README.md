# Manifest Generation Tests

This directory contains tests for the manifest generation feature (Phase 9).

## Test Structure

### Unit Tests

- **`packages/agentic-interaction/__tests__/domain/value-objects/project-description.test.ts`**
  - Tests for `ProjectDescription` value object
  - Validation logic (length, prompt injection, sanitization)
  - Factory function behavior

### Integration Tests

- **`apps/web/__tests__/api/manifest/generate.test.ts`**
  - API endpoint request/response validation
  - Error handling
  - Input validation

### E2E Tests (Playwright)

- **`apps/web/__tests__/e2e/manifest-generation.spec.ts`**
  - Complete user flow from input to preview
  - UI interactions (buttons, forms, loading states)
  - Error display
  - Manifest preview and actions

## Running Tests

### Unit Tests

```bash
# Run all unit tests
yarn test

# Run specific test file
node --test packages/agentic-interaction/__tests__/domain/value-objects/project-description.test.ts
```

### Integration Tests

```bash
# Run API tests
node --test apps/web/__tests__/api/manifest/generate.test.ts
```

### E2E Tests

```bash
# Run Playwright tests
yarn test:e2e

# Run specific E2E test
yarn playwright test apps/web/__tests__/e2e/manifest-generation.spec.ts
```

## Test Coverage

### Value Objects

- ✅ ProjectDescription creation and validation
- ✅ Prompt injection detection
- ✅ HTML/script sanitization
- ✅ Length validation (min/max)
- ✅ Whitespace handling

### API Endpoint

- ✅ Request validation
- ✅ Missing/invalid description handling
- ✅ Prompt injection rejection
- ✅ Optional parameters (platform, deployment)
- ✅ Error response format
- ✅ CORS handling

### UI Flow

- ✅ Welcome screen display
- ✅ Character counter
- ✅ Generate button enable/disable
- ✅ Example descriptions
- ✅ Advanced options toggle
- ✅ Loading states
- ✅ Error display
- ✅ Manifest preview
- ✅ Copy to clipboard
- ✅ Regenerate flow
- ✅ Proceed to wizard

## Test Data

### Valid Descriptions

- "A task management system with user authentication and project boards"
- "An e-commerce platform with product catalog, shopping cart, and payment processing"
- "A blog platform with content management, user comments, and social sharing"

### Invalid Descriptions

- Too short: "Short"
- Too long: 2001+ characters
- Prompt injection: "Ignore previous instructions..."
- HTML/XSS: "<script>alert('xss')</script>"

## Mocking Strategy

### LLM Adapter

For integration and E2E tests, the LLM adapter should be mocked to:

- Return predictable responses
- Avoid external API calls
- Test error scenarios
- Control response timing

### Example Mock Response

```json
{
  "success": true,
  "manifest": "workspace:\n  name: test-project\nboundedContexts: []",
  "confidence": 0.85,
  "suggestions": ["Consider adding more contexts"],
  "warnings": [],
  "metadata": {
    "model": "gpt-4",
    "processingTime": 1500,
    "tokensUsed": 500
  }
}
```

## Future Test Additions

- [ ] Schema validation against `.architecture/manifest.yaml`
- [ ] Performance tests (generation time, token usage)
- [ ] Concurrent request handling
- [ ] Rate limiting tests
- [ ] Accessibility tests (WCAG compliance)
- [ ] Mobile responsiveness tests
- [ ] Browser compatibility tests
