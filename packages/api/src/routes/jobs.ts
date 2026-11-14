import express from "express";
import rateLimit from "express-rate-limit";
import { JobsError } from "@dimts/jobs";
import type { JobSourceSync, JobsDelivery, JobsService } from "@dimts/jobs";
import type { LangPack } from "@dimts/locales-tools";
import type { ApiRepository } from "../types.js";
import { createSessionAuth, sha256 } from "../middleware/auth.js";
import { sendProblem } from "../middleware/problem.js";
import {
  careerGlossary,
  careerInterview,
  publicJobView,
} from "../jobs-format.js";
import {
  AccommodationListResponseSchema,
  AccommodationRequestSchema,
  AccommodationResponseSchema,
  CareerOkSchema,
  CareerSessionQuerySchema,
  JobsImportRequestSchema,
  JobsImportResponseSchema,
  JobsQuerySchema,
  JobsResponseSchema,
  SubscriptionRequestSchema,
  SubscriptionResponseSchema,
  SubscriptionsResponseSchema,
} from "../jobs-schemas.js";

export type JobsApiService = Pick<
  JobsService,
  | "authorizeImporter"
  | "importJobs"
  | "listJobs"
  | "subscribe"
  | "listSubscriptions"
  | "stopSubscription"
  | "accommodation"
  | "listAccommodationRequests"
  | "runAlerts"
  | "cleanupExpired"
> &
  Partial<Pick<JobsService, "stopContact">>;

export function createJobsRouter(options: {
  service: JobsApiService;
  delivery: JobsDelivery;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
  defaultLang: string;
  sources?: Pick<JobSourceSync, "status">;
}): express.Router {
  const router = express.Router();
  const { service, delivery, repository, packs } = options;
  // Public: which job platforms feed this deployment and whether they work.
  // Contains platform names, states and counts only.
  router.get("/jobs/sources", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ sources: options.sources?.status() ?? [] });
  });
  const session = createSessionAuth(repository);
  const validLang = (lang: string) =>
    Boolean(packs.has(lang) && packs.get(lang)?.meta.status !== "draft");
  const limit = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_request, response) =>
      sendProblem(response, 429, "rate_limited", "limit.reached"),
  });
  router.use(
    ["/jobs", "/subscriptions", "/accommodation-requests"],
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      next();
    },
  );
  router.post("/jobs/import", limit, async (request, response) => {
    const key = request.header("x-dimts-key");
    if (!key || !(await service.authorizeImporter(sha256(key)))) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }
    const body = JobsImportRequestSchema.parse(request.body);
    if (!validLang(body.lang)) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    response.json(
      JobsImportResponseSchema.parse(
        await service.importJobs({ lang: body.lang, postings: body.postings }),
      ),
    );
  });
  router.get("/jobs", session, async (request, response) => {
    const { sessionId: _sessionId, ...filters } = JobsQuerySchema.parse(
      request.query,
    );
    void _sessionId;
    const lang = filters.lang ?? options.defaultLang;
    if (!validLang(lang)) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    // Follow the pack fallback chain (om -> am -> en) so learners see postings
    // that exist only in another language; each job keeps its own `lang`.
    const languages = [lang];
    for (
      let next = packs.get(lang)?.meta.fallback;
      next && !languages.includes(next);
      next = packs.get(next)?.meta.fallback
    )
      languages.push(next);
    const seen = new Set<string>();
    const listed = (
      await Promise.all(
        languages.map((code) =>
          service.listJobs({
            lang: code,
            ...(filters.region ? { region: filters.region } : {}),
            ...(filters.type ? { type: filters.type } : {}),
          }),
        ),
      )
    )
      .flat()
      .filter((job) => !seen.has(job.id) && Boolean(seen.add(job.id)))
      .slice(0, 200);
    response.json(
      JobsResponseSchema.parse({
        jobs: listed.map((job) => publicJobView(packs, lang, job)),
        channels: delivery.channels,
        relayAvailable: delivery.relayAvailable,
        glossary: careerGlossary(packs, lang),
      }),
    );
  });
  router.get("/subscriptions", session, async (request, response) => {
    const input = CareerSessionQuerySchema.parse(request.query);
    response.json(
      SubscriptionsResponseSchema.parse({
        subscriptions: await service.listSubscriptions(input),
      }),
    );
  });
  router.post("/subscriptions", limit, session, async (request, response) => {
    const { region, jobType, ...required } = SubscriptionRequestSchema.parse(
      request.body,
    );
    const input = {
      ...required,
      ...(region ? { region } : {}),
      ...(jobType ? { jobType } : {}),
    };
    if (!validLang(input.lang)) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    response
      .status(201)
      .json(SubscriptionResponseSchema.parse(await service.subscribe(input)));
  });
  router.delete("/subscriptions/:id", session, async (request, response) => {
    const input = CareerSessionQuerySchema.parse(request.query);
    if (
      !(await service.stopSubscription({
        ...input,
        id: String(request.params.id),
      }))
    ) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }
    response.json(CareerOkSchema.parse({ ok: true }));
  });
  router.get("/accommodation-requests", session, async (request, response) => {
    const input = CareerSessionQuerySchema.parse(request.query);
    response.json(
      AccommodationListResponseSchema.parse({
        requests: await service.listAccommodationRequests(input),
      }),
    );
  });
  router.post(
    "/accommodation-requests",
    limit,
    session,
    async (request, response) => {
      const input = AccommodationRequestSchema.parse(request.body);
      if (input.action === "draft" && !validLang(input.lang)) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const result = await service.accommodation(
        input.action === "draft"
          ? {
              action: input.action,
              sessionId: input.sessionId,
              clientRequestId: input.clientRequestId,
              jobId: input.jobId,
              lang: input.lang,
              needs: input.needs,
              ...(input.otherText ? { otherText: input.otherText } : {}),
              ...(input.name ? { name: input.name } : {}),
              ...(input.interviewAt ? { interviewAt: input.interviewAt } : {}),
            }
          : input,
      );
      response.json(
        AccommodationResponseSchema.parse({
          ...result,
          ...(result.interviewAt
            ? {
                interviewDisplay: careerInterview(
                  packs,
                  result.lang,
                  result.interviewAt,
                ),
              }
            : {}),
        }),
      );
    },
  );
  router.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (!(error instanceof JobsError)) {
        next(error);
        return;
      }
      const status = {
        invalid: 400,
        not_found: 404,
        conflict: 409,
        unavailable: 503,
        delivery_failed: 503,
      }[error.code];
      const code =
        error.code === "invalid"
          ? "invalid_request"
          : error.code === "unavailable" || error.code === "delivery_failed"
            ? "internal"
            : error.code;
      const messageKey =
        error.code === "invalid"
          ? "error.invalid"
          : error.code === "not_found"
            ? "error.not_found"
            : `jobs.${error.code}`;
      sendProblem(response, status, code, messageKey);
    },
  );
  return router;
}
