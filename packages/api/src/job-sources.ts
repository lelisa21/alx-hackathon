import {
  JobSourceSync,
  ethiojobsSource,
  partnerFeedSource,
  type JobSource,
} from "@dimts/jobs";
import type { ApiConfig } from "./config.js";
import type { JobsApiService } from "./routes/jobs.js";

/** Builds the configured job platform connectors (see @dimts/jobs sources). */
export function createJobSources(
  config: Pick<
    ApiConfig,
    | "DIMTS_JOB_SOURCES"
    | "DIMTS_JOB_SYNC_LIMIT"
    | "DIMTS_JOB_USER_AGENT"
    | "DIMTS_HAHUJOBS_FEED_URL"
    | "DIMTS_HAHUJOBS_FEED_TOKEN"
    | "DIMTS_AFRIWORK_FEED_URL"
    | "DIMTS_AFRIWORK_FEED_TOKEN"
  >,
  fetcher?: typeof fetch,
): JobSource[] {
  const common = {
    userAgent: config.DIMTS_JOB_USER_AGENT,
    ...(fetcher ? { fetch: fetcher } : {}),
  };
  return config.DIMTS_JOB_SOURCES.map((id) => {
    if (id === "ethiojobs")
      return ethiojobsSource({ ...common, limit: config.DIMTS_JOB_SYNC_LIMIT });
    if (id === "hahujobs")
      return partnerFeedSource({
        ...common,
        id,
        name: "HahuJobs",
        homepage: "https://hahu.jobs",
        url: config.DIMTS_HAHUJOBS_FEED_URL,
        token: config.DIMTS_HAHUJOBS_FEED_TOKEN,
      });
    return partnerFeedSource({
      ...common,
      id,
      name: "Afriwork",
      homepage: "https://afriworket.com",
      url: config.DIMTS_AFRIWORK_FEED_URL,
      token: config.DIMTS_AFRIWORK_FEED_TOKEN,
    });
  });
}

export function createJobSourceSync(
  config: ApiConfig,
  jobs: Pick<JobsApiService, "importJobs">,
  onError: (event: { source: string; reason: string }) => void,
): JobSourceSync {
  return new JobSourceSync({
    sources: createJobSources(config),
    importJobs: (input) => jobs.importJobs(input),
    intervalMs: config.DIMTS_JOB_SYNC_INTERVAL_MS,
    onError,
  });
}
