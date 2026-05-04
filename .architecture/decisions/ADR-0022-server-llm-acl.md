# ADR-0022: Server-Context LLM ACL

**Date:** 2026-04-22
**Status:** Proposed

## Context

The post-remediation review (Finding F-1) identified a critical security vulnerability in the server-side cloud chat route (`apps/web/app/api/llm/chat/route.ts`). The route acts as an unauthenticated LLM proxy, instantiating an `OpenAICompatibleAdapter` directly with an API key provided in the request body. This allows any network caller to use the system's LLM capabilities without authentication, authorization, or rate limiting.

The client-side ACL pattern, which relies on `SendStructuredRequestPort`, is not suitable for the server context. A dedicated server-side ACL architecture is required.

## Decision

We will implement a multi-layered security and architectural solution to close this vulnerability. The core principles are to enforce authentication, adhere to Hexagonal Architecture, and introduce security best practices like rate limiting and secure key management.

### 1. Architectural Changes

- **New Port:** A new port, `ServerLLMRequestPort`, will be defined in the `local-llm` bounded context's application layer (`packages/local-llm/src/application/ports/in/`). This port will define the contract for handling server-side LLM chat requests.
- **New Use Case:** A `HandleServerChatUseCase` will be implemented to orchestrate the server-side chat logic. It will be responsible for authorization, calling the LLM provider, and handling the response.
- **Route Handler Refactor:** The Next.js route handler in `route.ts` will be refactored to be a simple driver. It will extract user session data, invoke the `HandleServerChatUseCase` via the new port, and stream the response back to the client. It will **no longer** instantiate any adapters directly.

### 2. Authentication & Authorization

- **Session Enforcement:** All requests to the `/api/llm/chat` route must have a valid user session. The route handler will use the `getServerSession` function from `next-auth` to retrieve the session. Unauthenticated requests will be rejected with a `401 Unauthorized` error.
- **User-based ACL (Future):** While not in the immediate scope, this architecture will enable future extensions for fine-grained, user-based access control (e.g., checking user roles or subscription tiers) within the `HandleServerChatUseCase`.

### 3. Security Measures

- **Secure API Key Management:** The `apiKey` will be removed from the request body. The `OpenAICompatibleAdapter` (or any other LLM adapter) must be configured on the server-side using environment variables (e.g., `process.env.OPENAI_API_KEY`).
- **Rate Limiting:** A simple, in-memory rate-limiting mechanism will be added to the route handler to prevent abuse. It will be based on the authenticated user's ID. For the initial implementation, a token bucket algorithm (e.g., 10 requests per minute) will be sufficient. A warning will be logged if a more robust distributed solution like Redis is needed in the future.

### 4. Data Flow

1.  Client makes a `fetch` request to `/api/llm/chat` (with credentials).
2.  Next.js route handler (`route.ts`) receives the request.
3.  Handler retrieves the user session via `next-auth`.
4.  Handler applies rate limiting check.
5.  Handler invokes the `HandleServerChatUseCase` via the `ServerLLMRequestPort`, passing the request payload and user identity.
6.  The use case gets the appropriate LLM adapter via the `CloudLLMProviderPort` (dependency injection).
7.  The adapter, configured with the server-side API key, makes the request to the LLM provider.
8.  The response is streamed back through the layers to the client.

## Consequences

- **Pro:** The critical security vulnerability is closed.
- **Pro:** The server-side LLM interaction now follows the principles of Hexagonal Architecture, improving maintainability and testability.
- **Pro:** The system is more robust against abuse due to rate limiting.
- **Con:** Introduces a small amount of new code (port, use case) and complexity, which is justified by the severity of the issue.
- **Con:** The in-memory rate limiter is not suitable for multi-node production deployments but serves as a crucial first step.
