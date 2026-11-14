/**
 * Self-serve integration guide served at GET /v1/docs. Rendered on the server
 * with this deployment's own URLs so every snippet can be copied as-is. No
 * inline script, so the API's default Content-Security-Policy still applies.
 */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function renderDocsPage(options: {
  apiBase: string;
  widgetUrl?: string | undefined;
}): string {
  const api = escapeHtml(options.apiBase);
  const widget = escapeHtml(
    options.widgetUrl ?? "https://YOUR-WIDGET-ASSETS-HOST/dimts-widget.js",
  );
  const code = (value: string) => `<pre><code>${value}</code></pre>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dimts integration guide</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#f4f7f8;--surface:#fff;--text:#14232b;--muted:#4a5f69;--primary:#164e63;--accent:#e0f0f3;--border:#d3dee3;--code:#0f1b2d;--code-text:#e8f1f4}
@media (prefers-color-scheme:dark){:root{--bg:#0a141f;--surface:#0f1b2d;--text:#f2f6f7;--muted:#a9bcc4;--primary:#5ed0cb;--accent:#13303a;--border:#25404b;--code:#050b12;--code-text:#e8f1f4}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--primary);color:#fff;padding:2.5rem 1rem 3.5rem}
@media (prefers-color-scheme:dark){header{color:#0f1b2d}}
.wrap{max-inline-size:60rem;margin-inline:auto;padding-inline:1rem}
header h1{margin:0 0 .25rem;font-size:2rem}
header p{margin:0;opacity:.9;max-inline-size:44rem}
nav.cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));margin-block:-2rem 2rem}
nav.cards a{display:block;background:var(--surface);border:1px solid var(--border);border-radius:.9rem;padding:1.1rem 1.2rem;color:inherit;text-decoration:none;box-shadow:0 6px 18px rgb(0 0 0/8%)}
nav.cards a:hover,nav.cards a:focus-visible{border-color:var(--primary)}
nav.cards strong{display:block;font-size:1.1rem;color:var(--primary)}
.tag{display:inline-block;font-size:.75rem;font-weight:700;background:var(--accent);color:var(--primary);border-radius:999px;padding:.1rem .6rem;margin-block-end:.4rem}
section{background:var(--surface);border:1px solid var(--border);border-radius:.9rem;padding:1.5rem;margin-block-end:1.5rem}
section h2{margin-block-start:0;color:var(--primary)}
ol.steps{padding-inline-start:1.25rem}
ol.steps>li{margin-block-end:1.1rem}
ol.steps>li::marker{font-weight:700;color:var(--primary)}
pre{background:var(--code);color:var(--code-text);border-radius:.6rem;padding:1rem;overflow-x:auto;font-size:.875rem;line-height:1.5;margin:.5rem 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
p code,li code,td code{background:var(--accent);padding:.05rem .35rem;border-radius:.3rem;font-size:.9em}
pre code{background:none;padding:0;border-radius:0;font-size:inherit;color:inherit}
header code{background:rgb(255 255 255/18%);color:inherit;padding:.05rem .4rem;border-radius:.3rem}
table{border-collapse:collapse;inline-size:100%;font-size:.95rem}
th,td{border-block-end:1px solid var(--border);text-align:start;padding:.55rem .5rem;vertical-align:top}
th{color:var(--muted);font-weight:600}
.note{border-inline-start:4px solid var(--primary);background:var(--accent);padding:.75rem 1rem;border-radius:.4rem}
a{color:var(--primary)}
footer{color:var(--muted);padding-block:1rem 3rem}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
</style>
</head>
<body>
<header><div class="wrap">
<h1>Dimts integration guide</h1>
<p>Add the multilingual tutor to your learning platform. Pick one path below. Every URL on this page already points at this deployment: <code>${api}</code>.</p>
</div></header>
<main class="wrap">
<nav class="cards" aria-label="Integration paths">
<a href="#embed"><span class="tag">Level 1 · 5 minutes</span><strong>Embed the widget</strong>Paste two lines into any web page.</a>
<a href="#rest"><span class="tag">Level 2 · server or app</span><strong>REST API</strong>Call the tutor from your own interface.</a>
<a href="#lti"><span class="tag">Level 3 · LMS</span><strong>LTI 1.3</strong>Launch from Moodle, Canvas or another LMS.</a>
</nav>

<section aria-labelledby="before">
<h2 id="before">Before you start</h2>
<p>Ask the Dimts operator for a <strong>host key</strong>. A <em>public</em> key identifies your web page (it is not a secret, but it only works from the origins registered with it). A <em>secret</em> key is for server-to-server calls such as job import and insights; never put it in a browser.</p>
<p>Operators create keys with <code>pnpm admin host-key</code> (see <code>docs/DEPLOY.md</code>). Each page origin must also be listed in <code>DIMTS_HOST_ORIGINS</code>.</p>
</section>

<section aria-labelledby="embed">
<h2 id="embed">Level 1: embed the widget</h2>
<ol class="steps">
<li>Send your page origin (for example <code>https://learn.example.org</code>) to the operator and receive a public host key.</li>
<li>Paste this where the tutor should appear:
${code(`&lt;script type="module" src="${widget}"&gt;&lt;/script&gt;
&lt;dimts-assistant
  data-api="${api}/v1"
  data-host-key="YOUR-PUBLIC-HOST-KEY"
&gt;&lt;/dimts-assistant&gt;`)}</li>
<li>Open the page. Learners choose a language and start asking questions. Remote AI is used only when the learner allows it.</li>
</ol>
<p class="note">Optional theming: set CSS custom properties such as <code>--dimts-primary</code> on the element. The widget renders in its own shadow root, so your page styles do not leak in.</p>
</section>

<section aria-labelledby="rest">
<h2 id="rest">Level 2: REST API</h2>
<ol class="steps">
<li><strong>Create a session</strong> (once per learner):
${code(`curl -X POST ${api}/v1/sessions \\
  -H "content-type: application/json" \\
  -H "origin: https://learn.example.org" \\
  -H "x-dimts-key: YOUR-HOST-KEY" \\
  -d '{"lang":"en"}'`)}
Keep the returned <code>sessionId</code> and <code>sessionToken</code>. To allow remote AI for this learner, add <code>"cloudOk":true,"consentVersion":"remote-ai-v1"</code> only after they agree.</li>
<li><strong>Ask a question</strong>:
${code(`curl -X POST ${api}/v1/ask \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer SESSION_TOKEN" \\
  -d '{"sessionId":"SESSION_ID","clientMsgId":"any-unique-id-123",
       "lang":"en","text":"How do I make a study plan?","via":"text"}'`)}</li>
