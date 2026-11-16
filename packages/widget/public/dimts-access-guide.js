/* Shared, host-isolated access guide for the Bridgely homepage and Savanna. */
(function () {
  "use strict";

  var doc = globalThis.document;
  var localeUrl = new URL("dimts-home-access.json", doc.currentScript.src);
  var cssUrl = new URL("dimts-access-guide.css", doc.currentScript.src);
  var routes = {
    "en-US": {
      assistant: [
        "assistant",
        "tutor",
        "chat",
        "chat assistant",
        "bridgely",
        "ask bridgely",
        "open bridgely",
        "ask dimts",
        "ask a question",
        "questions",
      ],
      content: [
        "content",
        "page",
        "page content",
        "current page",
        "this page",
        "main content",
      ],
      lessons: [
        "lessons",
        "lesson",
        "course",
        "courses",
        "course library",
        "classes",
        "study materials",
        "learning materials",
      ],
      savanna: ["savanna", "alx savanna", "learner portal", "learning portal"],
      helper: [
        "human help",
        "human support",
        "support",
        "help",
        "real person",
        "talk to someone",
        "contact a person",
        "contact support",
        "customer support",
        "help desk",
      ],
      status: [
        "status",
        "service status",
        "system status",
        "service health",
        "system health",
        "service is up",
        "services",
        "health",
      ],
    },
    "am-ET": {
      assistant: ["ረዳት"],
      content: ["ይዘት"],
      lessons: ["ትምህርቶች"],
      savanna: ["ሳቫና"],
      helper: ["እገዛ"],
      status: ["ሁኔታ"],
    },
    "om-ET": {
      assistant: ["gargaaraa"],
      content: ["qabiyyee"],
      lessons: ["barnoota", "koorsii"],
      savanna: ["savanna"],
      helper: ["gargaarsa"],
      status: ["haala"],
    },
    "ti-ET": {
      assistant: ["ሓጋዚ"],
      content: ["ትሕዝቶ"],
      lessons: ["ትምህርቲ"],
      savanna: ["ሳቫና"],
      helper: ["ሓገዝ"],
      status: ["ኩነታት"],
    },
  };
  var commandFillers = new Set([
    "a",
    "an",
    "and",
    "can",
    "could",
    "do",
    "for",
    "get",
    "go",
    "i",
    "is",
    "me",
    "my",
    "need",
    "of",
    "on",
    "open",
    "over",
    "please",
    "show",
    "some",
    "take",
    "the",
    "to",
    "want",
    "whether",
    "would",
    "you",
  ]);

  function normalizeWords(value, languageTag) {
    return value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase(languageTag || "en-US")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(function (word) {
        if (!/^[a-z]+$/u.test(word)) return word;
        if (word.length > 5 && word.endsWith("ies"))
          return word.slice(0, -3) + "y";
        if (word.length > 5 && /(?:ses|xes|zes|ches|shes)$/u.test(word))
          return word.slice(0, -2);
        if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss"))
          return word.slice(0, -1);
        return word;
      });
  }

  function editDistance(left, right) {
    var rows = left.length + 1;
    var columns = right.length + 1;
    var matrix = Array.from({ length: rows }, function () {
      return Array(columns).fill(0);
    });
    for (var row = 0; row < rows; row += 1) matrix[row][0] = row;
    for (var column = 0; column < columns; column += 1)
      matrix[0][column] = column;
    for (var i = 1; i < rows; i += 1) {
      for (var j = 1; j < columns; j += 1) {
        var substitution = left[i - 1] === right[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + substitution,
        );
        if (
          i > 1 &&
          j > 1 &&
          left[i - 1] === right[j - 2] &&
          left[i - 2] === right[j - 1]
        ) {
          matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
        }
      }
    }
    return matrix[rows - 1][columns - 1];
  }

  function aliasScore(phraseWords, alias, languageTag) {
    var aliasWords = normalizeWords(alias, languageTag).filter(function (word) {
      return !commandFillers.has(word);
    });
    if (!aliasWords.length) return 0;
    for (
      var start = 0;
      start <= phraseWords.length - aliasWords.length;
      start += 1
    ) {
      if (
        aliasWords.every(function (word, index) {
          return phraseWords[start + index] === word;
        })
      )
        return 1;
    }
    var exactMatches = aliasWords.filter(function (word) {
      return phraseWords.includes(word);
    }).length;
    if (exactMatches === aliasWords.length) return 0.97;

    var fuzzyMatches = 0;
    aliasWords.forEach(function (word) {
      if (phraseWords.includes(word)) {
        fuzzyMatches += 1;
        return;
      }
      if (word.length < 5) return;
      var closest = phraseWords.reduce(function (best, candidate) {
        return Math.min(best, editDistance(word, candidate));
      }, word.length);
      if (closest <= (word.length >= 7 ? 2 : 1)) fuzzyMatches += 0.88;
    });
    return fuzzyMatches / aliasWords.length;
  }

  function matchDestination(transcript, languageTag, destinations, labels) {
    var rawWords = normalizeWords(transcript, languageTag);
    var phraseWords = rawWords.filter(function (word) {
      return !commandFillers.has(word);
    });
    if (!phraseWords.length) return { kind: "empty", score: 0 };

    var languageAliases = routes[languageTag] || {};
    var englishAliases = routes["en-US"];
    var candidates = destinations
      .map(function (destination) {
        var aliases = [labels[destination.key]]
          .concat(languageAliases[destination.key] || [])
          .concat(
            languageTag === "en-US"
              ? []
              : englishAliases[destination.key] || [],
          )
          .filter(Boolean);
        var score = aliases.reduce(function (best, alias) {
          return Math.max(best, aliasScore(phraseWords, alias, languageTag));
        }, 0);
        return { destination: destination, score: score };
      })
      .sort(function (left, right) {
        return right.score - left.score;
      });
    var best = candidates[0];
    if (!best || best.score < 0.84)
      return { kind: "unknown", score: best ? best.score : 0 };
    if (candidates[1] && best.score - candidates[1].score < 0.07)
      return { kind: "ambiguous", score: best.score };
    return { kind: "match", destination: best.destination, score: best.score };
  }

  // Diagnostics are opt-in and deliberately contain no recognized speech.
  function debug(stage, details) {
    if (globalThis.DIMTS_ACCESS_DEBUG !== true) return;
    globalThis.console.debug("[Bridgely Access Guide] " + stage, details);
  }

  function element(name, text, attributes) {
    var node = doc.createElement(name);
    if (text) node.textContent = text;
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    return node;
  }

  function makeIcon() {
    var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    [
      "M12 3a6 6 0 0 0-6 6v3a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6Z",
      "M4 11v1a8 8 0 0 0 16 0v-1M12 20v2m-4 0h8",
    ].forEach(function (data) {
      var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      svg.appendChild(path);
    });
    return svg;
  }

  function mount(host, localePacks) {
    if (host.shadowRoot) return;
    var surface = host.getAttribute("data-dimts-access-guide") || "homepage";
    var savanna = surface === "savanna";
    var shadow = host.attachShadow({ mode: "open" });
    var stylesheet = element("link", "", {
      rel: "stylesheet",
      href: cssUrl.href,
    });
    shadow.appendChild(stylesheet);

    var launcher = element("button", "", {
      id: "access-guide-toggle",
      class: "launcher",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": "access-guide-panel",
      disabled: "",
    });
    launcher.append(makeIcon(), element("span"));
    var panel = element("section", "", {
      class: "panel",
      id: "access-guide-panel",
      role: "region",
      "aria-labelledby": "access-guide-title",
      "aria-describedby": "access-guide-intro",
      hidden: "",
    });
    var title = element("h2", "", { id: "access-guide-title" });
    var intro = element("p", "", { id: "access-guide-intro" });
    var list = element("ul", "", { class: "destinations" });
    var voice = element("section", "", {
      class: "voice",
      "aria-labelledby": "voice-title",
    });
    var voiceTitle = element("h2", "", { id: "voice-title" });
    var welcome = element("p", "", { class: "welcome" });
    var languageLabel = element("label", "", { for: "access-voice-language" });
    var language = element("select", "", { id: "access-voice-language" });
    [
      ["en-US", "en"],
      ["am-ET", "am"],
      ["om-ET", "om"],
      ["ti-ET", "ti"],
    ].forEach(function (entry) {
      language.appendChild(
        element("option", "", { value: entry[0], "data-code": entry[1] }),
      );
    });
    var notice = element("p", "", { class: "notice" });
    var readDirections = element("button", "", {
      id: "access-read-directions",
      class: "action",
      type: "button",
    });
    var stopSpeaking = element("button", "", {
      id: "access-stop-speaking",
      class: "action",
      type: "button",
      hidden: "",
    });
    var start = element("button", "", {
      id: "access-voice-start",
      class: "action",
      type: "button",
    });
    var stop = element("button", "", {
      id: "access-voice-stop",
      class: "action",
      type: "button",
      hidden: "",
    });
    var status = element("p", "", {
      id: "access-voice-status",
      class: "status",
      role: "status",
      "aria-live": "polite",
    });
    var transcript = element("p", "", {
      id: "access-voice-transcript",
      class: "transcript",
      "aria-live": "polite",
    });
    voice.append(
      voiceTitle,
      languageLabel,
      language,
      readDirections,
      stopSpeaking,
      notice,
      start,
      stop,
      status,
      transcript,
    );
    panel.append(title, intro, welcome, list, voice);
    shadow.append(launcher, panel);

    var copy = localePacks.en.ui;
    var recognition;
    var recognitionTimer;
    var recognitionHandled = false;
    var speechGeneration = 0;
    var Recognition =
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    var speech = globalThis.speechSynthesis;
    var Utterance = globalThis.SpeechSynthesisUtterance;
    var canSpeak =
      speech &&
      typeof speech.speak === "function" &&
      typeof Utterance === "function";
    var welcomeSpoken = false;
    var destinations = savanna
      ? [
          { key: "content", href: "#content" },
          { key: "assistant", action: "assistant" },
          { key: "lessons", href: "/learn/" },
          { key: "helper", href: "/helper" },
          { key: "status", href: "/v1/health" },
        ]
      : [
          { key: "assistant", href: "#assistant" },
          { key: "lessons", href: "/learn/" },
          { key: "savanna", href: "/savanna/" },
          { key: "helper", href: "/helper" },
          { key: "status", href: "#status" },
        ];

    function setCopy(code) {
      var locale = localePacks[code] || localePacks.en;
      copy = locale.ui;
      panel.lang = code;
      launcher.querySelector("span").textContent = copy["home.access.toggle"];
      title.textContent = copy["home.access.title"];
      intro.textContent = copy["home.access.intro"];
      welcome.textContent =
        copy[
          savanna ? "home.access.welcomeSavanna" : "home.access.welcomeHomepage"
        ];
      welcome.lang = language.value;
      voiceTitle.textContent = copy["home.access.voiceTitle"];
      languageLabel.textContent = copy["home.access.voiceLanguage"];
      notice.textContent = copy["home.access.voiceNotice"];
      readDirections.textContent = copy["home.access.readDirections"];
      readDirections.disabled = !canSpeak;
      stopSpeaking.textContent = copy["home.access.stopSpeaking"];
      start.textContent = copy["home.access.voiceStart"];
      stop.textContent = copy["home.access.voiceStop"];
      status.textContent = Recognition
        ? copy["home.access.textReady"]
        : copy["home.access.noRecognition"];
      language.querySelectorAll("option").forEach(function (option) {
        var optionLocale = localePacks[option.getAttribute("data-code")];
        option.textContent = optionLocale ? optionLocale.nativeName : "";
      });
      list.replaceChildren();
      destinations.forEach(function (destination) {
        var item = element("li");
        var link;
        if (destination.action) {
          link = element("button", copy["home.access." + destination.key], {
            type: "button",
            class: "destination-action",
          });
          link.addEventListener("click", openAssistant);
        } else {
          link = element("a", copy["home.access." + destination.key], {
            href: destination.href,
          });
        }
        item.appendChild(link);
        list.appendChild(item);
      });
    }

    function openAssistant() {
      var client = globalThis.Bridgely || globalThis.Dimts;
      if (client && typeof client.open === "function") {
        status.textContent = copy["home.access.opening"].replace(
          "{destination}",
          copy["home.access.assistant"],
        );
        client.open();
        return;
      }
      status.textContent = copy["home.access.assistantUnavailable"];
    }

    function cancelSpeech() {
      speechGeneration += 1;
      if (canSpeak) speech.cancel();
      stopSpeaking.hidden = true;
    }

    function speakResponse(text, onEnd) {
      if (!canSpeak) {
        if (onEnd) onEnd();
        return;
      }
      cancelSpeech();
      var utterance = new Utterance(text);
      var finished = false;
      var responseTimer;
      utterance.lang = language.value;
      function finish() {
        if (finished) return;
        finished = true;
        globalThis.clearTimeout(responseTimer);
        stopSpeaking.hidden = true;
        if (onEnd) onEnd();
      }
      utterance.onstart = function () {
        stopSpeaking.hidden = false;
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      try {
        speech.speak(utterance);
        if (onEnd) {
          responseTimer = globalThis.setTimeout(function () {
            if (finished) return;
            speech.cancel();
            finish();
          }, 3500);
        }
      } catch {
        finish();
      }
    }

    function performNavigation(destination) {
      debug("navigation", {
        destination: destination.key,
        action: destination.action || "href",
        href: destination.href || null,
      });
      if (destination.action === "assistant") {
        openAssistant();
      } else if (destination.href === "#content") {
        var content = doc.getElementById("content");
        if (content) content.scrollIntoView();
      } else if (destination.href) {
        globalThis.location.assign(destination.href);
      }
    }

    function navigateTo(destination) {
      status.textContent = copy["home.access.opening"].replace(
        "{destination}",
        copy["home.access." + destination.key],
      );
      speakResponse(status.textContent, function () {
        performNavigation(destination);
      });
    }

    function respondWithStatus(message) {
      status.textContent = message;
      speakResponse(message);
    }

    function speakDirections() {
      if (!canSpeak) {
        status.textContent = copy["home.access.speechUnavailable"];
        return;
      }
      cancelSpeech();
      var generation = speechGeneration;
      var utterance = new Utterance(welcome.textContent);
      utterance.lang = language.value;
      utterance.onstart = function () {
        if (generation !== speechGeneration) return;
        stopSpeaking.hidden = false;
        status.textContent = copy["home.access.speaking"];
      };
      utterance.onend = function () {
        if (generation !== speechGeneration) return;
        stopSpeaking.hidden = true;
        status.textContent = copy["home.access.speechFinished"];
      };
      utterance.onerror = function () {
        if (generation !== speechGeneration) return;
        stopSpeaking.hidden = true;
        status.textContent = copy["home.access.speechUnavailable"];
      };
      try {
        speech.speak(utterance);
      } catch {
        if (generation === speechGeneration)
          status.textContent = copy["home.access.speechUnavailable"];
      }
    }

    launcher.addEventListener("click", function () {
      var opening = launcher.getAttribute("aria-expanded") !== "true";
      launcher.setAttribute("aria-expanded", String(opening));
      panel.hidden = !opening;
      if (opening && !welcomeSpoken) {
        welcomeSpoken = true;
        speakDirections();
      }
      if (!opening) {
        if (recognition) recognition.stop();
        cancelSpeech();
      }
    });
    language.addEventListener("change", function () {
      cancelSpeech();
      setCopy(language.value.split("-")[0]);
    });
    readDirections.addEventListener("click", speakDirections);
    stopSpeaking.addEventListener("click", function () {
      cancelSpeech();
      status.textContent = copy["home.access.stoppedSpeaking"];
    });
    start.disabled = !Recognition;
    start.addEventListener("click", function () {
      if (!Recognition) return;
      cancelSpeech();
      if (recognition) recognition.stop();
      recognition = new Recognition();
      recognition.lang = language.value;
      recognition.continuous = false;
      recognition.interimResults = false;
      // Web Speech defaults to a single candidate. Multiple alternatives let
      // the destination resolver recover when the top ASR hypothesis is wrong.
      recognition.maxAlternatives = 5;
      debug("microphone requested", { locale: recognition.lang });
      recognitionHandled = false;
      recognition.onstart = function () {
        debug("recognition started", { locale: recognition.lang });
        start.hidden = true;
        stop.hidden = false;
        transcript.textContent = "";
        status.textContent = copy["home.access.listening"];
        globalThis.clearTimeout(recognitionTimer);
        recognitionTimer = globalThis.setTimeout(function () {
          recognitionHandled = true;
          status.textContent = copy["home.access.voiceTimeout"];
          if (recognition) recognition.stop();
        }, 60000);
      };
      recognition.onresult = function (event) {
        globalThis.clearTimeout(recognitionTimer);
        recognitionHandled = true;
        var results = event && event.results;
        var result = results && results[results.length - 1];
        var alternatives = [];
        if (result) {
          for (var index = 0; index < result.length; index += 1) {
            var candidate = result[index];
            if (candidate && typeof candidate.transcript === "string") {
              alternatives.push({
                transcript: candidate.transcript.trim(),
                confidence:
                  typeof candidate.confidence === "number"
                    ? candidate.confidence
                    : 0,
              });
            }
          }
        }
        debug("recognition result", {
          resultCount: results ? results.length : 0,
          alternativeCount: alternatives.length,
          transcriptLengths: alternatives.map(function (candidate) {
            return candidate.transcript.length;
          }),
        });
        var heard = alternatives.length ? alternatives[0].transcript : "";
        if (!heard) {
          transcript.textContent = "";
          respondWithStatus(copy["home.access.emptySpeech"]);
          return;
        }
        var labels = Object.fromEntries(
          destinations.map(function (destination) {
            return [destination.key, copy["home.access." + destination.key]];
          }),
        );
        var matches = alternatives.map(function (candidate) {
          return {
            candidate: candidate,
            match: matchDestination(
              candidate.transcript,
              language.value,
              destinations,
              labels,
            ),
          };
        });
        var selected = matches
          .filter(function (entry) {
            return entry.match.kind === "match";
          })
          .sort(function (left, right) {
            return (
              right.match.score - left.match.score ||
              right.candidate.confidence - left.candidate.confidence
            );
          })[0];
        var unresolved = matches
          .filter(function (entry) {
            return entry.match.kind !== "unknown";
          })
          .sort(function (left, right) {
            return right.match.score - left.match.score;
          })[0];
        var match = selected
          ? selected.match
          : unresolved
            ? unresolved.match
            : matches[0].match;
        if (selected) heard = selected.candidate.transcript;
        debug("destination resolution", {
          locale: language.value,
          availableDestinationKeys: destinations.map(function (destination) {
            return destination.key;
          }),
          candidateCount: matches.length,
          outcomes: matches.map(function (entry) {
            return {
              kind: entry.match.kind,
              score: entry.match.score,
              destination: entry.match.destination
                ? entry.match.destination.key
                : null,
            };
          }),
          selectedDestination: selected ? selected.match.destination.key : null,
        });
        transcript.textContent = copy["home.access.heard"].replace(
          "{text}",
          heard,
        );
        if (match.kind === "empty") {
          respondWithStatus(copy["home.access.emptySpeech"]);
          return;
        }
        if (match.kind === "ambiguous") {
          respondWithStatus(copy["home.access.ambiguousDestination"]);
          return;
        }
        if (match.kind !== "match") {
          respondWithStatus(copy["home.access.notRecognized"]);
          return;
        }
        navigateTo(match.destination);
      };
      recognition.onnomatch = function () {
        recognitionHandled = true;
        respondWithStatus(copy["home.access.notRecognized"]);
      };
      recognition.onerror = function (event) {
        recognitionHandled = true;
        globalThis.clearTimeout(recognitionTimer);
        var error = event && event.error;
        debug("recognition error", {
          code: typeof error === "string" ? error : "unknown",
        });
        if (error === "not-allowed" || error === "service-not-allowed") {
          respondWithStatus(copy["home.access.permissionDenied"]);
        } else if (error === "audio-capture") {
          respondWithStatus(copy["home.access.microphoneUnavailable"]);
        } else if (error === "network") {
          respondWithStatus(copy["home.access.recognitionNetwork"]);
        } else if (error === "no-speech") {
          respondWithStatus(copy["home.access.emptySpeech"]);
        } else if (error === "aborted") {
          status.textContent = copy["home.access.stopped"];
        } else {
          respondWithStatus(copy["home.access.failed"]);
        }
      };
      recognition.onend = function () {
        globalThis.clearTimeout(recognitionTimer);
        start.hidden = false;
        stop.hidden = true;
        if (
          !recognitionHandled &&
          status.textContent === copy["home.access.listening"]
        ) {
          respondWithStatus(copy["home.access.emptySpeech"]);
        }
      };
      try {
        recognition.start();
      } catch (error) {
        debug("recognition start error", {
          name: error && error.name ? error.name : "unknown",
        });
        recognitionHandled = true;
        globalThis.clearTimeout(recognitionTimer);
        status.textContent = copy["home.access.failed"];
      }
    });
    stop.addEventListener("click", function () {
      recognitionHandled = true;
      globalThis.clearTimeout(recognitionTimer);
      if (recognition) recognition.stop();
      status.textContent = copy["home.access.stopped"];
    });

    language.value = "en-US";
    setCopy("en");
    launcher.disabled = false;
  }

  fetch(localeUrl.href, { cache: "force-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("home-access");
      return response.json();
    })
    .then(function (localePacks) {
      doc
        .querySelectorAll("[data-dimts-access-guide]")
        .forEach(function (host) {
          mount(host, localePacks);
        });
    })
    .catch(function () {
      // No guide controls are exposed without their localized accessible names.
    });
})();
