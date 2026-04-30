# Feature Specification: BYOK Server-Proxy Encryption

**Pattern:** Server-Encrypted Client-Stored Key with Server-Side Proxy
**Version:** 2.0 — Includes AAD Cryptographic Binding + Soft IP Anomaly Detection
**Classification:** Security / Infrastructure
**Threat Model:** XSS cannot exfiltrate raw API keys. Raw keys never re-enter the browser after initial submission. Stolen ciphertext is cryptographically bound to the encrypting user and cannot be replayed by any other authenticated identity.

---

## Invariants (System-Wide, Non-Negotiable)

These hold across every phase and must never be violated:

- `INV-1` The raw API key MUST NOT be returned to the client at any point after initial encryption.
- `INV-2` The server-side encryption secret MUST NOT appear in source code, client bundles, or logs.
- `INV-3` Every `/proxy` and `/encrypt` endpoint MUST require a valid authenticated session.
- `INV-4` The ciphertext in `localStorage` MUST be treated as an untrusted, attacker-observable value. It is cryptographically bound to the encrypting `userId` and is mathematically useless to any other identity.
- `INV-5` All client-server communication MUST occur over HTTPS.
- `INV-6` AAD MUST be reconstructed exclusively from the authenticated server-side session. It MUST NOT be supplied, influenced, or guessable by the client.
- `INV-7` IP address MUST NOT be used as a cryptographic invariant. It MUST only be used as a behavioral heuristic at the middleware layer.

---

## Defense Layer Map

```

Threat Defense Phase
─────────────────────────────────────────────────────────────────────────────────────────────────
XSS reads localStorage → steals ciphertext INV-4 + AAD binding 1 & 3
Attacker submits ciphertext as different authed user AAD mismatch → 422 1 & 3
Attacker hijacks session + submits from new location IP/ASN anomaly → 428 + re-auth 5
Legitimate user switches Wi-Fi → 5G AAD passes; IP logged only 3 & 5
Server secret leaked Versioned rotation 4
Key abused post-compromise Revocation log 4
Audit gap / log tampering Append-only structured events 5

```

---

## Phase 0 — Foundational Secrets & Environment

**Goal:** Establish the server-side secret and environment guards that make all subsequent encryption meaningful.
**Atomic completion criterion:** Server starts and derives a valid encryption key. No later phase begins until all acceptance criteria pass.

### Declarations

```

SECRET SERVER_ENCRYPTION_SECRET - Minimum 256-bit (32-byte) random value - Loaded exclusively from environment variable or secrets manager - Never logged, never serialized into any response or error - Rotatable without full re-deployment (see Phase 4)

DERIVED ENCRYPTION_KEY[version] - AES-256-GCM key derived at startup - Algorithm: HKDF(secret, salt="byok-v{N}", info="byok-enc", length=32) - Stored in an in-process KEY_STORE map: { version → CryptoKey } - Never leaves server process memory - Version integer increments on each rotation event

CONFIG ACTIVE_KEY_VERSION : integer - Identifies which KEY_STORE entry is used for all new encryptions - Readable at runtime; not exposed via any API response

```

### Acceptance Criteria

- [ ] Server refuses to start if `SERVER_ENCRYPTION_SECRET` is absent or shorter than 32 bytes.
- [ ] `ENCRYPTION_KEY` never appears in any log line, response body, error payload, or stack trace.
- [ ] `KEY_STORE` is populated and validated before the HTTP server begins accepting connections.
- [ ] Secret loading is covered by an integration test using a mock secrets provider.
- [ ] A startup smoke test asserts that `EncryptApiKey` followed by `DecryptCiphertext` round-trips correctly using the active key version.

---

## Phase 1 — Key Ingestion & Encryption Endpoint

**Goal:** Accept a raw API key from an authenticated client, encrypt it server-side with AAD bound to the authenticated `userId`, and return only the ciphertext envelope.
**Atomic completion criterion:** `/encrypt` returns a valid ciphertext envelope. The raw key and the `userId` AAD are verifiably absent from all outputs.

