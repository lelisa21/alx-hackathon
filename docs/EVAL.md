# Evaluation results

| Language | Questions | Retrieval hit rate | Citation validity | Not-found correctness | Answer-language correctness | Average sentence length (words) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| am | 15 | 0% | 100% | 100% | 100% | 6.5 |
| en | 13 | 17% | 100% | 100% | 100% | 6.4 |
| om | 16 | 0% | 100% | 100% | 100% | 6.6 |
| ti | 15 | 0% | 100% | 80% | 100% | 6.0 |

Sentence-length target: average at most 15 words, or 12 words in Simple mode. Normal and Simple measurements are separate.
A value of n/a means the fixture set contains no applicable observations; it is not a pass.

## Answer and Simple-mode coverage

- am: 15 distinct questions / 30 normal+Simple runs; 2/16 actual/expected answers; answer recall 12.5%; reply-kind accuracy 53.3%; normal average/max 6.5/7, Simple average/max 6.5/7 words.
- en: 13 distinct questions / 26 normal+Simple runs; 10/12 actual/expected answers; answer recall 83.3%; reply-kind accuracy 92.3%; normal average/max 6.4/10, Simple average/max 6.4/10 words.
- om: 16 distinct questions / 32 normal+Simple runs; 8/18 actual/expected answers; answer recall 44.4%; reply-kind accuracy 68.8%; normal average/max 6.6/9, Simple average/max 6.6/9 words.
- ti: 15 distinct questions / 30 normal+Simple runs; 8/16 actual/expected answers; answer recall 37.5%; reply-kind accuracy 60.0%; normal average/max 6.0/9, Simple average/max 6.0/9 words.

No-answer outcomes remain in retrieval and answer-recall denominators. Null answer metrics are not passes.

## Source and language pairs

- none, none → am: 22 runs; retrieval 0.0%; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- course, am → am: 2 runs; retrieval 0.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 6.5/6.5.
- job, en → am: 6 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- none, none → en: 16 runs; retrieval 0.0%; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- course, en → en: 8 runs; retrieval 0.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 7.5/7.5.
- job, en → en: 2 runs; retrieval 100.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 2.7/2.7.
- course, om → om: 8 runs; retrieval 0.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 6.6/6.6.
- none, none → om: 22 runs; retrieval 0.0%; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- job, en → om: 2 runs; retrieval 0.0%; citations n/a; notfound n/a; answer language n/a; normal/Simple average sentence words n/a/n/a.
- none, none → ti: 18 runs; retrieval 0.0%; citations n/a; notfound 100.0%; answer language n/a; normal/Simple average sentence words n/a/n/a.
- course, ti → ti: 8 runs; retrieval 0.0%; citations 100.0%; notfound 0.0%; answer language 100.0%; normal/Simple average sentence words 6.0/6.0.
- job, en → ti: 6 runs; retrieval 0.0%; citations 100.0%; notfound n/a; answer language 100.0%; normal/Simple average sentence words 5.7/5.7.

Pairs use expected passages even when retrieval misses, plus actual citations; no-source negative cases use none. Questions may appear in more than one relevant source pair.

## Offline FAQ adapter

- am: 0/30 expected FAQ answers (0.0%); 30 misses; unreviewed draft set.
- en: 0/30 expected FAQ answers (0.0%); 30 misses; unreviewed draft set.
- om: 0/30 expected FAQ answers (0.0%); 30 misses; unreviewed draft set.
- ti: 0/30 expected FAQ answers (0.0%); 30 misses; unreviewed draft set.

FAQ matching is measured separately at the adapter boundary with each FAQ's actual source passage. This does not bypass the engine retrieval/confidence gate; no cross-language acceptance is inferred. The English target is at least 70% on a reviewed set, which remains unavailable.

## Latency conditions

Node v24.18.1; win32/x64; offline in-process ask service boundary, sample content and warm dependencies; no database or learner network. 118 uncached normal+Simple requests: p95 9.97 ms (target <=1000 ms). 560 repeated answers with zero additional provider calls: p95 9.20 ms (target <50 ms).

Timings include retrieval, language/citation validation and reply construction. They do not establish deployed HTTP/PostgreSQL or real-model performance.

## Gate findings

- en: offline FAQ adapter hit rate below 70%.
- ti: not-found correctness is below 90%.

## Acceptance blockers

- am: pack and evaluation questions require human review; status draft.
- en: pack and evaluation questions require human review; status beta.
- om: pack and evaluation questions require human review; status draft.
- ti: pack and evaluation questions require human review; status draft.
- No real local open-model or cloud adapter configured in this offline harness: 15 s / 6 s p95 targets are unverified.

Run `pnpm eval` from the repository root. Each checks.yaml question runs in both normal and Simple mode; floors and expected outcomes are unchanged. Glossary expansion requires actual review metadata. The checked-in sources are English sample course/job fixtures, not a multilingual production corpus. Counts and status are evidence, not a release sign-off.

This offline run uses only local sample content and does not make provider network requests.
