# ADR-0030: BYOK Server-Proxy Encryption

**Date:** 2026-04-30
**Status:** ✅ Accepted
**Supersedes:** None
**Superseded By:** None
**Drivers:** User-owned API key management for LLM provider proxying
**Related:** INV-1 through INV-7 (BYOK invariants); `@hexagen/byok` bounded context

---

## Problem Statement

Users need to supply their own LLM provider API keys (OpenAI, Anthropic, Cohere) to use the governance assistant's chat feature without relying on shared server-side keys. Three architectural concerns must be addressed:

1. **Key confidentiality:** Raw API keys must never be stored server-side or persist in server memory beyond request scope.
2. **AAD binding:** Encryption must be bound to the user's identity so one user's ciphertext cannot decrypt under another user's session.
3. **Transparent proxying:** The chat experience (SSE streaming) must work identically whether using a server-managed key or a user-owned key.

---

## Decision

**We implement a server-proxy BYOK architecture with AES-256-GCM encryption, client-side ciphertext storage, and streaming proxy dispatch.**

### Key Architectural Choices

| Choice             | Decision                                                                                 | Rationale                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Encryption         | AES-256-GCM with server-managed `BYOK_ENCRYPTION_KEY`                                    | AEAD provides confidentiality + integrity; `iv` is unique per encryption                 |
| AAD binding        | NextAuth JWT `sub` claim (GitHub numeric ID)                                             | Stable, non-reassignable, unique per user — NOT email                                    |
| Ciphertext storage | Client-side only (localStorage via `ByokStore`)                                          | Raw keys never persist server-side; server holds only transient plaintext during request |
| Ciphertext format  | `v{N}:{base64url(IV\|\|AuthTag\|\|EncryptedPayload)}`                                    | Versioned for forward compatibility; single string easy to store/transmit                |
| Key rotation       | Automatic on decrypt; rotated ciphertext returned via `X-Byok-Rotated-Ciphertext` header | Re-encryption with fresh IV mitigates IV-reuse risk without user action                  |
| Proxy path         | Route-level dispatch in `/api/llm/chat`                                                  | `ServerLLMRequestPort` interface kept unchanged; BYOK is an orthogonal concern           |
| Streaming          | `FetchProviderProxyAdapter.streamProxy()` with `stream: true`                            | SSE streaming is the primary chat UX; non-streaming `proxy()` is secondary               |
| Bounded context    | New `byok` core context (not extending `agentic-interaction`)                            | Server-side crypto concerns would pollute the supporting context                         |

---

## Solution Design

### Data Flow

```
Client                                    Server
  │                                         │
  │  1. POST /api/byok/encrypt              │
  │     { provider, plaintextKey }          │
  │────────────────────────────────────────►│
  │                                         │  2. EncryptApiKeyUseCase
  │                                         │     AES-GCM encrypt(plaintext, AAD=userId)
  │  3. { ciphertext }                      │
  │◄────────────────────────────────────────│
  │                                         │
  │  4. Store ciphertext in ByokStore       │
  │     (localStorage)                      │
  │                                         │
  │  5. POST /api/llm/chat                  │
  │     { messages, byokCiphertext,         │
  │       byokProvider }                    │
  │────────────────────────────────────────►│
  │                                         │  6. ProxyRequestUseCase.streamExecute()
  │                                         │     decrypt(key, AAD=userId)
  │                                         │     checkRevocation(userId, provider)
  │                                         │     streamProxy(provider, decryptedKey, payload)
  │                                         │     rotateIfNeeded() → fresh ciphertext
  │  7. SSE stream +                        │
  │     X-Byok-Rotated-Ciphertext header    │
  │◄────────────────────────────────────────│
  │                                         │
  │  8. Update ByokStore with rotated       │
  │     ciphertext (if present)             │
  │                                         │
```

### Bounded Context: `byok`