### Endpoint Declaration

```

POST /api/byok/encrypt

Authentication : Required — JWT or session cookie (enforced by middleware before handler executes)
Rate Limit : 5 requests / user / hour

Request Body (application/json):
apiKey : string — raw provider API key
provider : enum — [ "openai" | "anthropic" | "cohere" ]

Response 200 (application/json):
ciphertext : string — "v{N}:{base64url(IV || AuthTag || EncryptedPayload)}"
provider : enum — echoed from request
keyId : string — UUIDv4, opaque reference for audit and rotation
createdAt : ISO8601

Response 400 : Malformed request (missing or invalid fields)
Response 401 : Unauthenticated — returned before any crypto operation executes
Response 422 : apiKey fails provider format validation
Response 429 : Rate limit exceeded

```

### Encryption Operation Declaration

```

OPERATION EncryptApiKey(rawKey: string, userId: string, version: integer) → ciphertext: string

PRE-CONDITIONS:
userId is extracted from the verified server-side session — never from request body
version is ACTIVE_KEY_VERSION — never from request body

STEPS: 1. Generate IV : 12 cryptographically random bytes 2. Construct AAD : utf8Encode(userId) 3. Encrypt : AES-256-GCM(
key = KEY_STORE[version],
iv = IV,
aad = AAD,
plain = rawKey
)
→ produces EncryptedPayload + AuthTag (16 bytes, embedded by GCM) 4. Encode payload : base64url( IV[12B] || AuthTag[16B] || EncryptedPayload ) 5. Prefix version : "v{version}:{encoded payload}" 6. Return envelope

POST-CONDITIONS:
rawKey is no longer referenced after this operation returns
AAD (userId) does not appear in the returned ciphertext or any log

MUST NOT: - Log rawKey at any verbosity level - Accept userId, version, or IV from the client request - Return IV, AuthTag, or AAD as separate fields - Proceed if KEY_STORE[version] is absent

```

### Validation Declaration

```

RULE ApiKeyFormatValidation(apiKey: string, provider: enum) → void | throws 422

openai → /^sk-[A-Za-z0-9]{32,}$/
  anthropic → /^sk-ant-[A-Za-z0-9\-]{32,}$/
cohere → /^[A-Za-z0-9]{40}$/

MUST execute BEFORE EncryptApiKey is called.
On failure: return 422 { error: "invalid_key_format", provider } — no ciphertext in response.

```

### Baseline Session Annotation

```

SIDE-EFFECT On successful /encrypt

Store on the authenticated session:
baseline_asn : ASNLookup(request.ip) — used by Phase 5 IpAnomalyCheck middleware
keyId : UUIDv4 — correlates audit events across phases

```

### Acceptance Criteria

- [ ] Response body contains exactly `ciphertext`, `provider`, `keyId`, `createdAt` — no other fields.
- [ ] Raw `apiKey` is absent from the response body, all response headers, and server logs at every verbosity level.
- [ ] `userId` AAD is absent from the response body and all log fields.
- [ ] `401` is returned before any validation or crypto operation if the session is invalid.
- [ ] `422` is returned with a reason string and no ciphertext if `apiKey` format fails.
- [ ] Two consecutive encryptions of the same key produce different ciphertexts (IV uniqueness verified).
- [ ] Ciphertext envelope carries the version prefix `"v{N}:"` matching `ACTIVE_KEY_VERSION`.
- [ ] `baseline_asn` is recorded on the session after successful encryption.

---

## Phase 2 — Client-Side Storage Contract

**Goal:** Define exactly what the client stores, how it stores it, and what it is forbidden from doing with it.
**Atomic completion criterion:** The storage layer is isolated behind a typed interface. No component accesses `localStorage` directly for byok keys.

### Storage Schema Declaration

