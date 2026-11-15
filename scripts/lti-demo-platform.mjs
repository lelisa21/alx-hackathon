// A minimal LTI 1.3 platform (a stand-in for Moodle or Canvas) that performs a
// real, signed launch into the local Dimts API.
//
//   node scripts/lti-demo-platform.mjs
//   open http://localhost:5180/
//
// It implements the platform half of the OIDC third-party-initiated login:
// 1. The course page frames Dimts' /v1/lti/login with iss, login_hint and
//    target_link_uri.
// 2. Dimts redirects the frame to this platform's /auth with state and nonce.
// 3. This platform signs an RS256 id_token with LTI 1.3 claims and posts it
//    to Dimts' /v1/lti/launch, which verifies it against /jwks.
//
// Register the platform with the API (development only; see .env.example):
//   DIMTS_LTI_PLATFORMS=<the JSON printed at start>
//   DIMTS_LTI_WIDGET_URL=http://localhost:5173/dimts-widget.js
//   DIMTS_LTI_WIDGET_KEY=<DIMTS_LOCAL_WIDGET_KEY>
// The launch page is served by Dimts itself, so DIMTS_HOST_ORIGINS needs no
// change.
import { createServer } from "node:http";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const port = Number(process.env.LTI_DEMO_PORT ?? 5180);
const issuer = `http://localhost:${port}`;
const dimts = (process.env.DIMTS_URL ?? "http://localhost:5173").replace(
  /\/$/u,
  "",
);
const clientId = "dimts-demo-client";
const deploymentId = "demo-deployment-1";
const kid = "dimts-demo-key-1";

// Keep one key across restarts so a cached JWKS stays valid.
const keyFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".lti-demo-key.pem",
);
const privateKey = existsSync(keyFile)
  ? createPrivateKey(readFileSync(keyFile))
  : (() => {
      const { privateKey: key } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      writeFileSync(keyFile, key.export({ type: "pkcs8", format: "pem" }), {
        mode: 0o600,
      });
      return key;
    })();
const publicJwk = {
  ...createPrivateKey(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  ).export({ format: "jwk" }),
};
const jwk = {
  kty: publicJwk.kty,
  n: publicJwk.n,
  e: publicJwk.e,
  kid,
  alg: "RS256",
  use: "sig",
};

const b64url = (value) =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");
function signJwt(claims) {
  const head = b64url({ alg: "RS256", typ: "JWT", kid });
  const body = b64url(claims);
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    privateKey,
  ).toString("base64url");
  return `${head}.${body}.${signature}`;
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const ROLES = {
  learner: "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
  instructor: "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
};
const PEOPLE = {
  learner: "Learner (Amara)",
  instructor: "Instructor (Mr. Bekele)",
};

