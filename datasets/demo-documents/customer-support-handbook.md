# Northstar Digital Operations — Customer Support Handbook
Document: NDO-CS-001. Version 1.0.

## Severity and response
Severity 1 means a production outage affecting multiple customers. Acknowledge within 15 minutes and notify the on-call engineer immediately. Severity 2 means a major feature is degraded with a workaround; acknowledge within one hour. Severity 3 covers ordinary questions and minor defects; acknowledge within one business day. These are internal response targets, not promises of resolution.

## Escalation
Create a ticket containing the workspace identifier, impact, timestamps in UTC, reproduction steps, and sanitized request IDs. Never attach credentials or unredacted customer secrets. Escalate unresolved Severity 2 issues to engineering after two hours. Engineering confirms ownership in the ticket.

## Incident communication
When an incident is declared, the incident commander owns customer-facing update approval. Support publishes approved updates every 30 minutes for Severity 1 incidents. The Incident Response Playbook specifies commander assignment and evidence preservation.

## Closure
Confirm recovery with the customer, link the root-cause review, and record any promised follow-up as an action item with an owner. Customer support escalation is also summarized in the Internal FAQ.
