import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ContactCipher } from "./crypto.js";
import { normalizePostings } from "./postings.js";
import { validateAccommodation } from "./validation.js";
import {
  JobsError,
  type AccommodationInput,
  type AccommodationView,
  type JobsServiceOptions,
  type PublicJob,
  type SubscriptionInput,
  type SubscriptionView,
  type JobChannel,
} from "./types.js";

interface SubscriptionRow {
  id: string;
  session_id: string;
  channel: JobChannel;
  contact_enc: Buffer | null;
  lang: string;
  job_type: string | null;
  region: string | null;
  stopped_at: Date | null;
  consent_expires_at: Date | null;
}
interface RequestRow {
  id: string;
  job_id: string;
  lang: string;
  revision: number;
  status: AccommodationView["status"];
  private_enc: Buffer | null;
  delivery_attempted: boolean;
}
type PrivateDraft = Omit<
  AccommodationView,
  "id" | "revision" | "status" | "sendAttempted"
> & {
  employerEmail: string;
};
interface DigestRow {
  job_ids: string[];
  job_snapshot: PublicJob[];
  message: string;
  status: string;
  idempotency_key: string;
  day?: Date | string;
}

export class JobsService {
  private readonly options: JobsServiceOptions;
  private readonly cipher: ContactCipher;
  private readonly now: () => Date;
  constructor(options: JobsServiceOptions) {
    this.options = options;
    this.cipher = new ContactCipher(options.encryptionKey, options.hashKey);
    this.now = options.now ?? (() => new Date());
    if (
      !Number.isInteger(options.consentLifetimeDays ?? 30) ||
      (options.consentLifetimeDays ?? 30) < 1 ||
      (options.consentLifetimeDays ?? 30) > 365
    )
      throw new JobsError("invalid");
  }
  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint" in error &&
          error.constraint === "accommodation_approved_interview_idx"
        )
          throw new JobsError("conflict");
        throw error;
      }
    } finally {
      client.release();
    }
  }
  async authorizeImporter(keyHash: string): Promise<boolean> {
    const result = await this.options.pool.query(
      "SELECT 1 FROM host_key WHERE key_hash=$1 AND key_type='secret'",
      [keyHash],
    );
    return result.rows.length === 1;
  }
  async importJobs(input: { lang: string; postings: unknown }): Promise<{
    imported: number;
    errors: { index: number; reason: string }[];
  }> {
    const { jobs, errors } = normalizePostings(input.postings, input.lang);
    if (!jobs.length) return { imported: 0, errors };
    await this.transaction(async (client) => {
      const sourceId = `jobs:${input.lang}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        sourceId,
      ]);
      const generationId = randomUUID();
      const hash = createHash("sha256")
        .update(JSON.stringify(jobs))
        .digest("hex");
      await client.query(
        "INSERT INTO content_version(id,source_hash) VALUES($1,$2)",
        [generationId, hash],
      );
      await client.query(
        "INSERT INTO source_generation(id,source_id,mode,status,discovered,indexed) VALUES($1,$2,'incremental','staging',$3,$3)",
        [generationId, sourceId, jobs.length],
      );
      const passageIds = jobs.map(({ passage }) =>
        createHash("sha256")
          .update(JSON.stringify([sourceId, passage.lessonId, passage.id]))
          .digest("hex"),
      );
      await client.query(
        `INSERT INTO passage(id,content_version_id,lesson_id,lesson_title,section_title,anchor,url,lang,source_type,ts_start,text,text_norm,grams,source_id,source_resource_id)
        SELECT p.id,$1,p.lesson_id,p.lesson_title,p.section_title,p.anchor,p.url,p.lang,p.source_type,p.ts_start,p.text,p.text_norm,p.grams,p.source_id,p.source_resource_id
        FROM passage p JOIN active_source_generation a ON a.generation_id=p.content_version_id
        WHERE a.source_id=$2 AND NOT(p.id=ANY($3::text[]))`,
        [generationId, sourceId, passageIds],
      );
      for (const [index, job] of jobs.entries()) {
        const value = job.publicJob;
        await client.query(
          `INSERT INTO job(id,posting,title,region,job_type,deadline,accommodations_offered,lang,employer_email)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET posting=EXCLUDED.posting,title=EXCLUDED.title,region=EXCLUDED.region,job_type=EXCLUDED.job_type,deadline=EXCLUDED.deadline,accommodations_offered=EXCLUDED.accommodations_offered,lang=EXCLUDED.lang,employer_email=EXCLUDED.employer_email,imported_at=now()`,
          [
            value.id,
            JSON.stringify(value),
            value.title,
            value.region,
            value.jobType,
            value.deadline?.slice(0, 10) ?? null,
            value.accommodationsOffered,
            value.lang,
            job.employerEmail,
          ],
        );
        const p = job.passage;
        await client.query(
          `INSERT INTO passage(id,content_version_id,lesson_id,lesson_title,section_title,anchor,url,lang,source_type,ts_start,text,text_norm,grams,source_id,source_resource_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'job',NULL,$9,$10,$11,$12,$3)
          ON CONFLICT(content_version_id,id) DO UPDATE SET text=EXCLUDED.text,text_norm=EXCLUDED.text_norm,grams=EXCLUDED.grams,lesson_title=EXCLUDED.lesson_title,section_title=EXCLUDED.section_title`,
          [
            passageIds[index],
            generationId,
            p.lessonId,
            p.lessonTitle,
            p.sectionTitle,
            p.anchor,
            p.url,
            p.lang,
            p.text,
            p.textNorm,
            p.grams,
            sourceId,
          ],
        );
      }
      await client.query(
        "UPDATE source_generation SET status='retired' WHERE source_id=$1 AND status='active'",
        [sourceId],
      );
      await client.query(
        "UPDATE source_generation SET status='active',completed_at=clock_timestamp() WHERE id=$1",
        [generationId],
      );
      await client.query(
        "INSERT INTO active_source_generation(source_id,generation_id) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET generation_id=EXCLUDED.generation_id",
        [sourceId, generationId],
      );
      await client.query("DELETE FROM answer_cache");
    });
    return { imported: jobs.length, errors };
  }
  async listJobs(
    filters: { lang?: string; region?: string; type?: string } = {},
  ): Promise<PublicJob[]> {
    const result = await this.options.pool.query<{ posting: PublicJob }>(
      `SELECT posting FROM job WHERE ($1::text IS NULL OR lang=$1) AND ($2::text IS NULL OR lower(region)=lower($2)) AND ($3::text IS NULL OR lower($3)=ANY(string_to_array(lower(job_type), ', '))) AND (deadline IS NULL OR deadline >= $4::date) ORDER BY imported_at DESC,id LIMIT 200`,
      [
        filters.lang ?? null,
        filters.region ?? null,
        filters.type ?? null,
        this.now().toISOString().slice(0, 10),
      ],
    );
    return result.rows.map((row) => row.posting);
  }
  async subscribe(
    input: SubscriptionInput,
  ): Promise<{ id: string; status: "active" | "stopped" }> {
    // Consent is inspected before contact normalization, encryption, or persistence.
    if (
      input.consent?.accepted !== true ||
      input.consent.noticeVersion !== "job-alerts-v1"
    )
      throw new JobsError("invalid");
    if (!this.options.delivery.channels.includes(input.channel))
      throw new JobsError("unavailable");
    const contact = input.contact.trim();
    if (
      !(input.channel === "sms"
        ? /^\+[1-9]\d{6,14}$/u.test(contact)
        : /^[1-9]\d{0,19}$/u.test(contact))
    )
      throw new JobsError("invalid");
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `subscription:${input.sessionId}:${input.clientRequestId}`,
      ]);
      const previous = await client.query<SubscriptionRow>(
        "SELECT * FROM subscription WHERE session_id=$1 AND client_request_id=$2 FOR UPDATE",
        [input.sessionId, input.clientRequestId],
      );
      if (previous.rows[0])
        return {
          id: previous.rows[0].id,
          status: this.active(previous.rows[0]) ? "active" : "stopped",
        };
      const id = randomUUID();
      const now = this.now();
      const expires = new Date(
        now.getTime() + (this.options.consentLifetimeDays ?? 30) * 86_400_000,
      );
      await client.query(
        `INSERT INTO subscription(id,session_id,channel,contact_enc,contact_hash,lang,job_type,region,client_request_id,consent_expires_at,notice_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          input.sessionId,
          input.channel,
          this.cipher.encrypt(contact, `subscription:${id}`),
          this.cipher.hash(input.channel, contact),
          input.lang,
          input.jobType ?? null,
          input.region ?? null,
          input.clientRequestId,
          expires,
          input.consent.noticeVersion,
          now,
        ],
      );
      await client.query(
        "INSERT INTO consent_log(id,channel,notice_version,purpose,created_at) VALUES($1,$2,$3,'job_alerts',$4)",
        [randomUUID(), input.channel, input.consent.noticeVersion, now],
      );
      return { id, status: "active" };
    });
  }
  private active(row: SubscriptionRow): boolean {
    return (
      !row.stopped_at &&
      row.contact_enc !== null &&
      row.consent_expires_at !== null &&
      new Date(row.consent_expires_at).getTime() > this.now().getTime()
    );
  }
  async listSubscriptions(input: {
    sessionId: string;
  }): Promise<SubscriptionView[]> {
    const result = await this.options.pool.query<SubscriptionRow>(
      "SELECT * FROM subscription WHERE session_id=$1 ORDER BY created_at DESC,id",
      [input.sessionId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: this.active(row) ? "active" : "stopped",
      lang: row.lang,
      channel: row.channel,
      ...(row.job_type ? { jobType: row.job_type } : {}),
      ...(row.region ? { region: row.region } : {}),
    }));
  }
  async stopSubscription(input: {
    sessionId: string;
    id: string;
  }): Promise<boolean> {
    const result = await this.options.pool.query(
      "UPDATE subscription SET stopped_at=COALESCE(stopped_at,$3),contact_enc=NULL,contact_hash=NULL WHERE id=$1 AND session_id=$2 RETURNING id",
      [input.id, input.sessionId, this.now()],
    );
    return result.rows.length === 1;
  }
  private decodeRequest(row: RequestRow): {
    view: AccommodationView;
    privateDraft: PrivateDraft | null;
  } {
    const privateDraft = row.private_enc
      ? (JSON.parse(
          this.cipher.decrypt(row.private_enc, `accommodation:${row.id}`),
        ) as PrivateDraft)
      : null;
    const view: AccommodationView = {
      id: row.id,
      jobId: row.job_id,
      lang: row.lang,
      revision: row.revision,
      status: row.status,
      sendAttempted: row.delivery_attempted,
      message: privateDraft?.message ?? "",
      needs: privateDraft?.needs ?? [],
      ...(privateDraft?.otherText ? { otherText: privateDraft.otherText } : {}),
      ...(privateDraft?.name ? { name: privateDraft.name } : {}),
      ...(privateDraft?.interviewAt
        ? { interviewAt: privateDraft.interviewAt }
        : {}),
    };
    return { view, privateDraft };
  }
  async accommodation(input: AccommodationInput): Promise<AccommodationView> {
    if (input.action === "draft") {
      validateAccommodation(input);
      if (
        input.interviewAt &&
        Date.parse(input.interviewAt) + 30 * 86_400_000 <= this.now().getTime()
      )
        throw new JobsError("invalid");
    }
    // Deletion is committed separately so a subsequent not-found/conflict cannot
    // roll privacy cleanup back. Expired approvals must not block a new request.
    await this.options.pool.query(
      "DELETE FROM accommodation_request WHERE session_id=$1 AND expires_at<=$2",
      [input.sessionId, this.now()],
    );
    if (input.action === "send") {
      // Persist the attempt BEFORE invoking a transport. A process/SQL failure
      // after external acceptance must not allow cancellation or a fresh key.
      await this.transaction(async (client) => {
        const row = (
          await client.query<RequestRow>(
            "SELECT * FROM accommodation_request WHERE id=$1 AND session_id=$2 AND expires_at>$3 FOR UPDATE",
            [input.id, input.sessionId, this.now()],
          )
        ).rows[0];
        if (!row) throw new JobsError("not_found");
        if (
          input.revision !== row.revision ||
          (row.status !== "approved" && row.status !== "sent")
        )
          throw new JobsError("conflict");
        if (row.status === "sent") return;
        if (!this.options.delivery.relayAvailable)
          throw new JobsError("unavailable");
        await client.query(
          "UPDATE accommodation_request SET delivery_attempted=TRUE WHERE id=$1",
          [row.id],
        );
      });
    }
    const result = await this.transaction(async (client) => {
      if (input.action === "draft") {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `accommodation:${input.sessionId}:${input.clientRequestId}`,
        ]);
        const previous = (
          await client.query<RequestRow>(
            "SELECT * FROM accommodation_request WHERE session_id=$1 AND client_request_id=$2 AND expires_at>$3 FOR UPDATE",
            [input.sessionId, input.clientRequestId, this.now()],
          )
        ).rows[0];
        if (
          previous &&
          (previous.status !== "draft" || previous.delivery_attempted)
        )
          throw new JobsError("conflict");
        const approved = await client.query(
          "SELECT 1 FROM accommodation_request WHERE session_id=$1 AND job_id=$2 AND status='approved' AND expires_at>$3",
          [input.sessionId, input.jobId, this.now()],
        );
        if (approved.rows.length) throw new JobsError("conflict");
        const job = (
          await client.query<{
            posting: PublicJob;
            employer_email: string | null;
          }>("SELECT posting,employer_email FROM job WHERE id=$1", [
            input.jobId,
          ])
        ).rows[0];
        if (!job) throw new JobsError("not_found");
        if (!this.options.delivery.relayAvailable || !job.employer_email)
          throw new JobsError("unavailable");
        const fields = {
          needs: input.needs,
          ...(input.otherText ? { otherText: input.otherText.trim() } : {}),
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.interviewAt ? { interviewAt: input.interviewAt } : {}),
        };
        const privateDraft: PrivateDraft = {
          ...fields,
          jobId: input.jobId,
          lang: input.lang,
          employerEmail: job.employer_email,
          message: this.options.renderAccommodation({
            ...fields,
            job: job.posting,
            lang: input.lang,
          }),
        };
        if (
          previous &&
          JSON.stringify(this.decodeRequest(previous).privateDraft) ===
            JSON.stringify(privateDraft)
        )
          return this.decodeRequest(previous).view;
        const id = previous?.id ?? randomUUID();
        const revision = (previous?.revision ?? 0) + 1;
        await client.query(
          `INSERT INTO accommodation_request(id,session_id,job_id,needs,client_request_id,lang,revision,status,private_enc,created_at,updated_at,expires_at) VALUES($1,$2,$3,'[]'::jsonb,$4,$5,$6,'draft',$7,$8,$8,$9)
          ON CONFLICT(id) DO UPDATE SET job_id=EXCLUDED.job_id,lang=EXCLUDED.lang,revision=EXCLUDED.revision,status='draft',private_enc=EXCLUDED.private_enc,approved_at=NULL,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at`,
          [
            id,
            input.sessionId,
            input.jobId,
            input.clientRequestId,
            input.lang,
            revision,
            this.cipher.encrypt(
              JSON.stringify(privateDraft),
              `accommodation:${id}`,
            ),
            this.now(),
            new Date(
              (input.interviewAt
                ? Date.parse(input.interviewAt)
                : this.now().getTime()) +
                30 * 86_400_000,
            ),
          ],
        );
        return this.decodeRequest({
          id,
          job_id: input.jobId,
          lang: input.lang,
          revision,
          status: "draft",
          private_enc: this.cipher.encrypt(
            JSON.stringify(privateDraft),
            `accommodation:${id}`,
          ),
          delivery_attempted: false,
        }).view;
      }
      const row = (
        await client.query<RequestRow>(
          "SELECT * FROM accommodation_request WHERE id=$1 AND session_id=$2 AND expires_at>$3 FOR UPDATE",
          [input.id, input.sessionId, this.now()],
        )
      ).rows[0];
      if (!row) throw new JobsError("not_found");
      const { view, privateDraft } = this.decodeRequest(row);
      if (input.action === "resume") return view;
      if (input.action === "cancel") {
        if (
          row.status === "sent" ||
          (row.status === "approved" && row.delivery_attempted)
        )
          throw new JobsError("conflict");
        await client.query(
          "UPDATE accommodation_request SET status='cancelled',needs='[]'::jsonb,private_enc=NULL,approved_at=NULL,updated_at=$2 WHERE id=$1",
          [row.id, this.now()],
        );
        return this.decodeRequest({
          ...row,
          status: "cancelled",
          private_enc: null,
        }).view;
      }
      if (
        input.revision !== row.revision ||
        row.status === "cancelled" ||
        !privateDraft
      )
        throw new JobsError("conflict");
      if (input.action === "approve") {
        if (row.status === "sent") return view;
        if (row.status === "draft") {
          await client.query(
            "UPDATE accommodation_request SET status='approved',approved_at=$2,updated_at=$2 WHERE id=$1",
            [row.id, this.now()],
          );
          const session = (
            await client.query<{ channel: string }>(
              "SELECT channel FROM session WHERE id=$1",
              [input.sessionId],
            )
          ).rows[0];
          await client.query(
            "INSERT INTO consent_log(id,channel,notice_version,purpose,created_at) VALUES($1,$2,'accommodation-v1','accommodation_send',$3)",
            [randomUUID(), session?.channel ?? "web", this.now()],
          );
        }
        return { ...view, status: "approved" as const };
      }
      if (row.status === "sent") return view;
      if (row.status !== "approved") throw new JobsError("conflict");
      if (!this.options.delivery.relayAvailable)
        throw new JobsError("unavailable");
      try {
        await this.options.delivery.sendAccommodation({
          to: privateDraft.employerEmail,
          message: privateDraft.message,
          lang: row.lang,
          idempotencyKey: `accommodation:${row.id}:${row.revision}`,
        });
      } catch {
        return new JobsError("delivery_failed");
      }
      await client.query(
        "UPDATE accommodation_request SET status='sent',sent_at=$2,updated_at=$2 WHERE id=$1",
        [row.id, this.now()],
      );
      return { ...view, status: "sent" as const };
    });
    if (result instanceof JobsError) throw result;
    return result;
  }
  async listAccommodationRequests(input: {
    sessionId: string;
  }): Promise<
    { id: string; jobId: string; status: AccommodationView["status"] }[]
  > {
    const rows = await this.options.pool.query<RequestRow>(
      "SELECT id,job_id,status FROM accommodation_request WHERE session_id=$1 AND expires_at>$2 ORDER BY updated_at DESC,id",
      [input.sessionId, this.now()],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status,
    }));
  }
  async runAlerts(input: { dryRun: boolean }): Promise<{
    matched: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    const result = { matched: 0, sent: 0, skipped: 0, failed: 0 };
    const subscriptions = await this.options.pool.query<{ id: string }>(
      "SELECT id FROM subscription WHERE stopped_at IS NULL AND consent_expires_at>$1 AND contact_enc IS NOT NULL ORDER BY id",
      [this.now()],
    );
    for (const { id } of subscriptions.rows) {
      const prepared = await this.transaction<
        "matched" | "skipped" | { day: string }
      >(async (client) => {
        const row = (
          await client.query<SubscriptionRow>(
            `SELECT * FROM subscription WHERE id=$1 FOR UPDATE ${input.dryRun ? "" : "SKIP LOCKED"}`,
            [id],
          )
        ).rows[0];
        if (
          !row ||
          !this.active(row) ||
          !this.options.delivery.channels.includes(row.channel)
        )
          return "skipped";
        const day = this.now().toISOString().slice(0, 10);
        const alreadySent = await client.query(
          "SELECT 1 FROM job_digest WHERE subscription_id=$1 AND status='sent' AND sent_at >= $2::timestamptz AND sent_at < $2::timestamptz + interval '24 hours'",
          [id, `${day}T00:00:00Z`],
        );
        if (alreadySent.rows.length) return "skipped";
        // Retry an uncertain delivery with its original key, even across midnight.
        let digest = (
          await client.query<DigestRow>(
            "SELECT *,day::text AS day FROM job_digest WHERE subscription_id=$1 AND (status='pending' OR day=$2::date) ORDER BY (status='pending') DESC,job_digest.day LIMIT 1",
            [id, day],
          )
        ).rows[0];
        const digestDay =
          digest?.day instanceof Date
            ? digest.day.toISOString().slice(0, 10)
            : (digest?.day ?? day);
        if (digest && digest.status !== "pending") return "skipped";
        const jobs = await client.query<{ posting: PublicJob }>(
          `SELECT j.posting FROM job j WHERE j.lang=$1 AND ($2::text IS NULL OR lower(j.region)=lower($2)) AND ($3::text IS NULL OR lower($3)=ANY(string_to_array(lower(j.job_type), ', '))) AND (j.deadline IS NULL OR j.deadline >= $4::date) AND NOT EXISTS(SELECT 1 FROM alert_sent a WHERE a.subscription_id=$5 AND a.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM job_digest d WHERE d.subscription_id=$5 AND d.status='skipped' AND j.id=ANY(d.job_ids)) ORDER BY j.id LIMIT 20`,
          [row.lang, row.region, row.job_type, day, id],
        );
        let matching = jobs.rows.map((job) => job.posting);
        if (digest) {
          const snapshot = await client.query<{ posting: PublicJob }>(
            "SELECT posting FROM job WHERE id=ANY($1::text[]) AND (deadline IS NULL OR deadline >= $2::date) ORDER BY id",
            [digest.job_ids, day],
          );
          if (snapshot.rows.length !== digest.job_ids.length) {
            if (!input.dryRun)
              await client.query(
                "UPDATE job_digest SET status='skipped' WHERE subscription_id=$1 AND day=$2::date",
                [id, digestDay],
              );
            return "skipped";
          }
          matching = digest.job_snapshot;
        }
        if (!matching.length) return "skipped";
        if (input.dryRun) return "matched";
        if (!digest) {
          digest = {
            job_ids: matching.map((job) => job.id),
            job_snapshot: matching,
            message: this.options.renderDigest({
              lang: row.lang,
              jobs: matching,
            }),
            status: "pending",
            idempotency_key: `job-digest:${id}:${day}`,
          };
          await client.query(
            "INSERT INTO job_digest(subscription_id,day,idempotency_key,job_ids,message,job_snapshot,status) VALUES($1,$2::date,$3,$4,$5,$6,'pending')",
            [
              id,
              day,
              digest.idempotency_key,
              digest.job_ids,
              digest.message,
              JSON.stringify(digest.job_snapshot),
            ],
          );
        }
        return { day: digestDay };
      });
      // The immutable intent is durable before any external side effect.
      const outcome =
        typeof prepared === "string"
          ? prepared
          : await this.deliverDigest(id, prepared.day);
      if (outcome === "matched" || outcome === "sent" || outcome === "failed")
        result.matched++;
      if (outcome !== "matched") result[outcome]++;
    }
    return result;
  }
  private async deliverDigest(
    id: string,
    digestDay: string,
  ): Promise<"skipped" | "sent" | "failed"> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<SubscriptionRow>(
          "SELECT * FROM subscription WHERE id=$1 FOR UPDATE SKIP LOCKED",
          [id],
        )
      ).rows[0];
      if (
        !row ||
        !this.active(row) ||
        !this.options.delivery.channels.includes(row.channel)
      )
        return "skipped";
      const digest = (
        await client.query<DigestRow>(
          "SELECT * FROM job_digest WHERE subscription_id=$1 AND day=$2::date",
          [id, digestDay],
        )
      ).rows[0];
      if (!digest || digest.status !== "pending") return "skipped";
      const day = this.now().toISOString().slice(0, 10);
      const sentToday = await client.query(
        "SELECT 1 FROM job_digest WHERE subscription_id=$1 AND status='sent' AND sent_at >= $2::timestamptz AND sent_at < $2::timestamptz + interval '24 hours'",
        [id, `${day}T00:00:00Z`],
      );
      if (sentToday.rows.length) return "skipped";
      const available = await client.query(
        "SELECT id FROM job WHERE id=ANY($1::text[]) AND (deadline IS NULL OR deadline >= $2::date)",
        [digest.job_ids, day],
      );
      if (available.rows.length !== digest.job_ids.length) {
        await client.query(
          "UPDATE job_digest SET status='skipped' WHERE subscription_id=$1 AND day=$2::date",
          [id, digestDay],
        );
        return "skipped";
      }
      // STOP shares this row lock; the bounded transport keeps it under one minute.
      if (!this.active(row)) return "skipped";
      try {
        await this.options.delivery.sendDigest({
          channel: row.channel,
          contact: this.cipher.decrypt(row.contact_enc!, `subscription:${id}`),
          lang: row.lang,
          text: digest.message,
          jobs: digest.job_snapshot,
          idempotencyKey: digest.idempotency_key,
        });
      } catch {
        return "failed";
      }
      for (const jobId of digest.job_ids)
        await client.query(
          "INSERT INTO alert_sent(subscription_id,job_id,sent_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [id, jobId, this.now()],
        );
      await client.query(
        "UPDATE job_digest SET status='sent',sent_at=$3 WHERE subscription_id=$1 AND day=$2::date",
        [id, digestDay, this.now()],
      );
      return "sent";
    });
  }
  async cleanupExpired(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "UPDATE subscription SET stopped_at=COALESCE(stopped_at,$1),contact_enc=NULL,contact_hash=NULL WHERE stopped_at IS NOT NULL OR consent_expires_at<=$1",
        [this.now()],
      );
      await client.query(
        "DELETE FROM accommodation_request WHERE expires_at <= $1",
        [this.now()],
      );
    });
  }
  async deleteData(input: { sessionId: string }): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("DELETE FROM subscription WHERE session_id=$1", [
        input.sessionId,
      ]);
      await client.query(
        "DELETE FROM accommodation_request WHERE session_id=$1",
        [input.sessionId],
      );
    });
  }
}
