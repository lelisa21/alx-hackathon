import { describe, expect, it } from "vitest";
import { messageFor } from "../src/messages.js";

describe("FR-LANG-03/04 widget ICU messages", () => {
  it("formats variables and plurals inside permitted inline tags as safe text", () => {
    const ui = {
      count:
        "<strong>{count, plural, one {# message} other {# messages}}</strong> {name}",
    };
    expect(messageFor(ui, "count", { count: 2, name: "Learner" })).toBe(
      "<strong>2 messages</strong> Learner",
    );
    expect(messageFor(ui, "count", { count: 1, name: "Learner" })).toBe(
      "<strong>1 message</strong> Learner",
    );
  });

  it("handles missing values without a crash or interpreting user text as markup", () => {
    expect(messageFor({}, "missing")).toBe("");
    expect(messageFor({ bad: "{missing}" }, "bad")).toBe("{missing}");
    expect(
      messageFor({ text: "{value}" }, "text", { value: "<img src=x>" }),
    ).toBe("<img src=x>");
  });
});