```

localStorage key : "byok:{provider}"

Stored value (JSON-serialized):
{
ciphertext : string, — opaque versioned envelope from Phase 1; never inspected client-side
provider : enum,
keyId : string,
createdAt : ISO8601,
schemaVer : "1" — incremented on breaking schema changes; triggers migration on read
}

FORBIDDEN fields — MUST NEVER appear in the stored value or anywhere in client memory
at rest after the initial POST /encrypt response is processed:
rawKey | apiKey | decryptedKey | userId | sessionId | any intermediate crypto material

```

### Client Interface Declaration

```

INTERFACE ByokStore

store(provider: enum, encryptionResponse: EncryptResponse) → void
Validates the shape of encryptionResponse before writing.
Throws TypeError if any FORBIDDEN field is present in encryptionResponse.
Writes only the declared schema fields.

retrieve(provider: enum) → StoredKey | null
Returns the stored object or null if absent.
On schemaVer mismatch: logs a migration warning; does not throw.

remove(provider: enum) → void
Deletes the localStorage entry.
Called unconditionally on user logout and on receipt of 403 from /proxy.

listProviders() → enum[]
Returns the list of providers for which a ciphertext is currently stored.

BOUNDARY RULE:
No module outside ByokStore may read or write localStorage keys matching "byok:\*".
Enforced by ESLint custom rule or module boundary test.
Violations are a blocking CI failure.

```

### Client Rotation Handler Declaration

```

HANDLER OnProxyResponse(response: Response, provider: enum) → void

IF response.headers["X-Byok-Rotated-Ciphertext"] is present:
newEnvelope = response.headers["X-Byok-Rotated-Ciphertext"]
ByokStore.store(provider, { ...ByokStore.retrieve(provider), ciphertext: newEnvelope })
— Silent update; no user-visible event

IF response.status === 403 AND body.error === "key_revoked":
ByokStore.remove(provider)
— Trigger UI state: key is gone; prompt re-enrollment

IF response.status === 428 AND body.error === "location_change_detected":
— Trigger UI state: soft re-authentication prompt
— Do NOT remove ciphertext; re-auth re-establishes session; next /proxy call proceeds normally

```

### Acceptance Criteria

- [ ] `ByokStore.store()` throws if the response object contains `rawKey`, `apiKey`, or `userId`.
- [ ] A unit test confirms no module other than `ByokStore` reads or writes `"byok:*"` keys in localStorage.
- [ ] `schemaVer` is present and equals `"1"` on every write.
- [ ] `ByokStore.remove()` is called on user logout (verified by logout integration test).
- [ ] `ByokStore.remove()` is called on receipt of a `403 key_revoked` from `/proxy` (verified by integration test).
- [ ] The rotation handler silently updates the stored ciphertext when `X-Byok-Rotated-Ciphertext` is present.
- [ ] The `428` handler triggers a re-auth prompt without removing the ciphertext.

---

## Phase 3 — Proxy Endpoint

**Goal:** Accept a ciphertext envelope and a provider payload. Reconstruct AAD from the authenticated session. Decrypt server-side. Proxy to the provider. Return the response. The raw key never leaves the server.
**Atomic completion criterion:** End-to-end flow completes. Raw key and AAD are absent from all observable network traffic and logs.

### Endpoint Declaration

```

POST /api/byok/proxy

Authentication : Required — same session credential as /encrypt
Rate Limit : 60 requests / user / minute | 500 requests / user / day
Timeout : 30 seconds (upstream provider hard timeout)

Request Body (application/json):
ciphertext : string — versioned envelope from Phase 2
provider : enum
payload : object — provider-native request body (e.g. OpenAI chat completion params)

Response 200 (application/json):
data : object — verbatim provider response body

Response 400 : Malformed request
Response 401 : Unauthenticated
Response 403 : Key revoked (see Phase 4)
Response 422 : Decryption failure — ciphertext tampered, corrupted, or AAD mismatch
Response 428 : Location change detected — soft re-authentication required (see Phase 5)
Response 429 : Rate limit exceeded
Response 502 : Upstream provider error — surfaced with provider error code

```

