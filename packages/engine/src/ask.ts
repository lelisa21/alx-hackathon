import type {
  AnswerResult,
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
): Promise<Reply> {
  const found = await deps.search(request.text, request.lang);
  const passages = found.slice(0, 5);
  const best = passages[0];
  if (!best || best.score < deps.confidenceFloor(request.lang)) {
    return notFoundReply(request, deps);
  }

  const passagesById = new Map(
    passages.map((passage) => [passage.id, passage]),
  );
  let result: AnswerResult;
  try {
    result = await deps.answer({
      question: request.text,
      lang: request.lang,
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
      glossary: deps.glossaryFor(request.text, request.lang),
      simple: request.simple ?? false,
      mode: deps.modeFor(request.lang),
      systemPrompt: deps.systemPrompt(request.lang),
    });
  } catch {
    return notFoundReply(request, deps);
  }

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
    return notFoundReply(request, deps);
  }

  return {
    id: deps.createId(),
    kind: "answer",
    text: result.text,
    lang: request.lang,
    dir: deps.direction(request.lang),
    citations,
    actions: [],
    provider: result.provider,
    contentVersion: await deps.contentVersion(),
  };
}
