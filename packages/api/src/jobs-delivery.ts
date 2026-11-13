import { JobsError } from "@dimts/jobs";
import type { JobsDelivery } from "@dimts/jobs";
import type { ApiConfig } from "./config.js";

export const JOBS_DELIVERY_VERSION = "dimts.jobs.delivery.v1";

/** Host delivery is real HTTP. Native channel adapters implement the same port in P07/P08. */
export function createHostJobsDelivery(
  config: ApiConfig,
  transport: typeof fetch = fetch,
): JobsDelivery {
  const configured = Boolean(
    config.DIMTS_JOBS_RELAY_URL && config.DIMTS_JOBS_RELAY_SECRET,
  );
  const channels = configured ? config.DIMTS_JOBS_RELAY_CHANNELS : [];
  const send = async (
    kind: "digest" | "accommodation",
    input: { idempotencyKey: string },
  ) => {
    if (!configured) throw new JobsError("unavailable");
    try {
      const response = await transport(config.DIMTS_JOBS_RELAY_URL!, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.DIMTS_JOBS_RELAY_SECRET!}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          version: JOBS_DELIVERY_VERSION,
          kind,
          ...input,
        }),
      });
      if (!response.ok) throw new Error("Host delivery rejected");
      const receipt: unknown = await response.json();
      if (
        typeof receipt !== "object" ||
        receipt === null ||
        !("version" in receipt) ||
        receipt.version !== JOBS_DELIVERY_VERSION ||
        !("accepted" in receipt) ||
        receipt.accepted !== true ||
        !("idempotencyKey" in receipt) ||
        receipt.idempotencyKey !== input.idempotencyKey
      ) {
        throw new Error("Host receipt is invalid");
      }
    } catch {
      // Never propagate host bodies, URLs, contact or approved message contents.
      throw new JobsError("delivery_failed");
    }
  };
  return {
    channels,
    relayAvailable: configured,
    async sendDigest(input) {
      if (!channels.includes(input.channel)) throw new JobsError("unavailable");
      await send("digest", input);
    },
    async sendAccommodation(input) {
      await send("accommodation", input);
    },
  };
}
