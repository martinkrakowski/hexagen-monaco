# PHASE 0 BLOCKERS DELEGATION — READY FOR TEAM ASSIGNMENT

**Date:** 2026-04-27  
**Branch:** `fix/phase-0-blockers-consolidated`  
**Status:** ✅ READY FOR IMPLEMENTATION  
**Duration:** 3 days (22 hours)

---

## BRANCH OVERVIEW

```
Current branch: fix/phase-0-blockers-consolidated
Latest commit:  docs: Phase 0 comprehensive implementation delegation plan (0693e39)
Base commit:    fix: Update WarningBanner to use design tokens (602527d)
```

### What's Included

✅ **Full delegation plan:** 10 tasks with success criteria  
✅ **Architecture review:** 3 consistency fixes documented  
✅ **Security hardening:** 2 package isolation improvements  
✅ **Build integrity:** All tests pass, build green, typecheck clean  

---

## TASK ASSIGNMENT SUMMARY

| Task | Owner | Duration | Complexity | Status |
|------|-------|----------|-----------|--------|
| 1. Wire Singletons | Backend | 2h | Medium | ⏭️ Ready |
| 2. Accept Endpoint | Backend | 5h | High | ⏭️ Ready |
| 3. LocalLLMProvider | Backend | 45min | Low | ⏭️ Ready |
| 4. Reject Endpoint | Backend | 3h | High | ⏭️ Ready |
| 5. Flow 1 Redesign | Backend | 4h | High | ⏭️ Ready |
| 6. llm-driver Barrel | Backend | 15min | Trivial | ⏭️ Ready |
| 7. ExportContext Fix | Backend | 30min | Low | ⏭️ Ready |
| 8. Client UI | Frontend | 4h | High | ⏭️ Ready |
| 9. Integration Tests | QA/Backend | 4h | High | ⏭️ Ready |
| 10. Package Safety | Backend | 1h | Medium | ⏭️ Ready |

**Total: 22 hours across 3 days**  
**Critical Path: 15 hours** (wire → accept → flow1 → ui)

---

## HOW TO PROCEED

### Step 1: Assign Task Owners

Copy the team member names to each task and notify them:

```
Backend Lead:     [Name]
Frontend Lead:    [Name]
QA Lead:          [Name]
```

### Step 2: Each Team Member Reads Their Delegation

The delegation document is at:  
**`PHASE-0-IMPLEMENTATION-DELEGATION.md`**

Each task includes:
- Full description and success criteria
- Exact code snippets (from PHASED-FLOW3-FIX-CRITICAL-UPDATES)
- Dependencies and blocking relationships
- Pre-merge checklist

### Step 3: Start Task 1 (Wire Dependencies)

This is the **foundation task** — all subsequent tasks depend on it:

```bash
# Backend lead starts here:
cd apps/web/app/lib
# Read: PHASE-0-IMPLEMENTATION-DELEGATION.md → TASK 1
# Implement: wire.server.ts singleton caching (2 hours)
```

Success point: Singleton tests pass, same manager instance returned across requests.

### Step 4: Parallel Execution (After Task 1)

Once wire singletons are working:
- **Backend:** Tasks 2, 4, 5, 6, 7, 10 can run in parallel
- **Frontend:** Task 8 waits on Task 5 (Flow 1 SSE design)
- **QA:** Task 9 runs during final 2 hours (integration tests)

```
Day 1:  Task 1 (2h) → Start Tasks 2,3,4 (8h)
Day 2:  Finish Tasks 2,4,5 (12h) → Start Task 8 (4h parallel)
Day 3:  Finish Task 8 (4h) → Task 9 (4h) ✅
```

### Step 5: Pre-Merge Checklist

Before submitting PR:

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
# All must pass

yarn test
# All tests pass (100% coverage of critical paths)
```

---

## KEY REFERENCES

| Document | Contains |
|----------|----------|
| `PHASE-0-IMPLEMENTATION-DELEGATION.md` | Full 10-task breakdown with code |
| `PHASED-FLOW3-FIX-CRITICAL-UPDATES-2026-04-27.md` | 6 critical fixes (code snippets) |
| `docs/architectural-reviews/` | Architecture audit findings |
| `AGENTS.md` | Tech stack & build commands |

---

## UNBLOCKING CRITERIA (For Each Task)

### Before starting Task 2, 4, 5 (After Task 1):
```bash
yarn test apps/web/lib/wire.server.ts
✅ Singleton tests pass
```

### Before starting Task 8 (Waiting on Task 5):
```bash
yarn build && yarn typecheck
✅ Flow 1 interfaces merged
✅ SSE event contract finalized
```

### Before merging PR (All tasks):
```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
✅ All pass
```

---

## RISK MITIGATION

**If a task gets stuck:**
1. Notify the lead immediately (don't wait)
2. Document the blocker in the PR description
3. Other tasks can continue in parallel
4. Escalate to architecture review if needed

**If merge conflicts arise:**
- Rebase on latest `main` before submission
- Resolve conflicts in logical order (wire first, then features)

---

## WHAT TO DO NOW

1. **Read this document** — you're here ✓
2. **Assign team members** to tasks
3. **Open `PHASE-0-IMPLEMENTATION-DELEGATION.md`** in your IDE
4. **Start Task 1** (or delegate to Backend Lead)
5. **Post PR URL** when ready for review

---

## SUCCESS CRITERIA

After all 10 tasks complete:

✅ **Flow 0a works:** Modify → Phase → SSE emits patches (unmutated manifest)  
✅ **Accept works:** Accept endpoint applies patches, commits, restores manifest  
✅ **Reject works:** Reject endpoint rolls back, restores manifest defensively  
✅ **UI works:** Accept/Reject buttons trigger endpoints, show verdicts  
✅ **Tests pass:** Transaction lifecycle, path validation, SSE parsing  
✅ **Architecture clean:** LocalLLMProvider moved, ExportContext fixed, barrel created  
✅ **Security hardened:** local-llm conditional exports, CLI isolation rule  

---

## QUESTIONS?

If anything is unclear:
1. **Check `PHASE-0-IMPLEMENTATION-DELEGATION.md`** — full task details are there
2. **Review `PHASED-FLOW3-FIX-CRITICAL-UPDATES-2026-04-27.md`** — source code & rationale
3. **Ask on this branch** — create a discussion or comment on the PR

---

**Status: READY FOR TEAM ASSIGNMENT**  
**Next Step: Assign Task 1 to Backend Lead**