function page(role) {
  const login = new URL(`${dimts}/v1/lti/login`);
  for (const [key, value] of Object.entries({
    iss: issuer,
    login_hint: `${role}-demo-user`,
    target_link_uri: `${dimts}/v1/lti/launch`,
    client_id: clientId,
    lti_deployment_id: deploymentId,
    lti_message_hint: role,
  }))
    login.searchParams.set(key, value);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo LMS · WR 100</title>
<style>
:root{color-scheme:light dark;--bg:#f3f5f7;--card:#fff;--text:#1d2731;--muted:#5b6b78;--brand:#f98012}
@media(prefers-color-scheme:dark){:root{--bg:#11161b;--card:#1a2129;--text:#eef2f5;--muted:#a9b7c2}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
header{background:var(--brand);color:#1d1100;padding:.75rem 1rem;font-weight:800}
main{max-inline-size:72rem;margin:1rem auto;padding:0 1rem;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,26rem);gap:1rem}
section{background:var(--card);border-radius:12px;padding:1rem 1.25rem}
nav a{display:inline-flex;min-block-size:44px;align-items:center;margin-inline-end:1rem;font-weight:700;color:inherit}
nav a[aria-current]{text-decoration:underline 3px var(--brand)}
iframe{inline-size:100%;block-size:min(46rem,80vh);border:1px solid #ccd4da;border-radius:12px;background:#fff}
p.muted{color:var(--muted)}
@media(max-width:56rem){main{grid-template-columns:minmax(0,1fr)}}
</style></head><body>
<header>Demo LMS · stand-in for Moodle or Canvas</header>
<main>
<section>
<h1>WR 100: Fundamentals of Effective Communication</h1>
<nav aria-label="Launch as"><a href="/?role=learner"${role === "learner" ? ' aria-current="page"' : ""}>View as learner</a><a href="/?role=instructor"${role === "instructor" ? ' aria-current="page"' : ""}>View as instructor</a></nav>
<p>Signed in as <strong>${escape(PEOPLE[role])}</strong>. The Dimts activity on the right is an LTI 1.3 tool launch: this platform signs an id_token, and Dimts verifies the signature, issuer, audience, nonce and deployment before it shows the tutor.</p>
<p class="muted">Week 10: Verifying AI-generated content. Ask Dimts about this course in English, Amharic or Afaan Oromoo.</p>
</section>
<section aria-label="Dimts activity">
<iframe title="Dimts course assistant" src="${escape(login.href)}" allow="microphone"></iframe>
</section>
</main></body></html>`;
}

function authResponse(url) {
  const q = url.searchParams;
  const required = [
    "client_id",
    "redirect_uri",
    "state",
    "nonce",
    "login_hint",
  ];
  if (required.some((key) => !q.get(key)) || q.get("client_id") !== clientId)
    return { status: 400, body: "Invalid authentication request." };
  const redirect = new URL(q.get("redirect_uri"));
  if (`${redirect.origin}${redirect.pathname}` !== `${dimts}/v1/lti/launch`)
    return { status: 400, body: "Unregistered redirect_uri." };
  const role =
    q.get("lti_message_hint") === "instructor" ? "instructor" : "learner";
  const now = Math.floor(Date.now() / 1000);
  const idToken = signJwt({
    iss: issuer,
    aud: clientId,
    sub: q.get("login_hint"),
    iat: now,
    exp: now + 240,
    nonce: q.get("nonce"),
    "https://purl.imsglobal.org/spec/lti/claim/message_type":
      "LtiResourceLinkRequest",
    "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": deploymentId,
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": `${dimts}/v1/lti/launch`,
    "https://purl.imsglobal.org/spec/lti/claim/resource_link": {
      id: "wr100-week10-dimts",
      title: "Ask Dimts",
    },
    "https://purl.imsglobal.org/spec/lti/claim/roles": [ROLES[role]],
    "https://purl.imsglobal.org/spec/lti/claim/context": {
      id: "wr100-f26",
      label: "WR 100",
      title: "Fundamentals of Effective Communication",
    },
    "https://purl.imsglobal.org/spec/lti/claim/launch_presentation": {
      document_target: "iframe",
      locale: "en",
    },
  });
  return {
    status: 200,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Launching Dimts…</title></head>
<body onload="document.forms[0].submit()"><form method="post" action="${escape(redirect.href)}">
<input type="hidden" name="id_token" value="${escape(idToken)}"><input type="hidden" name="state" value="${escape(q.get("state"))}">
<noscript><button type="submit">Continue to Dimts</button></noscript></form></body></html>`,
  };
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", issuer);
  const send = (status, type, body) => {
    response.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
    });
    response.end(body);
  };
  if (url.pathname === "/jwks")
    return send(200, "application/json", JSON.stringify({ keys: [jwk] }));
  if (url.pathname === "/auth") {
    const result = authResponse(url);
    return send(result.status, "text/html; charset=utf-8", result.body);
  }
  if (url.pathname === "/token")
    return send(400, "application/json", '{"error":"unsupported_grant_type"}');
  if (url.pathname === "/") {
    const role =
      url.searchParams.get("role") === "instructor" ? "instructor" : "learner";
    return send(200, "text/html; charset=utf-8", page(role));
  }
  send(404, "text/plain", "Not found");
}).listen(port, () => {
  const registration = [
    {
      platformId: "demo-lms",
      issuer,
      clientId,
      authLoginUrl: `${issuer}/auth`,
      authTokenUrl: `${issuer}/token`,
      // The API runs in Docker; it reaches this host through host.docker.internal.
      jwksUri:
        process.env.LTI_DEMO_JWKS_URL ??
        `http://host.docker.internal:${port}/jwks`,
      deploymentId,
    },
  ];
  process.stdout.write(
    `Demo LMS on ${issuer}/  (launches into ${dimts})\n` +
      "Register it with the API (development only):\n" +
      `DIMTS_LTI_PLATFORMS=${JSON.stringify(registration)}\n`,
  );
});
