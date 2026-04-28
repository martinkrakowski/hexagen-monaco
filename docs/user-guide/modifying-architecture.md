# Modifying Architecture

User guide for using the architecture modification UI to propose and review changes to your project's `.architecture/manifest.yaml`.

## What is Architecture Modification?

Architecture modification allows you to describe desired changes to your project's architecture using natural language. The system generates patches (proposed changes) that you can review before they are applied to the manifest.

For example, you might say:

- "Add a new bounded context called 'billing' for handling payments"
- "Add a 'persist-order' port to the 'ordering' bounded context"
- "Remove the 'notifications' bounded context"

## The Two-Phase Workflow

Architecture modification uses a two-phase approach to ensure you review changes before they affect your project:

### Phase 1: Generate

1. Enter your intent in the natural language input
2. Click "Generate Changes"
3. Watch the progress as the AI pipeline processes your request
4. Once complete, you'll see a summary of proposed changes

### Phase 2: Review

1. Review each patch in the Patch Review Panel
2. Click **Accept** to apply the changes to the manifest (if lint validation passes)
3. Or click **Reject** to discard the changes

You must explicitly accept or reject changes. The system will not apply them automatically.

---

## Using the Patch Review Panel

The Patch Review Panel displays the proposed changes after the generation phase completes.

### Understanding the Display

Each patch shows:

- **Target**: Which part of the manifest is affected (e.g., `boundedContexts[2]`)
- **Type**: The type of change (`add`, `modify`, `delete`)
- **Preview**: A summary of what will change

### Patch Types

| Type     | Description                          |
| -------- | ------------------------------------ |
| `add`    | Adds a new element to the manifest   |
| `modify` | Changes an existing element          |
| `delete` | Removes an element from the manifest |

### What Happens When You Accept

1. The system applies all patches to the manifest
2. Lint validation runs on the updated manifest
3. **If lint passes**: Changes are committed, manifest is updated
4. **If lint fails**: Changes are reverted, you see lint errors

### What Happens When You Reject

1. All proposed changes are discarded
2. The manifest is restored to its state before generation
3. No changes are made to your project

---

## Progress Indicators

During the generation phase, you'll see step-by-step progress:

| Step              | Description                                       |
| ----------------- | ------------------------------------------------- |
| `parse-nl-intent` | Understanding your natural language request       |
| `compile-prompt`  | Preparing the request for the AI                  |
| `llm-inference`   | Generating proposed changes                       |
| `reconcile`       | Checking for conflicts with existing architecture |
| `commit-patches`  | Saving proposed changes for review                |

Each step shows its status (pending, running, completed, failed) and execution time.

---

## Lint Validation Errors

When you accept changes, the system validates the manifest. If lint validation fails, the changes are automatically reverted and you see error messages.

### Common Lint Errors

| Error Message                         | Cause                                           | Resolution                                    |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `Duplicate bounded context name`      | Two contexts with the same name                 | Modify your intent to use a unique name       |
| `Invalid port reference`              | Port references a non-existent context          | Verify context names in your intent           |
| `Port already exists in this context` | Adding a port that already exists               | Modify your intent or choose a different name |
| `Required field missing`              | Generated patch missing required manifest field | The AI may need clearer intent                |

### Handling Lint Errors

1. Read the lint error message carefully
2. Identify what constraint was violated
3. Cancel the current proposal
4. Refine your intent with more specific instructions

---

## Frequently Asked Questions

### Q: Can I modify the patches before accepting?

**A**: Currently, the Patch Review Panel is read-only. To modify patches, cancel the proposal and generate new changes with a refined intent.

### Q: What happens if I close the browser during the review phase?

**A**: The transaction remains in `speculative` state for a timeout period (typically 30 minutes). After timeout, it is automatically rolled back. Your manifest is safe — uncommitted changes are not applied.

### Q: Can I undo an acceptance?

**A**: Yes, you can restore the manifest from git. However, accepting then undoing may cause conflicts with any subsequent changes. Use `git log` to find the previous commit and `git restore` to revert.

### Q: Why does acceptance take longer than generation?

**A**: Acceptance involves:

1. Applying all patches to the manifest file
2. Running lint validation (which may parse and analyze multiple files)
3. If lint fails, running `git restore` to revert changes

Generation only needs to run the AI pipeline, which produces patches without validating against the full manifest.

### Q: What if I don't see all my expected changes?

**A**: The AI may:

- Split your request into multiple patches with different targets
- Determine that some changes require prerequisites (e.g., adding a context before adding its ports)
- Skip changes that conflict with existing architecture

Review the patch list carefully. If changes are missing, try a more specific intent.

### Q: Can I accept some patches and reject others?

**A**: The current implementation accepts or rejects all patches atomically. There is no partial acceptance. To work around this, you can accept all, then reject specific changes in a subsequent modification request.

### Q: What does "speculative" mean?

**A**: `speculative` is the transaction state indicating patches have been generated but not yet applied. The changes exist only in the transaction metadata, not in the manifest file.

### Q: Why do I see a "Lint validation found issues" warning?

**A**: This means the generated patches, when applied to the manifest, produced lint errors. The patches will be rejected automatically if you try to accept them. You should modify your intent and try again.

---

## Tips for Effective Intents

| Guidance                                     | Example                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Be specific about names                      | "Add 'billing' bounded context" instead of "Add a context for payments"                    |
| Mention type when relevant                   | "Add a 'core' context called 'ordering'"                                                   |
| Reference existing elements accurately       | "Add a port to the 'ordering' context" (verify context name exists)                        |
| Describe desired outcome, not implementation | "Customers should be able to place orders" instead of "Implement order placement workflow" |
| One logical change per request               | Separate "Add new context" and "Add ports to existing context" into different requests     |
