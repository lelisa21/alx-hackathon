interface WorkerIdentity {
  scriptURL: string;
}

interface RegistrationIdentity {
  active?: WorkerIdentity | null;
  waiting?: WorkerIdentity | null;
  installing?: WorkerIdentity | null;
}

/** Registrations are reused by scope; a host replacement revokes our ownership. */
export function ownsWorkerRegistration(
  registration: RegistrationIdentity,
  expected: URL,
): boolean {
  const workers = [
    registration.active,
    registration.waiting,
    registration.installing,
  ].filter((worker): worker is WorkerIdentity => Boolean(worker));
  return (
    workers.length > 0 &&
    workers.every((worker) => {
      try {
        const url = new URL(worker.scriptURL);
        const asset = url.searchParams.get("asset");
        return (
          url.origin === expected.origin &&
          url.pathname === expected.pathname &&
          url.searchParams.get("owner") === "dimts" &&
          url.searchParams.get("api") === expected.searchParams.get("api") &&
          Boolean(asset && new URL(asset).origin === expected.origin)
        );
      } catch {
        return false;
      }
    })
  );
}
