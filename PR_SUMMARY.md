# PR Summary: Implement Shared `useApiResource` Hook

Closes #75

## Summary

This PR implements a reusable `useApiResource<T>` React hook to centralize duplicated API-fetching state logic across the frontend. The hook provides consistent loading, error handling, stale request protection, and safe unmounting behavior.

Three representative pages have been migrated to use the new shared hook:
- **Activity.tsx** — Initial page load
- **ActivityDetail.tsx** — Detail view with multi-param dependencies  
- **AgentDetail.tsx** — Detail view with reload on user actions

All existing functionality and UI behavior has been preserved.

## Implementation Details

### Hook Design

The `useApiResource` hook accepts:
- A `fetcher` function that returns `Promise<T>`
- A `deps` dependency list (similar to `useEffect`)

And returns:
```typescript
{
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}
```

**Key features:**
1. **Stale request protection**: Uses a sequence counter to ensure older requests cannot overwrite newer results
2. **Safe unmounting**: Checks component mount status before state updates to prevent React warnings
3. **Manual reload**: Exposes an async `reload()` function for user-triggered refreshes
4. **Preserved data during reload**: Keeps previous successful data visible while reloading to avoid UI flicker
5. **Dependency-based refetching**: Automatically refetches when dependencies change

### Migration Approach

**Activity.tsx (Pattern A)**:
- Replaced manual `useState` + `useEffect` with `useApiResource`
- Initial page load now uses the shared hook
- Pagination logic intentionally left unchanged (noted as future work)

**ActivityDetail.tsx (Pattern B)**:
- Fully migrated from manual `loading`/`error`/`cancelled` state to `useApiResource`
- Both `agentId` and `activityId` tracked as dependencies
- Removed redundant `reloadKey` trigger pattern

**AgentDetail.tsx (Pattern C)**:
- Migrated main agent + activity fetch to `useApiResource`
- Status change handlers now call `reload()` instead of updating a `reloadKey`
- Spending and policy sections intentionally left unchanged (separate API calls, noted as future work)

## Testing

### Hook Tests (11 tests, all passing)
- ✅ Initial loading state
- ✅ Successful response handling
- ✅ Empty array handling (distinguishes from null)
- ✅ Error handling with safe error message extraction
- ✅ Stale request protection (deterministic using deferred promises)
- ✅ Unmount protection (no React warnings)
- ✅ Manual reload with loading state
- ✅ Error clearing on reload
- ✅ Dependency change refetch
- ✅ Data preservation during reload

### Page Tests
All existing page tests pass (315 tests total), confirming that:
- Loading states render correctly
- Successful data renders correctly
- Error states render correctly
- Route parameter changes trigger correct fetches
- Action-triggered reloads work in AgentDetail

## Files Changed

### New Files
- `apps/web/src/hooks/useApiResource.ts` — Shared hook implementation
- `apps/web/src/hooks/__tests__/useApiResource.test.tsx` — Comprehensive hook tests
- `REMAINING_MIGRATIONS.md` — Documentation of remaining migration candidates

### Modified Files
- `apps/web/src/pages/Activity.tsx` — Migrated initial load to `useApiResource`
- `apps/web/src/pages/ActivityDetail.tsx` — Fully migrated to `useApiResource`
- `apps/web/src/pages/AgentDetail.tsx` — Migrated main agent+activity fetch to `useApiResource`

## Remaining Work

The following pages still use the old manual fetch pattern and are documented as follow-up work in `REMAINING_MIGRATIONS.md`:

**High priority (simple patterns)**:
- ApprovalDetail.tsx
- ExecutionDetail.tsx
- Agents.tsx (initial list fetch only)

**Medium priority (pagination patterns)**:
- Approvals.tsx
- Executions.tsx
- ScheduleList.tsx

**Lower priority (complex cases)**:
- Overview.tsx (multiple parallel fetches)
- AgentDetail.tsx (PolicySettings, PolicySummary components)
- Submit.tsx (agents list fetch)

## Verification

All verification steps pass:

```bash
✅ pnpm build                           # Clean build, no errors
✅ pnpm --filter @4evergent/web test    # 315 tests pass, 22 test files
✅ pnpm typecheck                       # No type errors
✅ pnpm lint                            # No lint errors
```

## Acceptance Criteria

- ✅ **Shared hook**: `useApiResource` exists and exposes `{ data, error, loading, reload }`
- ✅ **Stale responses**: Older requests cannot overwrite newer results (verified by test)
- ✅ **Unmount safety**: Pending requests cannot update state after unmount (verified by test)
- ✅ **Reload behavior**: `reload()` invokes fetcher and sets loading during reload (verified by test)
- ✅ **Representative migrations**: Activity, ActivityDetail, and AgentDetail use the shared hook
- ✅ **Remaining pages documented**: See `REMAINING_MIGRATIONS.md` for follow-up work
- ✅ **Verification**: All build, test, typecheck, and lint commands pass

## Breaking Changes

None. All existing page behavior is preserved.

## Migration Notes for Future Work

When migrating additional pages:

1. Use `useCallback` to wrap fetchers with dependencies
2. Pass all relevant dependencies to `useApiResource`
3. Preserve existing UI behavior
4. Test for stale requests and unmount safety
5. Keep pagination logic separate from initial load (for now)

The hook is intentionally simple and focused on initial resource loading. Complex pagination or multi-step flows may require additional patterns.