### Middleware Execution Order

```

REQUEST → [AuthMiddleware] → [RevocationCheck] → [IpAnomalyCheck] → [RateLimitCheck] → [ProxyHandler]

Each middleware MUST short-circuit and return its designated status code
before the next middleware or handler executes.

```

### Decryption Operation Declaration

```

OPERATION DecryptCiphertext(envelope: string, userId: string) → rawKey: string

PRE-CONDITIONS:
userId is extracted from the verified server-side session — never from request body
envelope format: "v{N}:{base64url blob}"

STEPS: 1. Parse version : extract N from prefix; resolve KEY_STORE[N]
→ if KEY_STORE[N] absent: throw VersionNotFound 2. Decode blob : base64url → binary buffer 3. Slice buffer : IV = buffer[0..11], AuthTag = buffer[12..27], EncPayload = buffer[28..] 4. Construct AAD : utf8Encode(userId) ← reconstructed from session; never from request 5. Decrypt : AES-256-GCM.decrypt(
key = KEY_STORE[N],
iv = IV,
aad = AAD,
authTag = AuthTag,
cipher = EncPayload
)
→ if AuthTag verification fails (tamper OR AAD mismatch): throw DecryptFailure 6. Return rawKey — in local function scope only

POST-CONDITIONS:
rawKey is returned only to ProxyHandler's local scope
rawKey is never assigned to a variable that outlives the request handler function

MUST NOT: - Accept userId or version from the client request body - Log rawKey, IV, AuthTag, or AAD at any verbosity level - Attempt partial decryption on tag failure - Distinguish between "wrong user" and "tampered ciphertext" in the error response
(both return 422 { error: "invalid_ciphertext" } — no information leakage)

```

### Proxy Operation Declaration

```

OPERATION ProxyRequest(rawKey: string, provider: enum, payload: object) → providerResponse

STEPS: 1. Validate format : apply Phase 1 format regex (defense in depth) 2. Build request : construct HTTP request to provider endpoint
inject rawKey into Authorization header value only 3. Call provider : HTTP POST with payload; apply 30s timeout 4. Capture response : store provider response body 5. Release rawKey : rawKey goes out of scope; not stored, not logged, not returned 6. Return response : verbatim provider response body to client

MUST NOT: - Log rawKey or any substring of rawKey - Include rawKey in response body, headers, or error payloads - Cache or memoize rawKey between requests - Forward raw client IP headers to the provider without review

```

### Version Rotation on Proxy Response

```

SIDE-EFFECT PostDecryptionRotationCheck(envelope: string, version: integer, rawKey: string)

IF version < ACTIVE_KEY_VERSION:
newEnvelope = EncryptApiKey(rawKey, userId, ACTIVE_KEY_VERSION)
Set response header: X-Byok-Rotated-Ciphertext: newEnvelope
Emit audit event: byok.key_rotated

rawKey goes out of scope immediately after newEnvelope is produced.

```

### Decryption Failure Rule

```

RULE DecryptionFailure

Triggered by: - AES-GCM AuthTag verification failure (ciphertext tampered or corrupted) - AAD mismatch (ciphertext submitted by a different userId) - Unknown version prefix (KEY_STORE[N] absent)

Response in all cases:
422 { error: "invalid_ciphertext" }

MUST NOT differentiate between failure causes in the response body.
Audit log MAY record the internal reason code for operational use.

Log event: byok.decrypt_failure {
userId, keyId, provider, requestId, reason: enum["tag_failure"|"aad_mismatch"|"version_unknown"]
}
— ciphertext value MUST NOT appear in the log event

```

### Acceptance Criteria

