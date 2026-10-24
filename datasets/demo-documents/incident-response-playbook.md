# Northstar Digital Operations — Incident Response Playbook
Document: NDO-IR-001. Version 1.0.

## First response
1. Report the suspected incident to the on-call engineer immediately and open an incident ticket.
2. Record the time, affected services, observed impact, and reporter. Preserve relevant logs without copying secrets.
3. The on-call engineer assesses severity and appoints an incident commander within 15 minutes for Severity 1.
4. Contain the issue using approved changes. Do not destroy logs, rotate unrelated systems, or make unreviewed production changes.

## Coordination
The commander assigns a technical lead and a communications owner. Support acknowledges Severity 1 customer reports within 15 minutes and publishes commander-approved updates every 30 minutes. The technical lead records each change and its outcome in the incident timeline.

## Recovery
Validate recovery using service health checks and affected customer workflows. Maintain heightened monitoring for 60 minutes before declaring resolution. The commander approves closure.

## Learning
Complete a blameless review within three business days. Identify contributing factors, evidence, and follow-up actions with owners and due dates. Track actions until closure. Security incidents involving access follow the currently effective IT Security Policy version 2.0.
