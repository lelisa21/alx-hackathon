import type {
  AnswerPolicy,
  AskDependencies,
  AskRequest,
  Citation,
  Reply,
} from "./types.js";

async function notFoundReply(
  request: AskRequest,
  deps: AskDependencies,
): Promise<Reply> {
  return {
    id: deps.createId(),
    kind: "notfound",
    text: deps.translate(request.lang, "answer.notfound"),
    lang: request.lang,
    dir: deps.direction(request.lang),
    citations: [],
    actions: [
      { type: "help", label: deps.translate(request.lang, "help.button") },
    ],
    contentVersion: await deps.contentVersion(),
  };
}

export async function ask(
  request: AskRequest,
  deps: AskDependencies,
  policy: AnswerPolicy = { cloudOk: false },
): Promise<Reply> {
  const detection = await deps.languageDetector?.detect(request.text);
  const threshold = deps.languageDetectionConfidence ?? 0.25;
  const detectedLang =
    detection &&
    Number.isFinite(detection.confidence) &&
    detection.confidence >= threshold &&
    detection.confidence <= 1 &&
    detection.language.trim()
      ? detection.language
      : request.lang;
  const turnRequest =
    detectedLang === request.lang
      ? request
      : { ...request, lang: detectedLang };
  const found = await deps.search(turnRequest.text, turnRequest.lang);
  const passages = found.slice(0, 5);
  const best = passages[0];
  if (!best || best.score < deps.confidenceFloor(turnRequest.lang)) {
    return await notFoundReply(turnRequest, deps);
  }

  const passagesById = new Map(
    passages.map((passage) => [passage.id, passage]),
  );
  const result = await deps.answer(
    {
      question: turnRequest.text,
      lang: turnRequest.lang,
      passages: passages.map(
        ({ id, text, label, url, lang, sourceType, timestamp }) => ({
          id,
          text,
          label,
          url,
          lang,
          sourceType,
          ...(timestamp === undefined ? {} : { timestamp }),
        }),
      ),
      glossary: deps.glossaryFor(turnRequest.text, turnRequest.lang),
      simple: turnRequest.simple ?? false,
      mode: deps.modeFor(turnRequest.lang),
      systemPrompt: deps.systemPrompt(turnRequest.lang),
    },
    policy,
  );

  const usedIds = [...new Set(result.usedPassageIds)];
  const citations: Citation[] = usedIds.flatMap((id) => {
    const passage = passagesById.get(id);
    if (!passage) return [];
    return [
      {
        passageId: passage.id,
        label: passage.label,
        url: passage.url,
        sourceLang: passage.lang,
        sourceType: passage.sourceType,
        ...(passage.timestamp === undefined
          ? {}
          : { timestamp: passage.timestamp }),
      },
    ];
  });

  if (citations.length === 0 || !result.text.trim()) {
    return await notFoundReply(turnRequest, deps);
  }

  return {
    id: deps.createId(),
    kind: "answer",
    text: result.text,
    lang: turnRequest.lang,
    dir: deps.direction(turnRequest.lang),
    citations,
    actions: [],
    contentVersion: await deps.contentVersion(),
  };
}
