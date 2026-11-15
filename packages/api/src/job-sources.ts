import {
  JobSourceSync,
  ethiojobsSource,
  partnerFeedSource,
  type JobSource,
} from "@bridgely/jobs";
import type { ApiConfig } from "./config.js";
import type { JobsApiService } from "./routes/jobs.js";

/** Builds the configured job platform connectors (see @bridgely/jobs sources). */
export function createJobSources(
  config: Pick<
    ApiConfig,
    | "JOB_SOURCES"
    | "JOB_SYNC_LIMIT"
    | "JOB_USER_AGENT"
    | "HAHUJOBS_FEED_URL"
    | "HAHUJOBS_FEED_TOKEN"
    | "AFRIWORK_FEED_URL"
    | "AFRIWORK_FEED_TOKEN"
  >,
  fetcher?: typeof fetch,
): JobSource[] {
  const common = {
    userAgent: config.JOB_USER_AGENT,
    ...(fetcher ? { fetch: fetcher } : {}),
  };
  return config.JOB_SOURCES.map((id) => {
    if (id === "ethiojobs")
      return ethiojobsSource({ ...common, limit: config.JOB_SYNC_LIMIT });
    if (id === "hahujobs")
      return partnerFeedSource({
        ...common,
        id,
        name: "HahuJobs",
        homepage: "https://hahu.jobs",
        url: config.HAHUJOBS_FEED_URL,
        token: config.HAHUJOBS_FEED_TOKEN,
      });
    return partnerFeedSource({
      ...common,
      id,
      name: "Afriwork",
      homepage: "https://afriworket.com",
      url: config.AFRIWORK_FEED_URL,
      token: config.AFRIWORK_FEED_TOKEN,
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
    intervalMs: config.JOB_SYNC_INTERVAL_MS,
    onError,
  });
}
