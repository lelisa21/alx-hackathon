import { z } from "zod";
import type { ApiConfig } from "./config.js";
import { HelpIceResponseSchema } from "./schemas.js";

const stun = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
// Credentials are short-lived and shared only inside this process. Never retain
// request/session identifiers or expose the application's Metered secret.
export function createHelpIceProvider(
  config: ApiConfig,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
) {
  let cached: z.infer<typeof HelpIceResponseSchema> | undefined;
  let pending: Promise<z.infer<typeof HelpIceResponseSchema>> | undefined;
  return async (): Promise<z.infer<typeof HelpIceResponseSchema>> => {
    if (!config.DIMTS_TURN_API_KEY || !config.DIMTS_TURN_APP) return stun;
    if (
      cached?.expiresAt &&
      Date.parse(cached.expiresAt) > now().getTime() + 300000
    )
      return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const endpoint = new URL(
          `https://${config.DIMTS_TURN_APP}.metered.live/api/v1/turn/credential`,
        );
        endpoint.searchParams.set("secretKey", config.DIMTS_TURN_API_KEY!);
        const createdAt = now().getTime();
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expiryInSeconds: 3600 }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        });
        if (!response.ok) return stun;
        const credential = z
          .object({
            username: z.string().min(1).max(1024),
            password: z.string().min(1).max(1024),
          })
          .parse(await response.json());
        cached = HelpIceResponseSchema.parse({
          iceServers: [
            ...stun.iceServers,
            {
              urls: [
                "turn:global.relay.metered.ca:80",
                "turn:global.relay.metered.ca:80?transport=tcp",
                "turns:global.relay.metered.ca:443?transport=tcp",
              ],
              username: credential.username,
              credential: credential.password,
            },
          ],
          expiresAt: new Date(createdAt + 3600000).toISOString(),
        });
        return cached;
      } catch {
        return stun;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
