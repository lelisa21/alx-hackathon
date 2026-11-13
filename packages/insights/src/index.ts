/**
 * P09: Anonymous Feedback and Teacher Insights Service
 *
 * Requirement quotes:
 * - FR-CONV-12: feedback message controls (already in P02/P03)
 * - FR-INSIGHT-01-04: aggregation, access control, export, display
 * - FR-UI-20: teacher insights page
 * - NFR-PRIV-03: privacy guarantees (small-cell suppression, no identifiers)
 *
 * This service aggregates anonymous feedback data without exposing:
 * - Session IDs, question text, or learner identifiers
 * - Groups <5 combined into "Other"
 */

export type { InsightQuery, InsightRow, InsightsRepository, InsightsService, RawInsightRow } from './types.js';
export { createInsightsService } from './service.js';