- [ ] A full proxy round-trip network trace contains no occurrence of the raw API key.
- [ ] AAD (`userId`) does not appear in any response body, header, or log field.
- [ ] A ciphertext encrypted for User A returns `422` when submitted under User B's authenticated session.
- [ ] A single-bit-flipped ciphertext returns `422`, not `500`.
- [ ] `rawKey` does not appear in any error serialization, stack trace, or structured log field.
- [ ] `429` responses include `Retry-After` and `X-RateLimit-Remaining` headers.
- [ ] Provider errors surface as `502` with the provider's error code — not swallowed as `500`.
- [ ] Middleware execution order is enforced: auth → revocation → IP anomaly → rate limit → handler.
- [ ] `X-Byok-Rotated-Ciphertext` is present in the response when the ciphertext version is stale.

> **Phases 0–3 constitute the minimum shippable vertical slice.**

---

## Phase 4 — Key Rotation & Revocation

**Goal:** Allow the server-side secret to rotate without forcing user re-enrollment. Allow individual keys to be revoked instantly.
**Atomic completion criterion:** Rotation completes with zero re-enrollment for active users. Revocation takes effect on the next proxy call.

### Rotation Strategy Declaration

```

STRATEGY Envelope Versioned Rotation

Ciphertext envelope format (established in Phase 1):
"v{N}:{base64url(IV || AuthTag || EncryptedPayload)}"

Server state:
ACTIVE_KEY_VERSION : integer — used for all new encryptions
KEY_STORE : { N → CryptoKey } — populated from secrets manager at startup
old versions retained until all ciphertexts migrate

Rotation procedure: 1. Generate new SERVER_ENCRYPTION_SECRET_V{N+1} in secrets manager 2. Derive ENCRYPTION_KEY[N+1] via HKDF 3. Add to KEY_STORE; set ACTIVE_KEY_VERSION = N+1 4. Do NOT delete KEY_STORE[N] — needed to decrypt existing client ciphertexts

Lazy migration on /proxy (declared in Phase 3):
IF parsed version < ACTIVE_KEY_VERSION:
→ Re-encrypt with active version using same userId AAD
→ Return new envelope in X-Byok-Rotated-Ciphertext header
→ Client stores silently (Phase 2 OnProxyResponse handler)

Key version retirement:
KEY_STORE[N] MAY be removed only when audit logs confirm zero ciphertexts
at version N remain in active client storage (verified via keyId tracking).

```

### Revocation Declaration

```

OPERATION RevokeKey(userId: string, provider: enum, revokedBy: string) → void

Server maintains: revocation_log { userId, provider, keyId, revokedAt, revokedBy }

On /proxy — RevocationCheck middleware (executes before IpAnomalyCheck):
Query revocation_log WHERE userId = session.userId AND provider = request.provider
IF entry found:
→ Return 403 { error: "key_revoked" }
→ Emit byok.key_revoked audit event
→ Client calls ByokStore.remove(provider) (Phase 2 OnProxyResponse handler)
→ Do NOT proceed to decryption

Revocation triggers: - User-initiated : DELETE /api/byok/key/{provider} in settings UI - Admin-initiated : internal tooling on abuse or compromise signal - Account deletion : cascade revoke all providers for userId

```

### Acceptance Criteria

- [ ] A `v1` ciphertext is successfully proxied after the server rotates to `v2`.
- [ ] The `X-Byok-Rotated-Ciphertext` header is present in the `v2` response, and the client stores the new envelope silently.
- [ ] After sufficient proxy calls, no `v1` ciphertexts remain in observable client state.
- [ ] `KEY_STORE[1]` can be removed without error once migration is confirmed complete.
- [ ] A revoked key returns `403` on the very next proxy call, with no decryption attempted.
- [ ] `ByokStore.remove()` is triggered client-side on `403 key_revoked` receipt.
- [ ] Account deletion triggers revocation of all provider entries for that `userId`.

---

## Phase 5 — Observability, IP Anomaly Detection & Security Hardening

**Goal:** Full audit trail. Soft IP-based anomaly detection that adds a behavioral defense layer without causing cryptographic failures or UX disruption. HTTP hardening that raises the XSS barrier.
**Atomic completion criterion:** All security events emit structured audit entries. Security headers pass automated scan. IP anomaly middleware operates without interfering with legitimate mobile users.

