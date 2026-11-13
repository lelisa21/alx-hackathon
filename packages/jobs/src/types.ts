import type { Pool } from "pg";

export type JobChannel = "sms" | "telegram";
export const accommodationNeeds = [
  "sign_language_interpreter",
  "step_free_access",
  "written_questions",
  "extra_time",
  "screen_reader_friendly_test",
  "other",
] as const;
export type AccommodationNeed = (typeof accommodationNeeds)[number];
export interface PublicJob {
  id: string;
  title: string;
  description: string;
  organization: string;
  location: string;
  region: string | null;
  jobType: string | null;
  datePosted: string;
  deadline: string | null;
  url: string;
  lang: string;
  accommodationsOffered: string[];
}
export interface AccommodationFields {
  needs: AccommodationNeed[];
  otherText?: string;
  name?: string;
  interviewAt?: string;
}
export interface AccommodationView extends AccommodationFields {
  id: string;
  jobId: string;
  lang: string;
  revision: number;
  status: "draft" | "approved" | "sent" | "cancelled";
  message: string;
  sendAttempted: boolean;
}
export type AccommodationInput =
  | ({
      action: "draft";
      sessionId: string;
      clientRequestId: string;
      jobId: string;
      lang: string;
    } & AccommodationFields)
  | {
      action: "resume" | "approve" | "send" | "cancel";
      sessionId: string;
      id: string;
      revision?: number;
    };
export interface SubscriptionInput {
  sessionId: string;
  clientRequestId: string;
  jobType?: string;
  region?: string;
  lang: string;
  channel: JobChannel;
  contact: string;
  consent: { accepted: true; noticeVersion: "job-alerts-v1" };
}
export interface SubscriptionView {
  id: string;
  status: "active" | "stopped";
  jobType?: string;
  region?: string;
  lang: string;
  channel: JobChannel;
}
/** Adapters must durably deduplicate idempotencyKey and enforce channel limits.
 * They must settle within 10 seconds so a concurrent Stop remains bounded. */
export interface JobsDelivery {
  channels: readonly JobChannel[];
  relayAvailable: boolean;
  sendDigest(input: {
    channel: JobChannel;
    contact: string;
    lang: string;
    text: string;
    jobs: PublicJob[];
    idempotencyKey: string;
  }): Promise<void>;
  sendAccommodation(input: {
    to: string;
    message: string;
    lang: string;
    idempotencyKey: string;
  }): Promise<void>;
}
export interface JobsServiceOptions {
  pool: Pool;
  encryptionKey: Buffer;
  hashKey: Buffer;
  delivery: JobsDelivery;
  renderAccommodation(
    input: AccommodationFields & { lang: string; job: PublicJob },
  ): string;
  renderDigest(input: { lang: string; jobs: PublicJob[] }): string;
  now?: () => Date;
  consentLifetimeDays?: number;
}
export class JobsError extends Error {
  readonly code:
    "invalid" | "not_found" | "conflict" | "unavailable" | "delivery_failed";
  constructor(code: JobsError["code"]) {
    super(code);
    this.name = "JobsError";
    this.code = code;
  }
}
