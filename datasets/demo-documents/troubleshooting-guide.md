# Northstar Digital Operations — Orbit Troubleshooting Guide
Document: NDO-TECH-001.

## ORB-403-SCOPE
The token is valid but lacks permission for the target workspace or operation. Confirm the workspace identifier and token scopes with a workspace administrator. Do not solve the error by sharing an administrator's token. Request only the scope the integration needs.

## ORB-409-IDEMPOTENCY
The same idempotency key was used with a different request body. Compare the original request hash with the retried payload. If the operation is new, generate a new key. If it is a retry, use the original body. The API preserves successful idempotent results for 24 hours.

## HTTP 429
Respect Retry-After, apply exponential backoff with jitter, and cap retries at five attempts. Check whether multiple workers share the same integration token. The rate limit is 120 requests per minute per token, not per worker.

## Timeout after project creation
Do not assume that a timeout means creation failed. Retry with the original Idempotency-Key and body. If status remains uncertain, send the sanitized X-Request-ID to customer support and preserve timestamps. Never include access tokens in the ticket.