### IP Anomaly Detection Middleware Declaration

```

MIDDLEWARE IpAnomalyCheck (executes after RevocationCheck, before RateLimitCheck)

State read:
baseline_asn : stored on session during Phase 1 /encrypt (see Phase 1 Baseline Annotation)
current_asn : ASNLookup(request.ip) — resolved per-request

ASNLookup contract:
Input : IPv4 or IPv6 address string
Output : { asn: string, countryCode: ISO3166-1-alpha-2, orgName: string }
Source : local MaxMind GeoIP2 database (no external HTTP call per request)
Failure: if lookup fails, log a warning and ALLOW the request through (fail open)
— a lookup failure MUST NOT block legitimate users

Anomaly condition:
current_asn.countryCode !== baseline_asn.countryCode
AND current_asn.asn !== baseline_asn.asn

On anomaly detected:
→ Emit byok.ip_anomaly { userId, keyId, baselineAsn, currentAsn, requestId, provider }
→ Return 428 { error: "location_change_detected", action: "reauth_required" }
→ Do NOT delete ciphertext from client (re-auth restores session; ciphertext remains valid)
→ Do NOT trigger a 422 — this is behavioral, not cryptographic

On no anomaly:
→ Emit byok.proxy_called with ipAddress field
→ Proceed to RateLimitCheck

INVARIANT (INV-7):
IP address is NEVER passed to EncryptApiKey or DecryptCiphertext as AAD or any crypto input.
IP binding is exclusively a middleware-layer heuristic.

Re-authentication flow:
Client receives 428 → prompts user for session credential (password / MFA)
→ POST /api/auth/reauth establishes new session with current IP as new baseline_asn
→ Next /proxy call proceeds normally with updated baseline

```

### Audit Log Declaration

```

EVENTS (written to an append-only, tamper-evident audit log):

byok.key_stored {
userId, provider, keyId, keyVersion, ipAddress, userAgent, createdAt
}

byok.proxy_called {
userId, provider, keyId, requestId, statusCode, durationMs,
ipAddress, asnCode, countryCode, userAgent, keyVersion
}

byok.decrypt_failure {
userId, provider, keyId, requestId, reason: enum, ipAddress
}

byok.key_revoked {
userId, provider, keyId, revokedBy, revokedAt, reason: string
}

byok.key_rotated {
userId, provider, keyId, oldKeyVersion, newKeyVersion, requestId
}

byok.ip_anomaly {
userId, provider, keyId, requestId,
baselineAsn, baselineCountry, currentAsn, currentCountry, ipAddress
}

byok.rate_limit_hit {
userId, provider, keyId, requestId, limitType: enum["minute"|"daily"], resetAt: ISO8601
}

FORBIDDEN in ALL events (enforced by log scrubber on write path):
rawKey | apiKey | ciphertext | ENCRYPTION_KEY | SERVER_ENCRYPTION_SECRET | AuthTag | IV

```

### HTTP Security Headers Declaration

```

Content-Security-Policy:
default-src 'self';
script-src 'self';
connect-src 'self' https://api.openai.com https://api.anthropic.com;
object-src 'none';
base-uri 'self';
form-action 'self';

Strict-Transport-Security : max-age=63072000; includeSubDomains; preload
X-Content-Type-Options : nosniff
X-Frame-Options : DENY
Referrer-Policy : no-referrer
Permissions-Policy : geolocation=(), camera=(), microphone=()

```

### Rate Limit Hardening Declaration

```

LIMITS (enforced per authenticated userId — never per IP alone):

/encrypt : 5 requests / user / hour
/proxy : 60 requests / user / minute
/proxy : 500 requests / user / day

On limit breach:
→ 429 { error: "rate_limit_exceeded", limitType, resetAt: ISO8601 }
→ Emit byok.rate_limit_hit
→ Set headers: X-RateLimit-Remaining: 0, Retry-After: {seconds}
→ Surface to client UI — MUST NOT silently drop

```

