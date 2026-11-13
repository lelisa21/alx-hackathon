# Local and remote AI adapters

P02 implements FR-AI-02–10 and AR-01/08 through the existing provider registry.
The default remains `offline`; no model or credential is needed for sourced
FAQ answers and short extracts. Provider conformance uses synthetic mocked
HTTP responses. No real cloud account or local model was configured for this
change, so model quality, real-adapter latency, and the new-machine walkthrough
remain unverified. See `EVAL.md` for measured offline results and open gates.

## Choose and run a local model

The training-week model recommendations requested by FR-AI-10 have not been
provided. They must be confirmed before calling any model the project's
recommended choice. Two small reference candidates for host evaluation are
[Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) and
[Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct);
their publisher's model cards identify Apache-2.0 licenses. Neither has passed
Dimts' Amharic, Afaan Oromoo, accessibility, hardware or latency acceptance.
Check the exact downloaded weight revision, quantization and license rather
than treating a family name as a quality guarantee.

1. Complete the repository's [local setup](../README.md), including Node,
   pnpm, the database, migrations, host settings and course ingestion.
   Keep model weights outside this repository.
2. Install a host-approved `llama-server` release and a compatible GGUF
   conversion of the approved model. Record the server version and the model
   revision/checksum. The upstream [server guide](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
   documents local GGUF loading, model aliases, context size and the compatible
   `/v1/models` and `/v1/chat/completions` interfaces.
3. Start the server on loopback. Replace the weight path with the actual file.
   Disable prompt logging; do not enable verbose request/body logs.

   ```powershell
   llama-server -m C:\models\approved-model.gguf --alias dimts-local --host 127.0.0.1 --port 8080 --ctx-size 4096 --log-disable
   ```

4. Check readiness without submitting learner data:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8080/v1/models
   ```

   Confirm that the response advertises `dimts-local`. If the endpoint reports
   loading or a model error, fix that before starting Dimts. A successful
   model listing alone does not establish valid JSON output or language quality.

5. In the shell that starts the Dimts API, configure the existing binding
   contract. Keep the normal database and host secrets from local setup.

   ```powershell
   $env:DIMTS_AI_PROVIDER = 'local-model'
   $env:DIMTS_AI_LADDER = 'local-model,offline'
   $env:DIMTS_AI_MAX_TOKENS = '400'
   $env:DIMTS_AI_TEMPERATURE = '0.1'
   $env:DIMTS_AI_PROVIDERS = '[{"id":"local-model","adapter":"openai-compatible","endpoint":"http://127.0.0.1:8080/v1","model":"dimts-local","privacyClass":"local","enabled":true,"priority":10,"timeoutMs":15000,"allowedDataClasses":["question","course-passage","glossary"],"evaluatedLanguages":[],"capabilities":{"languages":["en"],"modes":["extractive"],"modalities":["text"],"structuredOutput":true}}]'
   pnpm api:start
   ```

   Only declare capabilities the exact server/model supports. Initially keep
   `evaluatedLanguages` empty and the model extractive. A remote endpoint must
   use `privacyClass: remote`; calling it local does not create a privacy boundary.

6. Ask a sourced public fixture question through the existing API/widget.
   Check `/v1/health` and the authenticated helper console for provider status;
   the learner reply must not display provider identity. Stop the local model
   and repeat with a new client message ID: the service must degrade to a
   cited offline answer or localized notfound with help. A duplicate message
   ID intentionally returns the original stored reply.
7. Run `pnpm eval` for the offline baseline. Run the actual configured model
   against the same approved checks through `/v1/ask`, including Simple mode,
   malformed/timeout/injection cases and source-language pairs. Record misses,
   native review and end-to-end timings before expanding capability claims.
   A mock or offline result is not a local-model evaluation.

## Dedicated remote adapters

`openai`, `gemini` and `xai` are separate registered adapters. All require a
server-side `credentialRef`, HTTPS and remote privacy classification. Model
IDs remain host configuration: choose a model that supports the adapter's
structured format and bounded token/temperature controls, then evaluate it.
Unsupported controls or vendor refusals cause fallback; there is no silent
removal of privacy or output-validation rules to make a request succeed.

- `openai`: native Responses requests, default endpoint
  `https://api.openai.com/v1`, `max_output_tokens`, JSON schema through
  `text.format`, and `store: false`. The parser accepts completed assistant
  output only. [OpenAI Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- `gemini`: native `models/{model}:generateContent`, default endpoint
  `https://generativelanguage.googleapis.com/v1beta`, `x-goog-api-key`,
  `systemInstruction`, `contents` and `generationConfig`. Blocked, incomplete
  or non-text candidates are rejected. [Gemini generateContent reference](https://ai.google.dev/api/generate-content)
- `xai`: the documented Responses request and output format, default endpoint
  `https://api.x.ai/v1`, with `store: false` and structured JSON output.
  It has its own adapter registration and conformance fixtures rather than
  assuming every vendor speaks compatible chat. [xAI Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- `openai-compatible`: convenience for a host-verified compatible server,
  including a local open-model server; its endpoint is required. It uses
  `/chat/completions` and JSON-object mode, then validates the returned schema
  and source IDs itself. This adapter does not establish compatibility with
  any unnamed vendor.

For a remote profile, replace the local example's `adapter`, `model` and
`endpoint`, set `privacyClass` to `remote`, reference the appropriate secret
environment variable via `credentialRef`, and allow only `question` and
`course-passage`. Keep credentials out of JSON returned to clients and source
control. A host-enabled binding still receives no health/answer request for a
learner who has not granted current remote-AI consent. Revoke consent through
the existing session API; the next ask must not contact a remote provider.
`store: false` is an API storage setting, not a claim about a vendor's complete
data-retention or training policy; the host must check its actual account terms.

## Validation and operating limits

The registry intersects configured and actual language, mode, modality,
structured-output, evaluated-language and allowed-data declarations, and
rejects privacy-class disagreement. The ladder uses the configured order and
priority, skips ineligible providers before health checks, retries malformed
output once within the same timeout budget, and cools failed providers for
60 seconds. The API always retains an offline fallback. Explicit ladder order,
including the position of offline, is preserved; remaining enabled bindings
follow in priority order. Selecting offline keeps it first.

Remote user data contains only the question and eligible course passage IDs
and text. Source labels/URLs, glossary material, job text, history, session
IDs and contact identifiers are excluded. Trusted system rules include the
per-turn language, answer mode and sentence limit. Local processing can use
indexed job passages and glossary data under the same citation checks.
HTTP adapters reject extractive output unless it contains one to three
complete sentences copied from the cited sources. The offline adapter can
use the pack's sourced localized FAQ answer. Long answers are rejected rather
than clipped or given artificial sentence breaks.
The offline adapter accepts an injected source-ID resolver for persisted index
namespaces. A resolved FAQ citation must already be among the safe retrieved
passages; unknown, ambiguous or unavailable mappings fall back to extraction.
Offline passage extraction uses question keywords to locate a relevant complete
sentence and retains its adjacent source context, up to three sentences. It
does not reorder fragments or drop a condition from the selected sentence.

Run `pnpm test:core`, `pnpm typecheck` and `pnpm lint` after adapter changes.
Measure p95 at the `/v1/ask` service boundary, including retrieval, provider
health, retries, validation and persistence: offline <=1 second, local <=15
seconds and cloud <=6 seconds. State device/CPU/RAM, model revision, network,
sample count, warm/cold state and cache state. Provider-only timing or a mock
response does not verify those targets. Repeat-answer cache checks have their
separate <50 ms target. Record only aggregate timing and hit/miss metadata;
never log question, passage, answer or contact text.

## Optional Compose Ollama service

Compose includes an opt-in `local-ai` profile. It is not started by the default
local stack and does not change the API's default `offline` provider.

```powershell
docker compose --profile local-ai up -d ollama
docker compose --profile local-ai exec ollama ollama pull qwen2.5:0.5b
```

For API access, add the existing `openai-compatible` local binding to `.env`,
using `http://ollama:11434/v1` as its endpoint, then start both profiles:

```powershell
docker compose --profile local --profile local-ai up --build -d --wait
```

The Ollama model is downloaded into the persistent `ollama-models` volume.
That download requires network access; after the model is present, Ollama can
serve requests locally. The API still falls back to `offline` on provider
failure. The model image and weights are large and are excluded from the
five-minute base Compose smoke test. No Ollama model, language quality, or
local inference performance has been verified for release.
