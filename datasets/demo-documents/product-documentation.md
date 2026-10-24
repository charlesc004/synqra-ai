# Northstar Digital Operations — Orbit Product Documentation
Document: NDO-PROD-001. Product: Orbit, a fictional project-delivery service.

## Workspaces and projects
Orbit organizes delivery work into isolated workspaces. A project belongs to one workspace and contains milestones, tasks, and status notes. Workspace administrators manage membership. Viewers can read project information but cannot edit milestones or create tasks.

## Milestones
A milestone has a name, owner, target date, and acceptance criteria. A completed milestone must include a linked acceptance record. Changing a committed target date requires a written impact note. Project Delivery Guidelines define the review gates for customer projects.

## Integrations
The REST API uses bearer access tokens issued by a workspace administrator. Integrations should request only required scopes. External project identifiers must be unique within a workspace. The API Integration Guide describes pagination, rate limits, and idempotency.

## Data retention
Archived projects remain read-only for 12 months before a scheduled retention review. Deletion is restricted to administrators and requires explicit confirmation. Orbit does not automatically send external email or execute customer-provided scripts.