### Dependency & Supply Chain Hardening

```

RULE SupplyChainHardening

CI pipeline MUST enforce (all merge-blocking): - npm audit / pip audit — block on HIGH or CRITICAL severity - Dependency lockfile (package-lock.json / poetry.lock) committed and verified - No third-party analytics scripts on pages where apiKey is entered
(Google Analytics, Hotjar, LogRocket, etc. are prohibited on /settings/keys) - Subresource Integrity (SRI) hashes on any externally loaded scripts

```

### Acceptance Criteria

- [ ] A legitimate user switching from Wi-Fi to 5G (same country) does NOT receive a `428`.
- [ ] A request from a different country AND different ASN triggers `428` and emits `byok.ip_anomaly`.
- [ ] An ASN lookup failure logs a warning and allows the request through — no `428` on lookup error.
- [ ] IP address never appears as an argument to any cryptographic function (verified by code review gate).
- [ ] CSP scan (Mozilla Observatory) scores A or above.
- [ ] Every audit event type is asserted present in integration tests for the happy path and each error path.
- [ ] Log scrubber test confirms no audit event contains `"sk-"`, `"sk-ant-"`, or any raw key substring.
- [ ] `X-RateLimit-Remaining` and `Retry-After` headers present on every `/proxy` response.
- [ ] `npm audit` / `pip audit` runs in CI and blocks merge on high or critical severity findings.
- [ ] No third-party script tags present on the key management UI page (verified by automated scan).

---

## Phase Dependency Graph

```

Phase 0 — Foundational Secrets & Environment
│
└── Phase 1 — Key Ingestion & Encryption Endpoint (AAD binding established)
│
└── Phase 2 — Client-Side Storage Contract
│
└── Phase 3 — Proxy Endpoint ← minimum shippable vertical slice
│ (AAD reconstruction, IP anomaly middleware stub)
│
├── Phase 4 — Key Rotation & Revocation
│
└── Phase 5 — Observability, IP Anomaly & Hardening

```

**Phases 0–3:** Minimum shippable vertical slice. No phase begins until its predecessor's acceptance criteria are fully green.
**Phases 4–5:** Required before general availability. May be developed in parallel after Phase 3 ships internally.

---

## Integrated Security Posture Summary

```

Attack Vector Result Layer
──────────────────────────────────────────────────────────────────────────────────────────────
XSS reads localStorage Gets opaque ciphertext only INV-4
XSS posts ciphertext as victim Blocked by session auth INV-3
Attacker submits ciphertext as other user 422 — AAD mismatch Phase 1 & 3
Session hijack from new country/ASN 428 — soft re-auth required Phase 5
Brute-force /proxy 429 — per-user rate limit Phase 3 & 5
Server secret leaked Rotate to new version Phase 4
Individual key compromised Revoke; 403 on next call Phase 4
Log exfiltration No secrets in logs (scrubber) Phase 5
Supply chain (malicious npm package) SRI + audit in CI Phase 5
Replay ciphertext after revocation 403 — revocation log check Phase 4

```

---

## Definition of Done

- [ ] All invariants `INV-1` through `INV-7` pass a dedicated security review checklist signed off by a second engineer.
- [ ] Penetration test (or structured threat-model walkthrough) confirms raw key is absent from all network-observable traffic.
- [ ] AAD binding verified: integration test confirms User B's session cannot decrypt User A's ciphertext.
- [ ] IP anomaly middleware verified: does not fire for same-country carrier IP changes; does fire for cross-country ASN changes.
- [ ] Secret rotation executed once in staging environment with zero user re-enrollment events observed.
- [ ] All audit event types are queryable by `userId` and `keyId` in the observability stack.
- [ ] CSP headers score A or above on Mozilla Observatory automated scan.
- [ ] CI pipeline enforces lint + unit tests + integration tests + dependency audit — all merge-blocking.
- [ ] Key management UI page passes automated scan confirming absence of third-party script tags.
