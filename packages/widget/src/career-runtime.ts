import { html, nothing } from "lit";
import { MAX_RECORDING_MS } from "@dimts/voice";
import type { SpeechToText } from "@dimts/voice";
import type { Language } from "./index.js";
import { voiceRuntime, type VoiceContext } from "./voice-runtime.js";

export interface CareerContext {
  apiRoot: string;
  hostKey: string;
  sessionId: string;
  sessionToken: string;
  sessionGeneration: number;
  selectedLang: string;
  uiLanguage: string;
  uiDirection: "ltr" | "rtl";
  languages: Language[];
  isConnected: boolean;
  hidden: boolean;
  speechToText: SpeechToText | undefined;
  renderRoot: HTMLElement | ShadowRoot;
  updateComplete: Promise<boolean>;
  requestUpdate(): void;
  request(url: string, init?: RequestInit): Promise<Response>;
  canRecord(lang?: string): boolean;
  cancelRecording(): void;
  stopSpeech(): void;
  recordingCueActive: boolean;
  resetExpiredSession(): void;
  t(key: string, values?: Record<string, string | number>): string;
}
type Channel = "sms" | "telegram";
const needKeys = {
  sign_language_interpreter: "sign_language",
  step_free_access: "step_free",
  written_questions: "written_questions",
  extra_time: "extra_time",
  screen_reader_friendly_test: "screen_reader",
  other: "other",
} as const;
type Need = keyof typeof needKeys;
interface Job {
  id: string;
  title: string;
  description: string;
  organization: string;
  location: string;
  region: string | null;
  jobType: string | null;
  deadlineDisplay: string | null;
  url: string;
  lang: string;
  accommodationsOffered: string[];
}
interface Subscription {
  id: string;
  status: "active" | "stopped";
  channel: Channel;
  lang: string;
}
interface Draft {
  id: string;
  revision: number;
  status: "draft" | "approved" | "sent" | "cancelled";
  sendAttempted: boolean;
  message: string;
  jobId: string;
  needs: Need[];
  otherText?: string;
  name?: string;
  interviewAt?: string;
  interviewDisplay?: string;
}
interface Progress {
  flow: "subscription" | "accommodation";
  step: number;
  jobType: string;
  region: string;
  lang: string;
  channel: Channel;
  draftId: string;
  clientRequestId: string;
}
interface State extends Progress {
  open: boolean;
  active: boolean;
  jobs: Job[];
  subscriptions: Subscription[];
  drafts: { id: string; jobId: string; status: string }[];
  channels: Channel[];
  relayAvailable: boolean;
  glossary: { term: string; meaning: string }[];
  support: string[];
  browseRegion: string;
  browseType: string;
  busy: boolean;
  failed: boolean;
  notice: string;
  saved: Progress | undefined;
  consent: boolean;
  contact: string;
  jobId: string;
  needs: Need[];
  otherText: string;
  name: string;
  interviewAt: string;
  draft: Draft | undefined;
  recording: boolean;
  voiceRun: number;
  voiceTimer: number | undefined;
  voiceReview: string;
  controller: AbortController;
  run: number;
}
const states = new WeakMap<CareerContext, State>();
function initial(): State {
  return {
    open: false,
    active: false,
    flow: "subscription",
    step: 0,
    jobType: "",
    region: "",
    lang: "en",
    channel: "sms",
    draftId: "",
    clientRequestId: "",
    jobs: [],
    subscriptions: [],
    drafts: [],
    channels: [],
    relayAvailable: false,
    glossary: [],
    support: [],
    browseRegion: "",
    browseType: "",
    busy: false,
    failed: false,
    notice: "",
    saved: undefined,
    consent: false,
    contact: "",
    jobId: "",
    needs: [],
    otherText: "",
    name: "",
    interviewAt: "",
    draft: undefined,
    recording: false,
    voiceRun: 0,
    voiceTimer: undefined,
    voiceReview: "",
    controller: new AbortController(),
    run: 0,
  };
}
function state(context: CareerContext): State {
  let value = states.get(context);
  if (!value) {
    value = initial();
    states.set(context, value);
  }
  return value;
}
/** Support choices never become query parameters, request bodies, or storage. */
export function filterBySupport<T extends { accommodationsOffered: string[] }>(
  jobs: T[],
  support: string[],
): T[] {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return jobs.filter((job) =>
    support.every((need) =>
      job.accommodationsOffered.some(
        (offered) => normalize(offered) === normalize(need),
      ),
    ),
  );
}
/** Only non-sensitive subscription choices and opaque private-draft references persist. */
export function safeProgress(value: Record<string, unknown>): Progress {
  const text = (key: string) =>
    typeof value[key] === "string" ? (value[key] as string).slice(0, 200) : "";
  const accommodation = value.flow === "accommodation";
  return {
    flow: accommodation ? "accommodation" : "subscription",
    step: accommodation ? 0 : Math.max(0, Math.min(4, Number(value.step) || 0)),
    jobType: text("jobType"),
    region: text("region"),
    lang: text("lang"),
    channel: value.channel === "telegram" ? "telegram" : "sms",
    draftId: text("draftId"),
    clientRequestId: text("clientRequestId"),
  };
}
function key(context: CareerContext): string {
  return `dimts.career.${context.apiRoot}.${context.hostKey}`;
}
function stored(context: CareerContext): Progress | undefined {
  try {
    const raw = localStorage.getItem(key(context));
    return raw
      ? safeProgress(JSON.parse(raw) as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
function persist(context: CareerContext): void {
  const value = state(context);
  value.saved = safeProgress(value as unknown as Record<string, unknown>);
  try {
    localStorage.setItem(key(context), JSON.stringify(value.saved));
  } catch {
    /* In-memory flow still works without storage. */
  }
}
function remove(context: CareerContext): void {
  state(context).saved = undefined;
  try {
    localStorage.removeItem(key(context));
  } catch {
    /* Storage may be disabled. */
  }
}
function refresh(context: CareerContext, focus = false): void {
  context.requestUpdate();
  if (focus)
    void context.updateComplete.then(() =>
      context.renderRoot
        .querySelector<HTMLElement>(
          ".career-flow [data-career-focus], #career-heading:not(:has(~ .career-flow))",
        )
        ?.focus(),
    );
}
function stopVoice(context: CareerContext): void {
  const value = state(context);
  ++value.voiceRun;
  clearTimeout(value.voiceTimer);
  value.voiceTimer = undefined;
  if (value.recording) {
    try {
      if (context.speechToText?.cancel) context.speechToText.cancel();
      else context.speechToText?.stop();
    } catch {
      /* Cancelled results are invalidated regardless. */
    }
  }
  value.recording = false;
  value.voiceReview = "";
  context.recordingCueActive = false;
}
async function api<T>(
  context: CareerContext,
  path: string,
  body?: Record<string, unknown>,
  method?: string,
): Promise<T> {
  const signal = state(context).controller.signal;
  const query = body
    ? ""
    : `${path.includes("?") ? "&" : "?"}sessionId=${encodeURIComponent(context.sessionId)}`;
  const response = await context.request(`${context.apiRoot}${path}${query}`, {
    method: method ?? (body ? "POST" : "GET"),
    signal,
    headers: {
      authorization: `Bearer ${context.sessionToken}`,
      "content-type": "application/json",
    },
    ...(body
      ? { body: JSON.stringify({ sessionId: context.sessionId, ...body }) }
      : {}),
  });
  if (response.status === 401) {
    careerRuntime.dispose.call(context, true);
    context.resetExpiredSession();
    throw new Error("session");
  }
  if (!response.ok) throw new Error("career");
  const result = (await response.json()) as T;
  signal.throwIfAborted();
  return result;
}
async function perform(
  context: CareerContext,
  action: () => Promise<void>,
): Promise<void> {
  const value = state(context);
  if (value.busy) return;
  const generation = context.sessionGeneration;
  const run = value.run;
  value.busy = true;
  value.failed = false;
  value.notice = "";
  refresh(context);
  try {
    await action();
  } catch {
    if (generation === context.sessionGeneration && run === value.run) {
      value.failed = true;
      value.notice = context.t("jobs.failed");
    }
  } finally {
    if (generation === context.sessionGeneration && run === value.run) {
      value.busy = false;
      refresh(context, true);
    }
  }
}
function erasePrivate(value: State): void {
  value.contact = "";
  value.consent = false;
  value.name = "";
  value.otherText = "";
  value.needs = [];
  value.interviewAt = "";
  value.draft = undefined;
}
async function catalog(context: CareerContext): Promise<void> {
  const value = state(context);
  const query = new URLSearchParams({ lang: context.selectedLang });
  if (value.browseRegion) query.set("region", value.browseRegion);
  if (value.browseType) query.set("type", value.browseType);
  const [listing, subscriptions, drafts] = await Promise.all([
    api<{
      jobs: Job[];
      channels: Channel[];
      relayAvailable: boolean;
      glossary: { term: string; meaning: string }[];
    }>(context, `/jobs?${query}`),
    api<{ subscriptions: Subscription[] }>(context, "/subscriptions"),
    api<{ requests: { id: string; jobId: string; status: string }[] }>(
      context,
      "/accommodation-requests",
    ),
  ]);
  Object.assign(value, listing, {
    subscriptions: subscriptions.subscriptions,
    drafts: drafts.requests,
  });
}
function newFlow(context: CareerContext, flow: Progress["flow"]): void {
  const value = state(context);
  stopVoice(context);
  erasePrivate(value);
  Object.assign(value, {
    flow,
    active: true,
    step: 0,
    jobType: "",
    region: "",
    lang: context.selectedLang,
    channel: value.channels[0] ?? "sms",
    draftId: "",
    clientRequestId: crypto.randomUUID(),
    jobId: eligibleJobs(value)[0]?.id ?? "",
    notice: "",
    failed: false,
  });
  refresh(context, true);
}
async function saveDraft(context: CareerContext): Promise<void> {
  const value = state(context);
  if (value.draft) return;
  const previousId = value.draftId;
  const draft = await api<Draft>(context, "/accommodation-requests", {
    action: "draft",
    clientRequestId: value.clientRequestId,
    jobId: value.jobId,
    lang: context.selectedLang,
    needs: value.needs,
    ...(value.otherText ? { otherText: value.otherText } : {}),
    ...(value.name ? { name: value.name } : {}),
    ...(value.interviewAt
      ? { interviewAt: new Date(`${value.interviewAt}:00Z`).toISOString() }
      : {}),
  });
  value.draft = draft;
  value.draftId = draft.id;
  if (previousId && previousId !== draft.id)
    await api(context, "/accommodation-requests", {
      action: "cancel",
      id: previousId,
    });
  value.drafts = value.drafts.filter(
    (item) => item.id !== previousId && item.id !== draft.id,
  );
  value.drafts.push({ id: draft.id, jobId: draft.jobId, status: draft.status });
}
function applyDraft(value: State, draft: Draft): void {
  value.draft = draft;
  value.draftId = draft.id;
  value.drafts = value.drafts.map((item) =>
    item.id === draft.id
      ? { id: draft.id, jobId: draft.jobId, status: draft.status }
      : item,
  );
  value.jobId = draft.jobId;
  value.needs = draft.needs;
  value.otherText = draft.otherText ?? "";
  value.name = draft.name ?? "";
  value.interviewAt = draft.interviewAt?.slice(0, 16) ?? "";
}
function eligibleJobs(value: State): Job[] {
  return value.jobs.filter(
    (job) =>
      !value.drafts.some(
        (draft) => draft.jobId === job.id && draft.status === "approved",
      ),
  );
}
async function next(context: CareerContext): Promise<void> {
  const value = state(context);
  stopVoice(context);
  if (value.flow === "subscription") {
    if (value.step === 4 && !value.consent) return;
    if (value.step === 5 && !value.contact.trim()) return;
    value.step++;
    refresh(context, true);
    return;
  }
  if (value.step === 4) {
    await perform(context, async () => {
      await saveDraft(context);
      value.step = 5;
    });
    return;
  }
  value.step++;
  refresh(context, true);
}
type FieldName =
  | "jobType"
  | "region"
  | "contact"
  | "otherText"
  | "name"
  | "browseRegion"
  | "browseType";
function fieldLimit(keyName: FieldName): number {
  return keyName === "otherText"
    ? 1000
    : keyName === "name"
      ? 80
      : keyName === "contact"
        ? 128
        : 120;
}
function field(context: CareerContext, keyName: FieldName, label: string) {
  const value = state(context);
  return html`<label for=${`career-${keyName}`}>${context.t(label)}</label>
    <input
      data-career-focus
      id=${`career-${keyName}`}
      autocomplete="off"
      .value=${value[keyName]}
      maxlength=${fieldLimit(keyName)}
      @input=${(event: Event) => {
        value[keyName] = (event.target as HTMLInputElement).value;
        refresh(context);
      }}
    />
    ${context.canRecord() ? html`<button type="button" ?disabled=${value.busy} @click=${() => void record(context, keyName)}>${context.t(value.recording ? "mic.stop" : "mic.start")}</button>` : html`<p>${context.t("voice.inputUnavailable")}</p>`}
    ${value.recording ? html`<p role="status">${context.t("voice.listening")}</p>` : nothing}
    ${
      value.voiceReview === keyName
        ? html`<p role="status">
              ${context.t("review.heard", { text: value[keyName] })}
            </p>
            <button type="button" @click=${() => void record(context, keyName)}>
              ${context.t("review.retry")}
            </button>`
        : nothing
    }`;
}
async function record(
  context: CareerContext,
  keyName: FieldName,
): Promise<void> {
  const value = state(context);
  const adapter = context.speechToText;
  if (value.recording) {
    voiceRuntime.stopRecordingCue.call(context as unknown as VoiceContext);
    adapter?.stop();
    return;
  }
  if (!adapter || !context.canRecord() || context.hidden) return;
  context.cancelRecording();
  context.stopSpeech();
  const run = ++value.voiceRun;
  value.recording = true;
  voiceRuntime.startRecordingCue.call(context as unknown as VoiceContext);
  value.voiceReview = "";
  value.failed = false;
  value.notice = "";
  value.voiceTimer = window.setTimeout(() => adapter.stop(), MAX_RECORDING_MS);
  refresh(context);
  try {
    const text = (await adapter.start(context.selectedLang)).trim();
    if (run !== value.voiceRun) return;
    if (!text) throw new Error("empty");
    value[keyName] = text;
    value.voiceReview = keyName;
  } catch (error) {
    if (run === value.voiceRun) {
      const code = (error as { code?: string })?.code;
      value.notice = context.t(
        code === "permission-denied"
          ? "voice.permissionDenied"
          : code === "microphone-unavailable"
            ? "voice.microphoneUnavailable"
            : "voice.retry",
      );
      value.failed = true;
    }
  } finally {
    if (run === value.voiceRun) {
      clearTimeout(value.voiceTimer);
      value.voiceTimer = undefined;
      value.recording = false;
      voiceRuntime.stopRecordingCue.call(context as unknown as VoiceContext);
      refresh(context);
      void context.updateComplete.then(() =>
        context.renderRoot
          .querySelector<HTMLInputElement>(`#career-${keyName}`)
          ?.focus(),
      );
    }
  }
}
function options(
  context: CareerContext,
  selected: string[],
  change: (next: Need[]) => void,
) {
  return (Object.keys(needKeys) as Need[]).map(
    (need) =>
      html`<label class="career-choice"
        ><input
          type="checkbox"
          .checked=${selected.includes(need)}
          @change=${(event: Event) => change((event.target as HTMLInputElement).checked ? ([...selected, need] as Need[]) : (selected.filter((x) => x !== need) as Need[]))}
        /><span
          >${context.t(`jobs.supportLabels.${needKeys[need]}`)}</span
        ></label
      >`,
  );
}
function stepContent(context: CareerContext) {
  const value = state(context);
  if (value.flow === "subscription") {
    if (value.step === 0) return field(context, "jobType", "jobs.type");
    if (value.step === 1) return field(context, "region", "jobs.region");
    if (value.step === 2)
      return html`<label for="career-lang">${context.t("jobs.language")}</label
        ><select
          id="career-lang"
          data-career-focus
          .value=${value.lang}
          @change=${(event: Event) => {
            value.lang = (event.target as HTMLSelectElement).value;
            refresh(context);
          }}
        >
          ${context.languages.filter((lang) => lang.status !== "draft").map((lang) => html`<option value=${lang.code}>${lang.nameNative}</option>`)}
        </select>`;
    if (value.step === 3)
      return html`<label for="career-channel"
          >${context.t("jobs.channel")}</label
        ><select
          id="career-channel"
          data-career-focus
          .value=${value.channel}
          @change=${(event: Event) => {
            value.channel = (event.target as HTMLSelectElement)
              .value as Channel;
            refresh(context);
          }}
        >
          ${value.channels.map((channel) => html`<option value=${channel}>${context.t(`jobs.${channel}`)}</option>`)}
        </select>`;
    if (value.step === 4)
      return html`<label class="career-choice"
        ><input
          data-career-focus
          type="checkbox"
          .checked=${value.consent}
          @change=${(event: Event) => {
            value.consent = (event.target as HTMLInputElement).checked;
            refresh(context);
          }}
        /><span>${context.t("jobs.consent")}</span></label
      >`;
    if (value.step === 5) return field(context, "contact", "jobs.contact");
    return html`<h3 tabindex="-1" data-career-focus>
        ${context.t("jobs.review")}
      </h3>
      <dl>
        <dt>${context.t("jobs.type")}</dt>
        <dd>${value.jobType || context.t("jobs.all")}</dd>
        <dt>${context.t("jobs.region")}</dt>
        <dd>${value.region || context.t("jobs.all")}</dd>
        <dt>${context.t("jobs.language")}</dt>
        <dd>
          ${context.languages.find((lang) => lang.code === value.lang)?.nameNative}
        </dd>
        <dt>${context.t("jobs.channel")}</dt>
        <dd>${context.t(`jobs.${value.channel}`)}</dd>
        <dt>${context.t("jobs.contact")}</dt>
        <dd>${value.contact}</dd>
      </dl>
      <button
        type="button"
        ?disabled=${value.busy}
        @click=${() =>
          void perform(context, async () => {
            const subscription = await api<Subscription>(
              context,
              "/subscriptions",
              {
                clientRequestId: value.clientRequestId,
                jobType: value.jobType || undefined,
                region: value.region || undefined,
                lang: value.lang,
                channel: value.channel,
                contact: value.contact,
                consent: { accepted: true, noticeVersion: "job-alerts-v1" },
              },
            );
            value.subscriptions = [
              ...value.subscriptions.filter((x) => x.id !== subscription.id),
              subscription,
            ];
            value.active = false;
            erasePrivate(value);
            remove(context);
            value.notice = context.t("jobs.subscribed");
          })}
      >
        ${context.t("jobs.subscribe")}
      </button>`;
  }
  if (value.step === 0)
    return html`<label for="career-job">${context.t("jobs.chooseJob")}</label
      ><select
        id="career-job"
        data-career-focus
        .value=${value.jobId}
        @change=${(event: Event) => {
          value.jobId = (event.target as HTMLSelectElement).value;
          refresh(context);
        }}
      >
        ${eligibleJobs(value).map((job) => html`<option value=${job.id}>${job.title}</option>`)}
      </select>`;
  if (value.step === 1)
    return html`<fieldset>
      <legend tabindex="-1" data-career-focus>
        ${context.t("jobs.needs")}
      </legend>
      ${options(context, value.needs, (needs) => {
        value.needs = needs;
        refresh(context);
      })}
    </fieldset>`;
  if (value.step === 2) return field(context, "otherText", "jobs.other");
  if (value.step === 3)
    return html`${field(context, "name", "jobs.name")}
      <p>${context.t("jobs.anonymous")}</p>`;
  if (value.step === 4)
    return html`<label for="career-interview"
        >${context.t("jobs.interviewAt")}</label
      ><input
        id="career-interview"
        data-career-focus
        type="datetime-local"
        .value=${value.interviewAt}
        @input=${(event: Event) => {
          value.interviewAt = (event.target as HTMLInputElement).value;
          refresh(context);
        }}
      />`;
  return html`<h3 tabindex="-1" data-career-focus>
      ${context.t("jobs.reviewMessage")}
    </h3>
    <p class="career-exact">${value.draft?.message}</p>
    ${value.draft?.sendAttempted ? html`<p role="status">${context.t("jobs.deliveryUncertain")}</p>` : nothing}
    ${value.draft?.interviewDisplay ? html`<p>${value.draft.interviewDisplay}</p>` : nothing}<button
      type="button"
      ?disabled=${value.busy}
      @click=${() =>
        void perform(context, async () => {
          if (value.draft?.status === "approved")
            value.draft = { ...value.draft, sendAttempted: true };
          const draft = await api<Draft>(context, "/accommodation-requests", {
            action: value.draft?.status === "approved" ? "send" : "approve",
            id: value.draftId,
            revision: value.draft?.revision,
          });
          applyDraft(value, draft);
          if (draft.status === "sent") {
            value.drafts = value.drafts.filter((item) => item.id !== draft.id);
            value.active = false;
            erasePrivate(value);
            remove(context);
            value.notice = context.t("jobs.sent");
          }
        })}
    >
      ${context.t(value.draft?.status === "approved" ? (value.draft.sendAttempted ? "error.retry" : "jobs.send") : "jobs.approve")}
    </button>`;
}
function flow(context: CareerContext) {
  const value = state(context);
  const last = value.flow === "subscription" ? 6 : 5;
  const disabled =
    value.busy ||
    value.recording ||
    (value.flow === "subscription" &&
      ((value.step === 4 && !value.consent) ||
        (value.step === 5 && !value.contact.trim()))) ||
    (value.flow === "accommodation" &&
      ((value.step === 0 && !value.jobId) ||
        (value.step === 1 && value.needs.length === 0)));
  return html`<section
    class="career-flow"
    aria-label=${context.t(value.flow === "subscription" ? "jobs.alerts" : "jobs.accommodation")}
  >
    <p role="status">
      ${context.t("jobs.progress", { current: value.step + 1, total: last + 1 })}
    </p>
    ${stepContent(context)}
    <div class="career-actions">
      ${
        value.step > 0
          ? html`<button
              type="button"
              ?disabled=${value.busy || value.draft?.status === "approved"}
              @click=${() => {
                stopVoice(context);
                value.step--;
                if (value.flow === "accommodation") {
                  value.clientRequestId = crypto.randomUUID();
                  value.draft = undefined;
                }
                refresh(context, true);
              }}
            >
              ${context.t("jobs.back")}
            </button>`
          : nothing
      }
      ${value.step < last ? html`<button type="button" ?disabled=${disabled} @click=${() => void next(context)}>${context.t("jobs.next")}</button>` : nothing}
      <button
        type="button"
        ?disabled=${value.busy || value.recording || value.draft?.sendAttempted || (value.flow === "accommodation" && (!value.jobId || value.needs.length === 0))}
        @click=${() =>
          void perform(context, async () => {
            if (value.flow === "accommodation") await saveDraft(context);
            persist(context);
            stopVoice(context);
            erasePrivate(value);
            value.active = false;
            value.notice = context.t("jobs.saved");
          })}
      >
        ${context.t("jobs.save")}
      </button>
      <button
        type="button"
        ?disabled=${value.busy || value.draft?.sendAttempted}
        @click=${() =>
          void perform(context, async () => {
            if (value.draftId)
              await api(context, "/accommodation-requests", {
                action: "cancel",
                id: value.draftId,
              });
            value.drafts = value.drafts.filter(
              (item) => item.id !== value.draftId,
            );
            stopVoice(context);
            erasePrivate(value);
            value.active = false;
            remove(context);
          })}
      >
        ${context.t("jobs.cancel")}
      </button>
    </div>
  </section>`;
}
function browse(context: CareerContext) {
  const value = state(context);
  const jobs = filterBySupport(value.jobs, value.support);
  return html`<div class="career-actions">
      <button
        type="button"
        ?disabled=${value.busy || !value.channels.length}
        @click=${() => newFlow(context, "subscription")}
      >
        ${context.t("jobs.alerts")}</button
      ><button
        type="button"
        ?disabled=${value.busy || !value.relayAvailable || !eligibleJobs(value).length}
        @click=${() => newFlow(context, "accommodation")}
      >
        ${context.t("jobs.accommodation")}
      </button>
      ${
        value.saved
          ? html`<button
              type="button"
              ?disabled=${value.busy}
              @click=${() =>
                void perform(context, async () => {
                  const saved = value.saved!;
                  erasePrivate(value);
                  Object.assign(value, saved, { active: true });
                  if (saved.flow === "accommodation" && saved.draftId) {
                    applyDraft(
                      value,
                      await api<Draft>(context, "/accommodation-requests", {
                        action: "resume",
                        id: saved.draftId,
                      }),
                    );
                    value.step = 5;
                  }
                })}
            >
              ${context.t("jobs.resume")}
            </button>`
          : nothing
      }
    </div>
    ${value.drafts
      .filter(
        (draft) =>
          ["draft", "approved"].includes(draft.status) &&
          draft.id !== value.saved?.draftId,
      )
      .map(
        (draft) =>
          html`<button
            type="button"
            ?disabled=${value.busy}
            @click=${() =>
              void perform(context, async () => {
                newFlow(context, "accommodation");
                applyDraft(
                  value,
                  await api<Draft>(context, "/accommodation-requests", {
                    action: "resume",
                    id: draft.id,
                  }),
                );
                value.step = 5;
              })}
          >
            ${context.t("jobs.draft")}:
            ${value.jobs.find((job) => job.id === draft.jobId)?.title ?? context.t("jobs.accommodation")}
          </button>`,
      )}
    ${!value.channels.length || !value.relayAvailable ? html`<p>${context.t("jobs.unavailable")}</p>` : nothing}
    ${value.subscriptions
      .filter((subscription) => subscription.status === "active")
      .map(
        (subscription) =>
          html`<section>
            <p>${context.t("jobs.subscribed")}</p>
            <button
              type="button"
              ?disabled=${value.busy}
              @click=${() =>
                void perform(context, async () => {
                  await api(
                    context,
                    `/subscriptions/${encodeURIComponent(subscription.id)}`,
                    undefined,
                    "DELETE",
                  );
                  value.subscriptions = value.subscriptions.filter(
                    (x) => x.id !== subscription.id,
                  );
                  value.notice = context.t("jobs.stopped");
                })}
            >
              ${context.t("jobs.stop")}
            </button>
          </section>`,
      )}
    <form
      class="career-filter"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        void perform(context, () => catalog(context));
      }}
    >
      ${field(context, "browseRegion", "jobs.region")}
      ${field(context, "browseType", "jobs.type")}
      <button type="submit" ?disabled=${value.busy || value.recording}>
        ${context.t("jobs.browse")}
      </button>
    </form>
    <fieldset>
      <legend>${context.t("jobs.support")}</legend>
      <p>${context.t("jobs.supportPrivate")}</p>
      ${options(context, value.support, (support) => {
        value.support = support;
        refresh(context);
      })}
    </fieldset>
    ${
      jobs.length
        ? jobs.map(
            (job) =>
              html`<article lang=${job.lang}>
                <h3>
                  <a
                    href=${/^https?:\/\//.test(job.url) ? job.url : nothing}
                    target="_blank"
                    rel="noopener noreferrer"
                    >${job.title}</a
                  >
                </h3>
                <p>${job.organization}</p>
                <p>${job.location}</p>
                <p>${job.description}</p>
                ${job.deadlineDisplay ? html`<p lang=${context.uiLanguage}>${context.t("jobs.deadline")}: ${job.deadlineDisplay}</p>` : nothing}
              </article>`,
          )
        : html`<p>${context.t("jobs.empty")}</p>`
    }
    ${
      value.glossary.length
        ? html`<details>
            <summary>${context.t("jobs.glossary")}</summary>
            <dl>
              ${value.glossary.map(
                (term) =>
                  html`<dt>${term.term}</dt>
                    <dd>${term.meaning}</dd>`,
              )}
            </dl>
          </details>`
        : nothing
    }`;
}
export const careerRuntime = {
  cancelVoice(this: CareerContext): void {
    stopVoice(this);
    refresh(this);
  },
  async open(this: CareerContext): Promise<void> {
    const value = state(this);
    value.open = !value.open;
    if (!value.open) {
      careerRuntime.suspend.call(this);
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>(".career-launcher")?.focus(),
      );
      return;
    }
    value.saved = stored(this);
    refresh(this, true);
    await perform(this, () => catalog(this));
  },
  render(this: CareerContext) {
    const value = state(this);
    if (!value.open) return nothing;
    return html`<section
      class="panel career"
      lang=${this.uiLanguage}
      dir=${this.uiDirection}
      aria-labelledby="career-heading"
    >
      <h2 id="career-heading" tabindex="-1" data-career-focus>
        ${this.t("jobs.title")}
      </h2>
      <p role=${value.failed ? "alert" : "status"}>
        ${value.busy ? this.t("status.loading") : value.notice}
      </p>
      ${value.failed && !value.active ? html`<button type="button" @click=${() => void perform(this, () => catalog(this))}>${this.t("error.retry")}</button>` : nothing}${value.active ? flow(this) : browse(this)}<button
        type="button"
        @click=${() => void careerRuntime.open.call(this)}
      >
        ${this.t("jobs.close")}
      </button>
    </section>`;
  },
  suspend(this: CareerContext): void {
    const value = state(this);
    stopVoice(this);
    value.controller.abort();
    value.controller = new AbortController();
    ++value.run;
    value.busy = false;
    value.support = [];
    erasePrivate(value);
    value.active = false;
    value.open = false;
    refresh(this);
  },
  dispose(this: CareerContext, clear = false): void {
    if (clear) remove(this);
    careerRuntime.suspend.call(this);
    states.delete(this);
  },
};
