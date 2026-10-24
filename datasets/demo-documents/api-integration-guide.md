# Northstar Digital Operations — Orbit API Integration Guide
Document: NDO-API-001. API version: v1.

## Authentication
Use a scoped bearer token and HTTPS. Keep tokens in a server-side secret store. Do not embed tokens in frontend code or URLs. An invalid token produces HTTP 401; a valid token without the required workspace permission produces HTTP 403.

## Pagination and rate limits
List endpoints accept a cursor and a limit between 1 and 100. Continue with next_cursor until it is null. The limit is 120 requests per minute per integration token. HTTP 429 includes Retry-After; clients must back off and add jitter.

## Safe retries
POST /api/v1/projects accepts an Idempotency-Key header. The same key and body return the original result for 24 hours. Reusing a key with a different body returns HTTP 409. Do not retry a mutating request without an idempotency key after an uncertain network failure.

## Diagnostics
Include the response X-Request-ID in sanitized support tickets. Error ORB-409-IDEMPOTENCY indicates key/body mismatch. Error ORB-403-SCOPE indicates a missing workspace scope. The Troubleshooting Guide explains corrective steps. No API operation supports arbitrary SQL or shell execution.