```
packages/byok/
├── src/
│   ├── domain/
│   │   ├── entities/          KeyMetadata
│   │   ├── value-objects/     Ciphertext, EncryptedApiKey, ProviderName, UserId, ...
│   │   ├── errors/            ByokError hierarchy
│   │   └── services/          AesGcmEncryptionService
│   ├── application/
│   │   ├── ports/in/          EncryptApiKeyPort, ProxyRequestPort, RevokeKeyPort
│   │   ├── ports/out/         EncryptionPort, KeyMetadataPort, RevocationPort,
│   │   │                      ProviderProxyPort, AuditLogPort
│   │   └── use-cases/         EncryptApiKeyUseCase, ProxyRequestUseCase, RevokeKeyUseCase
│   └── infrastructure/
│       └── adapters/          AesGcmEncryptionAdapter, FetchProviderProxyAdapter,
│                               InMemoryKeyMetadataAdapter, InMemoryRevocationAdapter,
│                               ConsoleAuditLogAdapter
```

### Invariants (INV-1 through INV-7)

| ID    | Invariant                                | Enforcement                                                              |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------ |
| INV-1 | Raw API keys never persist server-side   | Ciphertext-only storage; plaintext exists only during request processing |
| INV-2 | Encryption AAD must include `userId`     | `AesGcmEncryptionService` requires `UserId` VO; type-system enforced     |
| INV-3 | Ciphertext format is versioned           | `Ciphertext` VO validates `v{N}:` prefix                                 |
| INV-4 | Revocation is immediate and irreversible | `RevocationPort.markRevoked()` + `ProxyRequestUseCase.checkRevocation()` |
| INV-5 | Key rotation occurs on every decrypt     | `ProxyRequestUseCase.rotateIfNeeded()` re-encrypts with fresh IV         |
| INV-6 | Audit trail for all operations           | `AuditLogPort` called on encrypt/proxy/revoke success and failure        |
| INV-7 | Provider validation is explicit          | `VALID_BYOK_PROVIDERS` set in chat route; `ProviderName` VO validates    |

### Composition Root

`apps/web/app/lib/byok-wire.ts` — lazy singleton wiring of all 5 adapters to 3 use cases. `clearByokCache()` exposed for testability.

### Chat Route Integration

`apps/web/app/api/llm/chat/route.ts` detects BYOK mode (`byokCiphertext` + `byokProvider` in request body) and routes to `ProxyRequestUseCase.streamExecute()`. Non-BYOK requests continue through `HandleServerChatUseCase` → `ServerLLMAdapter`.

### Client-Side Store

`@hexagen/web-driver` provides `ByokStore` port + `LocalStorageByokStoreAdapter`. Stores ciphertext entries keyed by provider name. `useCloudLlm.ts` checks `ByokStore` before falling back to vault, and updates entries on rotation.

---

## Alternatives Considered

### Alternative 1: Client-Side Encryption

Encrypt keys in the browser using Web Crypto API.

**Rejected:** Exposes encryption key material to client-side JavaScript (inspectable in devtools). Server-side encryption with `BYOK_ENCRYPTION_KEY` env var keeps the key in server memory only.

### Alternative 2: Database-Stored Ciphertext

Persist ciphertext in a server-side database.

**Rejected:** Adds infrastructure complexity (DB migration, ORM wiring). Server-persistent ciphertext increases attack surface. Client-side localStorage is sufficient for the current UX — user re-encrypts on new device/session.

### Alternative 3: Extend `agentic-interaction` Context

Add BYOK as a new module inside `agentic-interaction`.

**Rejected:** `agentic-interaction` is a supporting context for architecture modification. Server-side crypto is a fundamentally different domain concern. Separation allows independent evolution and testing.

### Alternative 4: Proxy-Only (No Encryption)

Forward user keys directly without encryption.

**Rejected:** Plaintext keys in transit and in server memory without any protection layer. Violates INV-1.

---

## Consequences

### Positive

✅ Users can supply their own API keys without sharing them with other users
✅ Raw keys never persist server-side (only ephemeral during request processing)
✅ AAD binding prevents cross-user ciphertext misuse
✅ Automatic key rotation on every decrypt (fresh IV per request)
✅ Streaming UX identical to server-key path (SSE)
✅ `ServerLLMRequestPort` interface unchanged — BYOK is an orthogonal concern
✅ Full audit trail for compliance
✅ Revocation is immediate and audited

### Negative

⚠️ `BYOK_ENCRYPTION_KEY` is a critical secret — if leaked, all ciphertexts are compromised. Mitigated by: env var only, never logged, never committed.

⚠️ Client-side ciphertext is lost on localStorage clear. Mitigated by: user can re-encrypt their key at any time.

