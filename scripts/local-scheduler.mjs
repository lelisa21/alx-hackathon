export function nextUtcRun(hour, minute, now = new Date()) {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
    ),
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function runJob(name, path) {
  const baseUrl = process.env.DIMTS_SCHEDULER_API_URL ?? "http://api:3000";
  const secret = process.env.DIMTS_CRON_SECRET;
  if (!secret) throw new Error("DIMTS_CRON_SECRET is required.");

  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(
      `Scheduled ${name} request failed with status ${response.status}.`,
    );
}

function schedule(name, path, hour, minute) {
  const delay = nextUtcRun(hour, minute).getTime() - Date.now();
  setTimeout(async () => {
    try {
      await runJob(name, path);
      process.stdout.write(`${name} completed.\n`);
    } catch (error) {
      const status =
        error instanceof Error
          ? /status (\d+)/u.exec(error.message)?.[1]
          : undefined;
      process.stderr.write(
        `${JSON.stringify({
          event: "local_scheduled_job_failed",
          job: name,
          ...(status ? { status: Number(status) } : {}),
        })}\n`,
      );
    }
    schedule(name, path, hour, minute);
  }, delay);
}

if (process.argv[1]?.endsWith("local-scheduler.mjs")) {
  schedule("retention", "/v1/internal/retention", 6, 0);
  schedule("alerts", "/v1/internal/alerts", 7, 30);
}
