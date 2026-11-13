/**
 * P09: Anonymous feedback and teacher insights
 * Domain types and interfaces for aggregating feedback data
 */

export interface InsightQuery {
  startDate?: string; // ISO 8601 date YYYY-MM-DD
  endDate?: string;
  lang?: string; // BCP 47 code or null for all
  minCellSize?: number; // default 5; groups <5 become "Other"
}

export interface InsightRow {
  topicId: string;
  topicLabel: string | null; // label from passage if available, else null
  lang: string;
  period: string; // ISO 8601 date
  questionCount: number;
  notfoundCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
}

export interface RawInsightRow {
  topic_id: string;
  lang: string;
  period: string;
  question_count: number;
  notfound_count: number;
  helpful: number;
  unhelpful: number;
}

export interface InsightsRepository {
  queryInsights(query: InsightQuery): Promise<RawInsightRow[]>;
  topicLabel(topicId: string): Promise<string | null>;
}

export interface InsightsService {
  getRows(query: InsightQuery): Promise<InsightRow[]>;
  toCsv(rows: InsightRow[]): string;
}