⚠️ Rotated ciphertext delivered via response header (`X-Byok-Rotated-Ciphertext`) — may hit header size limits for very large payloads. Mitigated by: ciphertext is fixed-size (base64 of 96-bit IV + 128-bit tag + payload).

⚠️ In-memory key metadata and revocation state is lost on server restart. Mitigated by: state is re-derived on next encrypt/proxy call; no persistent server state required.

---

## Validation Criteria

The decision is validated when:

1. ✅ `@hexagen/byok` package builds, typechecks, and passes 59 unit tests
2. ✅ `yarn lint:arch` reports zero BYOK-related boundary violations
3. ✅ Composition root (`byok-wire.ts`) wires all adapters to use cases
4. ✅ 3 API routes (`encrypt`, `proxy`, `revoke`) return correct HTTP status codes
5. ✅ Chat route dispatches to BYOK path when `byokCiphertext` present
6. ✅ Client-side `ByokStore` stores/retrieves ciphertext by provider
7. ✅ Streaming proxy returns SSE `ReadableStream<Uint8Array>`
8. ✅ Rotated ciphertext header is read and applied by client

---

## Follow-Up Actions

### Immediate

- End-to-end browser integration test (manual)
- Add BYOK UI components (settings panel for key entry/rotation/revocation)

### Later (Separate Tickets)

- **Server-side session storage for rotated ciphertext:** Replace response header with server-side cookie/session to improve robustness
- **Rate limiting per userId:** Prevent abuse of the proxy endpoint
- **Key metadata persistence:** If audit requirements demand server-side metadata, add a database adapter for `KeyMetadataPort`
- **Multi-key support:** Allow multiple keys per provider (failover)

---

## References

- **BYOK Invariants:** INV-1 through INV-7 (project-internal)
- **Ciphertext Format:** `packages/byok/src/domain/value-objects/ciphertext.ts`
- **Composition Root:** `apps/web/app/lib/byok-wire.ts`
- **Chat Integration:** `apps/web/app/api/llm/chat/route.ts`
- **Client Store:** `packages/web-driver/src/infrastructure/adapters/local-storage-byok-store.adapter.ts`
- **AES-GCM:** NIST SP 800-38D

---

**Author:** Staff FE Engineer / Lead Architect
**Approved By:** [Awaiting final acceptance]
**Effective Date:** 2026-04-30

---

## Amendment — 2026-10-08: what the browser side does today

The original text above is unchanged. This amendment records what the code does at `origin/main` (plan `docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md` §8, D-2, decided 2026-10-08). It changes no decision of this ADR.

**What the code does.**

- The "Client-Side Store" section and the "Ciphertext storage" row name `ByokStore` and `LocalStorageByokStoreAdapter` as the place ciphertext is kept. The port `ByokStore` still exists in `packages/web-driver/src/application/ports/byok-store.port.ts`. `LocalStorageByokStoreAdapter` was deleted in commit `072c2581b` (#783), with the file `packages/web-driver/src/infrastructure/adapters/local-storage-byok-store.adapter.ts`. Nothing constructs a `ByokStore` in shipped code.
- `useCloudLlm` has a `setByokStore` function (`apps/web/features/governance-assistant/hooks/useCloudLlm.ts`, line 52). Nothing calls it, so `byokStoreRef` stays `null` and the hook sends no `byokCiphertext`.
- The plaintext API key is held in memory only. `apps/web/app/lib/wire.client.ts` (line 273) wires `EphemeralSecretVaultAdapter`, whose own comment says the key is never written to localStorage or IndexedDB (`packages/web-driver/src/infrastructure/adapters/ephemeral-secret-vault.adapter.ts`).
- A start-up step deletes the two localStorage keys the removed adapters could have left, `byok:keys` and `hexagen:vault:encrypted-payload` (`packages/web-driver/src/infrastructure/migration/remove-unused-secret-keys-step.ts`).
- `apps/web/lib/byok-store.ts` is a server SQLite store. It holds key metadata and revocations, and no ciphertext. It is a different thing from the browser `ByokStore` port.

**What this amendment does not do.** It does not move ciphertext to the server. The rejection of "Database-Stored Ciphertext" in the Alternatives section stands. This amendment only brings the description of the browser side in line with the code (plan §8, D-2, decided 2026-10-08).