<li><strong>Show the reply</strong>. <code>kind</code> tells you what to render:
<table><thead><tr><th>kind</th><th>Meaning</th><th>What to show</th></tr></thead><tbody>
<tr><td><code>answer</code></td><td>Grounded answer</td><td><code>text</code> plus each item in <code>citations</code> as a link</td></tr>
<tr><td><code>notfound</code></td><td>Not in the course</td><td><code>text</code> and a "Help me now" action</td></tr>
<tr><td><code>escalation</code></td><td>Learner should talk to a person</td><td><code>text</code> and the help action</td></tr>
</tbody></table></li>
</ol>
<table><thead><tr><th>Other calls</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>GET ${api}/v1/languages</code></td><td>Available languages and voice support</td></tr>
<tr><td><code>POST ${api}/v1/feedback</code></td><td>Helpful / not helpful (counts only)</td></tr>
<tr><td><code>POST ${api}/v1/help</code></td><td>Request a human helper</td></tr>
<tr><td><code>POST ${api}/v1/data/delete</code></td><td>Delete this learner's data</td></tr>
<tr><td><code>POST ${api}/v1/jobs/import</code></td><td>Import JobPosting JSON-LD (secret key)</td></tr>
<tr><td><code>GET ${api}/v1/insights</code></td><td>Anonymous counts for teachers (secret key)</td></tr>
</tbody></table>
<p>Errors are <code>application/problem+json</code> with a <code>code</code> (for example <code>unauthorized</code>, <code>rate_limited</code>) and a <code>messageKey</code> you can translate. Questions are limited to 200 per hour per IP address. Full schemas: <a href="/v1/openapi.yaml">OpenAPI (YAML)</a> · <a href="/v1/openapi.json">OpenAPI (JSON)</a>.</p>
</section>

<section aria-labelledby="lti">
<h2 id="lti">Level 3: LTI 1.3</h2>
<ol class="steps">
<li><strong>Register Dimts as a tool in your LMS</strong> with these values:
<table><tbody>
<tr><th scope="row">OIDC login / initiation URL</th><td><code>${api}/v1/lti/login</code></td></tr>
<tr><th scope="row">Redirect URI and target link URI</th><td><code>${api}/v1/lti/launch</code></td></tr>
<tr><th scope="row">Public keyset</th><td>Not needed for launches (no deep linking or grade passback yet)</td></tr>
</tbody></table></li>
<li><strong>Send the platform details to the Dimts operator</strong>, who adds them to <code>DIMTS_LTI_PLATFORMS</code>:
${code(`[{
  "platformId": "my-lms",
  "issuer": "https://lms.example.org",
  "clientId": "CLIENT-ID-FROM-YOUR-LMS",
  "authLoginUrl": "https://lms.example.org/mod/lti/auth.php",
  "authTokenUrl": "https://lms.example.org/mod/lti/token.php",
  "jwksUri": "https://lms.example.org/mod/lti/certs.php",
  "deploymentId": "DEPLOYMENT-ID-FROM-YOUR-LMS"
}]`)}
The operator also sets <code>DIMTS_LTI_WIDGET_URL</code> and <code>DIMTS_LTI_WIDGET_KEY</code> (a public key whose origins include <code>${api}</code>).</li>
<li><strong>Add the tool to a course</strong> and open it. The LMS signs the launch; Dimts verifies the signature, issuer, audience, nonce and deployment, then shows the tutor inside the course. Instructors also get access to anonymous insights.</li>
</ol>
<p class="note">Dimts never receives learner names or emails from the launch; it keeps only an opaque platform user ID for the session.</p>
</section>
</main>
<footer class="wrap">
<a href="/v1/health">Service health</a> · <a href="/v1/openapi.yaml">OpenAPI</a>
</footer>
</body>
</html>`;
}
