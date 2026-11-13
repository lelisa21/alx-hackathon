# Evaluation results

| Language | Questions | Retrieval hit rate | Citation validity | Not-found correctness | Answer-language correctness | Average sentence length (words) |
| -------- | --------: | -----------------: | ----------------: | --------------------: | --------------------------: | ------------------------------: |
| am       |        15 |                 0% |               n/a |                  100% |                         n/a |                             n/a |
| en       |        13 |               100% |              100% |                  100% |                        100% |                             8.0 |
| om       |        16 |                 0% |               n/a |                  100% |                         n/a |                             n/a |

Sentence-length target: average at most 15 words, or 12 words in Simple mode. Normal and Simple measurements are separate.
A value of n/a means the fixture set contains no applicable observations; it is not a pass.

## Answer and Simple-mode coverage

- am: 15 distinct questions / 30 normal+Simple runs; 0/16 actual/expected answers; answer recall 0.0%; reply-kind accuracy 46.7%; normal average/max n/a/n/a, Simple average/max n/a/n/a words.
- en: 13 distinct questions / 26 normal+Simple runs; 2/12 actual/expected answers; answer recall 16.7%; reply-kind accuracy 61.5%; normal average/max 8.0/8, Simple average/max 8.0/8 words.
- om: 16 distinct questions / 32 normal+Simple runs; 0/18 actual/expected answers; answer recall 0.0%; reply-kind accuracy 43.8%; normal average/max n/a/n/a, Simple average/max n/a/n/a words.

No-answer outcomes remain in retrieval and answer-recall denominators. Null answer metrics are not passes.

## Source and language pairs

- course, en → am: 10 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- none, none → am: 14 runs; retrieval n/a; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- job, en → am: 6 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- course, en → en: 10 runs; retrieval 100.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 8.0/8.0.
- none, none → en: 14 runs; retrieval n/a; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- job, en → en: 2 runs; retrieval 100.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- course, en → om: 16 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- none, none → om: 14 runs; retrieval n/a; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- job, en → om: 2 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.

Pairs use expected passages even when retrieval misses, plus actual citations; no-source negative cases use none. Questions may appear in more than one relevant source pair.

## Offline FAQ adapter

- am: 9/9 expected FAQ answers (100.0%); 0 misses; unreviewed draft set.
- en: 9/9 expected FAQ answers (100.0%); 0 misses; unreviewed draft set.
- om: 9/9 expected FAQ answers (100.0%); 0 misses; unreviewed draft set.

FAQ matching is measured separately at the adapter boundary with each FAQ's actual source passage. This does not bypass the engine retrieval/confidence gate; no cross-language acceptance is inferred. The English target is at least 70% on a reviewed set, which remains unavailable.

## Latency conditions

Node v26.13.1; win32/x64; offline in-process ask service boundary, sample content and warm dependencies; no database or learner network. 88 uncached normal+Simple requests: p95 4.45 ms (target <=1000 ms). 40 repeated answers with zero additional provider calls: p95 3.06 ms (target <50 ms).

Timings include retrieval, language/citation validation and reply construction. They do not establish deployed HTTP/PostgreSQL or real-model performance.

## Gate findings

Measured citation, notfound, language, sentence-length, FAQ and latency gates passed where applicable. This is not final language acceptance; answer recall and unmeasured cases remain visible above.

## Acceptance blockers

- am: pack and evaluation questions require human review; status draft.
- en: pack and evaluation questions require human review; status beta.
- om: pack and evaluation questions require human review; status draft.
- am: no answers; citation and answer-language correctness remain unverified.
- am: no Simple answers; sentence-length acceptance unverified.
- om: no answers; citation and answer-language correctness remain unverified.
- om: no Simple answers; sentence-length acceptance unverified.
- No real local open-model or cloud adapter configured in this offline harness: 15 s / 6 s p95 targets are unverified.

Run `pnpm eval` from the repository root. Each checks.yaml question runs in both normal and Simple mode; floors and expected outcomes are unchanged. Glossary expansion requires actual review metadata. The checked-in sources are English sample course/job fixtures, not a multilingual production corpus. Counts and status are evidence, not a release sign-off.

This offline run uses only local sample content and does not make provider network requests.
