import { describe, expect, it } from "vitest";
import { ownsWorkerRegistration } from "../src/worker-ownership.js";

const own =
  "https://host.example/service-worker.js?owner=dimts&asset=https%3A%2F%2Fhost.example%2Fdimts-index-v1.js&api=https%3A%2F%2Fapi.example%2Fv1";
const host = "https://host.example/service-worker.js?owner=host";
const worker = (scriptURL: string) => ({ scriptURL });

describe("FR-INT-11 service-worker registration ownership", () => {
  it("requires all present workers to belong to the same Dimts installation", () => {
    expect(ownsWorkerRegistration({ active: worker(own) }, new URL(own))).toBe(
      true,
    );
    expect(
      ownsWorkerRegistration({ installing: worker(own) }, new URL(own)),
    ).toBe(true);
    expect(
      ownsWorkerRegistration(
        { active: worker(own), waiting: worker(host) },
        new URL(own),
      ),
    ).toBe(false);
    expect(
      ownsWorkerRegistration(
        { active: worker(own), installing: worker(host) },
        new URL(own),
      ),
    ).toBe(false);
    expect(ownsWorkerRegistration({ active: worker(host) }, new URL(own))).toBe(
      false,
    );
    expect(ownsWorkerRegistration({}, new URL(own))).toBe(false);
  });
  it("permits a Dimts module version update but rejects unrelated origins, APIs, paths or invalid asset URLs", () => {
    expect(
      ownsWorkerRegistration(
        { active: worker(own.replace("v1.js", "v2.js")) },
        new URL(own),
      ),
    ).toBe(true);
    for (const invalid of [
      own.replace("api.example", "other.example"),
      own.replace("/service-worker.js", "/host-worker.js"),
      own.replace(
        "asset=https%3A%2F%2Fhost.example",
        "asset=https%3A%2F%2Fother.example",
      ),
      "https://host.example/service-worker.js?owner=dimts&asset=invalid&api=https%3A%2F%2Fapi.example%2Fv1",
    ])
      expect(
        ownsWorkerRegistration({ active: worker(invalid) }, new URL(own)),
      ).toBe(false);
  });
});
