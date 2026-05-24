# AGENT.md

## Purpose

This file defines implementation responsibilities and constraints for coding agents working on `~/Dev/job-web`.

The project is a frontend application for browsing and searching job postings, viewing job details, and later receiving resume-based recommendations.

## Deployment Environment

- The service runs on Kubernetes in the Oracle VM environment.
- Deployment manifests are maintained in `~/Dev/k8s-manifests`.
- Application code lives in `~/Dev/job-web`.
- The app should follow a structure and operational style similar to `~/Dev/community-web`.
- The app connects to PostgreSQL and Elasticsearch running in the homelab environment.

## Product Goals

The frontend should provide:

1. job posting listing
2. keyword search
3. job detail pages
4. original job posting URL links for application
5. mobile-friendly UI
6. resume upload and management UI for future recommendation flows

## Initial User Experience

### Job Listing

- Show job postings sorted by recommendation score in descending order.
- The score is based on hybrid search using the user's resume.
- The exact hybrid retrieval logic will be finalized later.
- Before the hybrid scoring pipeline is ready, keep the sorting implementation replaceable.

### Search

- Support keyword-based search across collected job postings.
- Search should work together with the default recommendation-oriented ordering.

### Job Detail

- Show data collected and stored in the database first.
- Include core fields such as company, title, location, level, team, skills, description, and timestamps when available.
- Provide a clear external link to the original posting URL so the user can apply from the source site.

### Resume Flow

- Provide a UI for uploading or registering the user's resume.
- The frontend should support a flow where the resume is stored, embedded through the Mac Studio local embedding service, and the resulting embedding is persisted for later recommendation use.
- Do not hardcode the embedding implementation into the UI layer.
- Keep the resume flow separable from the job browsing flow.

## Architecture Guidelines

- Keep the frontend simple and presentation-focused.
- Backend services should own search, scoring, resume persistence, and embedding orchestration.
- Prefer clear API boundaries over embedding logic inside the frontend.
- Design the UI so that recommendation ranking can evolve without major page rewrites.
- Keep deployment assumptions aligned with Kubernetes, not local docker-compose.

## Data Integration Expectations

- PostgreSQL is the primary source for collected job detail records and resume-related metadata.
- Elasticsearch is used for search and recommendation retrieval support.
- The frontend must tolerate incomplete recommendation data while the hybrid pipeline is still evolving.

## Mobile Requirements

- The UI must work well on mobile from the start.
- Prioritize readable lists, compact filters, touch-friendly controls, and usable detail pages on narrow screens.
- Avoid desktop-only layouts.

## Codex Responsibilities

Codex should focus on:

- frontend implementation
- UI structure and routing
- mobile-responsive layouts
- API integration
- resume upload flow scaffolding
- tests
- coordination with Kubernetes deployment manifests in `~/Dev/k8s-manifests`

Codex should optimize for:

- readability
- modularity
- small PR-sized changes
- replaceable search and ranking integrations

## Important Constraints

Do NOT:

- hardcode credentials or cluster endpoints
- place hybrid scoring logic directly in UI components
- tightly couple resume upload UI to one embedding implementation
- assume recommendation scoring is finalized
- block the basic listing and detail experience on the recommendation pipeline

## Suggested MVP Deliverables

Implement first:

1. application skeleton matching the chosen frontend stack
2. job listing page
3. keyword search UI
4. job detail page
5. external source URL handling
6. responsive mobile layout
7. resume upload or registration UI
8. API client structure for PostgreSQL/Elasticsearch-backed backend services
9. deployment manifest updates in `~/Dev/k8s-manifests`

## Suggested Repository Structure

```text
src/
  app/
  components/
  features/
    jobs/
    resume/
  lib/
  styles/
public/
tests/
```

## Git Rules

- Small commits
- Descriptive commit messages
- Avoid giant refactors
- Prefer incremental progress
