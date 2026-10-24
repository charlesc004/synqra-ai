# Northstar Digital Operations — Internal FAQ
Document: NDO-FAQ-001.

## How many remote days are allowed?
Up to three days per week after onboarding and manager approval. Fully remote arrangements require a separate written agreement. The Remote Work Policy is authoritative for eligibility and expenses.

## Where do I escalate a customer outage?
Notify the on-call engineer immediately and create a Severity 1 incident ticket. Support acknowledges within 15 minutes. Consult both the Customer Support Handbook and Incident Response Playbook for escalation and communication ownership.

## How often is system access reviewed?
The current policy, NDO-SEC-001 version 2.0, requires a review every 30 days. Older documents mentioning 90 days are superseded.

## Can an integration retry project creation?
Yes, with the same Idempotency-Key and identical body within 24 hours. A changed body returns ORB-409-IDEMPOTENCY. See the API Integration Guide.

## Who can approve project launch?
The delivery lead and customer sponsor confirm the acceptance criteria at Gate 3. Quality checks must be recorded before launch. See the Project Delivery Guidelines. Do not treat an AI-generated summary as an approval record.
