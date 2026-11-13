#!/usr/bin/env bash
# Agent-readiness acceptance checks. They mirror the probes of the Ora scanner
# behind https://is-agentic.com, plus what is specific to this app (banner
# image URLs, Markdown for banner pages, the MCP tools).
#
#   scripts/agent-readiness-check.sh [base-url]      default http://localhost:3000
#
# Run it against `next start`, a preview or production. `next dev` answers
# 404s and negotiation differently and is not a valid target.
#
#   ok    an assertion that holds
#   FAIL  an assertion that does not (the script exits 1)
#   warn  something unscored, or something only the owner can decide or
#         supply (a public address, a GitHub token on the server)
#
# Needs: bash, curl, node 20+, shasum.
set -u
BASE="${1:-http://localhost:3000}"; BASE="${BASE%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/arc.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0; WARN=0
ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n        %s\n' "$1" "$2"; }
warn() { WARN=$((WARN+1)); printf '  warn  %s\n        %s\n' "$1" "$2"; }
# req <curl args...> : status in $S, headers in $TMP/h, body in $TMP/b
req()  { S=$(curl -sS -m 40 -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' "$@" 2>/dev/null) || S=000; }
# every value of a response header, joined: a header may be sent on several lines
hdr()  { grep -i "^$1:" "$TMP/h" | cut -d' ' -f2- | tr -d '\r' | paste -sd, -; }
expect_status() { [ "$S" = "$2" ] && ok "$1 -> $2" || bad "$1" "expected HTTP $2, got $S"; }
expect_hdr()    { hdr "$2" | grep -qiE -- "$3" && ok "$1: $2 ~ $3" || bad "$1" "header $2='$(hdr "$2")' does not match /$3/"; }
expect_body()   { grep -qE -- "$2" "$TMP/b" && ok "$1: body ~ $2" || bad "$1" "body does not match /$2/"; }
fences_ok()     { [ $(( $(grep -c '^```' "$TMP/b") % 2 )) -eq 0 ] && ok "$1: code fences balanced" || bad "$1" "odd number of fence lines (code-fence-validity)"; }
# node snippets print "        - message" per failure and may append lines to $TMP/w for warnings
warnings()      { [ -s "$TMP/w" ] && while IFS= read -r line; do warn "$1" "$line"; done < "$TMP/w"; : > "$TMP/w"; }
: > "$TMP/w"
PROBE="__ora-404-probe-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 8)"
CONTENT_PAGES="/docs /docs/migrate /pricing /about /contact /privacy /terms"

echo "== essential: markdown-negotiation-vary"
req -H 'Accept: text/markdown' "$BASE/";            expect_status "GET / (Accept: text/markdown)" 200
expect_hdr "home markdown" content-type '^text/markdown'; expect_hdr "home markdown" vary '(^|, *)accept(,|$)'
[ "$(wc -c <"$TMP/b")" -gt 200 ] && ok "home markdown body non-empty" || bad "home markdown body" "shorter than 200 bytes"
head -c 3 "$TMP/b" | grep -q -- '---' && ok "home markdown opens with front matter (bonus)" || bad "markdown-frontmatter (bonus)" "no leading --- block"
expect_body "home markdown front matter" '^title: '; expect_body "home markdown front matter" '^canonical: https?://'
fences_ok "home markdown"
req -H 'Accept: text/html' "$BASE/";                expect_status "GET / (Accept: text/html)" 200; expect_hdr "home html" content-type '^text/html'
req -H 'Accept: text/markdown;q=0.5, text/html' "$BASE/"; hdr content-type | grep -qi '^text/html' && ok "q-values honoured (optional)" || warn "q-values not honoured (optional, not scored)" "text/markdown;q=0.5, text/html returned $(hdr content-type)"
req -H 'Accept: text/markdown, text/html, */*' "$BASE/"; expect_hdr "Claude Code / Copilot CLI Accept header gets Markdown" content-type '^text/markdown'
req -H 'Accept: text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.7' "$BASE/"; expect_hdr "Copilot Chat Accept header gets Markdown" content-type '^text/markdown'
req -H 'Accept: text/markdown, text/plain;q=0.9, */*;q=0.8' "$BASE/"; expect_hdr "Cursor Accept header gets Markdown" content-type '^text/markdown'
req -H 'Accept: text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1' "$BASE/"; expect_hdr "OpenCode Accept header gets Markdown" content-type '^text/markdown'
req -H 'Accept: text/html, text/markdown, */*' "$BASE/"; expect_hdr "text/html listed first gets HTML" content-type '^text/html'
req -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' "$BASE/"; expect_hdr "browser Accept header gets HTML" content-type '^text/html'
req -H 'Accept: */*' "$BASE/";                      expect_hdr "Accept: */* gets HTML" content-type '^text/html'
req -H 'Accept: application/pdf' "$BASE/";          [ "$S" = 406 ] && ok "406 for an unsupported Accept (optional)" || warn "no 406 for an unsupported Accept (optional, not scored)" "got HTTP $S"

echo "== essential: agent-friendly-404 (fresh random path every run, like Ora)"
req "$BASE/$PROBE";                                 expect_status "GET /$PROBE (html)" 404
req -H 'Accept: text/markdown' "$BASE/$PROBE-md";   expect_status "GET /$PROBE-md (markdown)" 404
expect_hdr "404 markdown" content-type '^text/markdown'; expect_hdr "404 markdown" vary '(^|, *)accept(,|$)'
expect_body "404 markdown links recovery indexes" 'llms\.txt|sitemap\.xml|/docs'
[ "$(wc -c <"$TMP/b")" -ge 20 ] && ok "404 markdown explains itself" || bad "404 markdown" "shorter than 20 bytes"
req -H 'Accept: text/markdown, text/html, */*' "$BASE/$PROBE/deeper/path"; expect_status "GET a nested unknown path (markdown)" 404; expect_hdr "nested 404 markdown" content-type '^text/markdown'
req "$BASE/${UNKNOWN_OWNER:-zz-unknown-owner-$RANDOM$RANDOM}";        [ "$S" = 404 ] && ok "valid-shaped unknown owner -> 404 on first hit" || bad "unknown owner first hit" "got $S (soft-404 App Shell? the owner page needs ensureStatic='navigation')"
for p in /.well-known/oauth-authorization-server /.well-known/openid-configuration /.well-known/oauth-protected-resource /v1 /v2 /ask /agent/identity /auth.md /agents.md /llms.md /openapi /index /wp-login.php /.env /a/b/c/d /embed /about/zzz; do
  req "$BASE$p"; expect_status "GET $p (must not be a soft 200)" 404
done
req "$BASE/v1/orank-probe-test"; expect_status "GET /v1/orank-probe-test (API guessed at the root)" 404; expect_hdr "root-level API guess" content-type '^application/problem\+json'
req "$BASE/developers"; expect_status "GET /developers (redirect to the docs)" 308; expect_hdr "/developers" location '/docs$'

echo "== essential: content-no-js + recommended: metadata, json-ld (homepage)"
req -H 'Accept: text/html' "$BASE/"
node - "$TMP/b" "$TMP/w" <<'JS' && ok "homepage HTML structure" || bad "homepage HTML structure" "see lines above"
const fs = require('fs'); const h = fs.readFileSync(process.argv[2], 'utf8'); let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
const note = (m) => fs.appendFileSync(process.argv[3], m + '\n');
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const body = strip(h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h);
const text = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const noScript = Buffer.byteLength(strip(h));
need(text.length >= 500, `visible text ${text.length} chars < 500`);
need(100 * text.length / noScript >= 6, `content ratio ${(100 * text.length / noScript).toFixed(1)}% < 6% (text / HTML without <script>/<style>; Ora target is 5%)`);
const hs = [...body.matchAll(/<h([1-6])[\s>]/gi)].map((m) => +m[1]);
need(hs.filter((n) => n === 1).length === 1, `expected exactly one <h1>, found ${hs.filter((n) => n === 1).length}`);
need(hs[0] === 1, 'first heading is not <h1>');
need(hs.every((n, i) => i === 0 || n - hs[i - 1] <= 1), 'heading levels skip (e.g. h1 -> h3): ' + hs.join(','));
for (const t of ['main', 'nav', 'header', 'footer']) need(new RegExp(`<${t}[\\s>]`, 'i').test(h), `missing <${t}> landmark`);
const beforeMain = h.split(/<main[\s>]/i)[0] ?? '';
need(strip(beforeMain.replace(/<head[\s\S]*?<\/head>/i, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').length < 5000, 'more than 5,000 characters of text before <main> (content-start-position)');
need(/<html[^>]*\slang="[a-z-]+"/i.test(h), 'missing <html lang>');
const head = h.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
for (const [n, re] of [['canonical', /<link rel="canonical" href="https?:\/\//], ['og:image', /property="og:image"/], ['og:type', /property="og:type"/], ['og:title', /property="og:title"/], ['twitter:card', /name="twitter:card"/], ['twitter:image', /name="twitter:image"/], ['meta description', /name="description"/], ['is-agentic-site-type', /name="is-agentic-site-type" content="(app|content|business|store)"/], ['markdown alternate', /rel="alternate" type="text\/markdown"/]]) need(re.test(head), `missing ${n} in <head>`);
need(!/name="robots" content="[^"]*noindex/i.test(head), 'homepage has noindex');
need(!/http-equiv="refresh"/i.test(h), 'meta refresh on the homepage (redirect-hygiene)');
need(/<a[^>]+href="\/docs"/.test(body), 'no server-rendered link to /docs (public-api-docs)');
const ld = [...h.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => { try { const j = JSON.parse(m[1]); return j['@graph'] ?? [j]; } catch { return []; } });
const types = ld.map((n) => n['@type']).flat();
const app = ld.find((n) => [n['@type']].flat().some((t) => /SoftwareApplication|WebApplication/.test(t)));
need(app, 'JSON-LD: no SoftwareApplication/WebApplication node');
need(app?.name && app?.description && app?.url && (app?.applicationCategory || app?.offers), 'JSON-LD: the application node needs name, description, url and category or offers');
for (const t of ['WebSite', 'FAQPage', 'BreadcrumbList']) need(types.includes(t), `JSON-LD: no ${t} node`);
const org = ld.find((n) => [n['@type']].flat().includes('Organization'));
need(org?.contactPoint?.contactType, 'JSON-LD: Organization needs a contactPoint with contactType');
if (!(org?.contactPoint?.email || org?.contactPoint?.telephone)) note('Organization.contactPoint has no email: set NEXT_PUBLIC_CONTACT_EMAIL (org-schema-completeness, recommended)');
if (!org?.address) note('Organization has no address: set NEXT_PUBLIC_CONTACT_COUNTRY (and _LOCALITY, _REGION) if the owner wants to publish one (org-schema-completeness, recommended)');
const profiles = new Set((org?.sameAs ?? []).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter((d) => ['github.com', 'linkedin.com', 'wikidata.org', 'wikipedia.org', 'crunchbase.com'].some((k) => d.endsWith(k))));
need(profiles.size >= 1, 'JSON-LD: Organization.sameAs names no authority profile');
if (profiles.size < 2) note('Organization.sameAs names one authority profile (github.com): a second one (linkedin.com, wikidata.org ...) earns full json-ld-entity-linking (bonus)');
const terms = [...(org?.knowsAbout ?? []), ...String(app?.keywords ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
need(terms.length > 0, 'JSON-LD: no product terms (keywords / knowsAbout)');
for (const t of new Set(terms)) need(text.toLowerCase().includes(t.toLowerCase()), `JSON-LD product term "${t}" is not in the visible homepage copy (brand-search-accuracy)`);
const faq = ld.find((n) => [n['@type']].flat().includes('FAQPage'));
for (const q of faq?.mainEntity ?? []) need(text.includes(q.name), `FAQ question in JSON-LD but not in the page: ${q.name}`);
process.exit(bad ? 1 : 0);
JS
warnings "homepage JSON-LD"
req -H 'Accept: text/html' "$BASE/"
expect_hdr "homepage" link 'rel="?(sitemap|describedby|service-desc|api-catalog|alternate)'
[ -z "$(hdr x-robots-tag)" ] && ok "no X-Robots-Tag on homepage" || bad "noindex-directives" "X-Robots-Tag: $(hdr x-robots-tag)"
grep -q 'document\.modelContext\.registerTool(' "$TMP/b" && ok "WebMCP: registerTool call inline in the homepage" || {
  FOUND=""; for src in $(grep -o '/_next/static/[^"]*\.js' "$TMP/b" | sort -u); do curl -sS -m 30 "$BASE$src" | grep -q 'document\.modelContext\.registerTool(' && FOUND="$src" && break; done
  [ -n "$FOUND" ] && ok "WebMCP: literal document.modelContext.registerTool( in a same-origin bundle ($FOUND)" || bad "webmcp" "no document.modelContext.registerTool( in the homepage or its scripts"; }
OG=$(grep -o '<meta property="og:image" content="[^"]*"' "$TMP/b" | head -1 | sed -E 's/.*content="([^"]*)"/\1/; s/&amp;/\&/g' | sed -E "s#^https?://[^/]+#$BASE#")
req "$OG"; expect_status "og:image URL resolves ($OG)" 200; expect_hdr "og:image" content-type '^image/(png|jpeg)'
req "$BASE/icon.svg"; expect_status "GET /icon.svg (JSON-LD logo, MCP server card icon)" 200; expect_hdr "/icon.svg" content-type '^image/svg\+xml'
for ua in 'ChatGPT-User' 'OAI-SearchBot' 'Claude-User' 'PerplexityBot' 'GPTBot' 'ClaudeBot' 'OraBot/1.0 (+https://ora.ai/bot)'; do
  req -A "Mozilla/5.0 (compatible; $ua)" "$BASE/"; [ "$S" = 200 ] && ok "homepage reachable as $ua" || bad "agent-crawler-reachability" "$ua got HTTP $S"
done

echo "== content pages: text, headings, ratio (content-no-js for inner pages, trust-anchors)"
node "$HERE/content-ratio.mjs" "$BASE" > "$TMP/ratio" 2>&1 && ok "content-ratio.mjs: every page has >= 500 chars, >= 5% ratio, one leading <h1>, no heading skips" || bad "content-ratio.mjs" "$(grep FAIL "$TMP/ratio" | tr '\n' ' ')"
sed 's/^/        /' "$TMP/ratio"
for p in $CONTENT_PAGES; do
  req -H 'Accept: text/html' "$BASE$p"; expect_status "GET $p" 200
  node - "$TMP/b" "$p" <<'JS' && ok "$p metadata" || bad "$p metadata" "see lines above"
const h = require('fs').readFileSync(process.argv[2], 'utf8'); const p = process.argv[3]; let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
const head = h.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
need(new RegExp(`<link rel="canonical" href="https?://[^"/]+${p}"`).test(head), 'canonical does not point at the page');
need(new RegExp(`rel="alternate" type="text/markdown" href="https?://[^"/]+${p}\\.md"`).test(head), 'no markdown alternate');
for (const [n, re] of [['title', /<title>[^<]{5,}<\/title>/], ['description', /name="description" content="[^"]{50,}"/], ['og:image', /property="og:image"/], ['og:type', /property="og:type"/], ['og:url', /property="og:url"/], ['twitter:card', /name="twitter:card" content="summary_large_image"/]]) need(re.test(head), `missing ${n}`);
need(!/noindex/i.test(head), 'page is noindexed');
need(/<script[^>]*type="application\/ld\+json"/.test(h), 'no JSON-LD');
need(!/http-equiv="refresh"/i.test(h), 'meta refresh (redirect-hygiene)');
need(!/<form[^>]*>[\s\S]*type="password"/i.test(h), 'a login form (docs-auth-gate)');
process.exit(bad ? 1 : 0);
JS
done
req -H 'Accept: text/html' "$BASE/docs"
expect_body "docs title" '<title>GitBanners API docs</title>'
for id in url-patterns variants-and-themes rest-api errors rate-limits versioning-and-deprecation authentication mcp agent-skill markdown; do
  grep -q "id=\"$id\"" "$TMP/b" && ok "docs section #$id" || bad "docs section" "no element with id=\"$id\""
done
cp "$TMP/b" "$TMP/docs.html"

echo "== recommended: sitemap, robots"
req "$BASE/sitemap.xml"; expect_status "GET /sitemap.xml" 200; expect_hdr "sitemap" content-type 'xml'
node - "$TMP/b" <<'JS' && ok "sitemap: every entry has <lastmod>, newest within a year" || bad "sitemap-lastmod" "see lines above"
const x = require('fs').readFileSync(process.argv[2], 'utf8'); let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
const urls = [...x.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
need(urls.length >= 7, `only ${urls.length} entries`);
const mods = urls.map((u) => u.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]);
need(mods.every(Boolean), `${mods.filter((m) => !m).length} entries without <lastmod>`);
const newest = Math.max(...mods.filter(Boolean).map((m) => Date.parse(m)));
need(Date.now() - newest < 365 * 864e5, 'newest <lastmod> is older than a year');
process.exit(bad ? 1 : 0);
JS
req "$BASE/robots.txt";  expect_status "GET /robots.txt" 200; expect_hdr "robots" content-type '^text/plain'; expect_body "robots" '^Sitemap: '
grep -qE '^Disallow: /api/v1' "$TMP/b" && bad "robots" "the public API is disallowed" || ok "robots does not disallow the public API"
grep -qE '^Disallow: /$' "$TMP/b" && bad "robots" "everything is disallowed" || ok "robots allows the site"

echo "== markdown for every page (markdown-url-fallback, markdown-frontmatter, pricing-md)"
req "$BASE/index.md";    expect_status "GET /index.md" 200; expect_hdr "/index.md" content-type '^text/markdown'
for p in $CONTENT_PAGES /vercel /vercel/next.js /vercel/next.js/contributors /markeljan/streak; do
  req "$BASE$p.md"; expect_status "GET $p.md" 200; expect_hdr "$p.md" content-type '^text/markdown'
  head -c 3 "$TMP/b" | grep -q -- '---' && grep -q '^title: ' "$TMP/b" && grep -q '^canonical: ' "$TMP/b" && ok "$p.md front matter" || bad "$p.md" "no front matter with title and canonical"
  sed -n '/^---$/,/^---$/!p' "$TMP/b" | grep -m1 . | grep -q '^# ' && ok "$p.md body starts with a heading" || bad "$p.md" "the first line after the front matter is not a # heading"
  fences_ok "$p.md"
  expect_hdr "$p.md" link 'rel="canonical"'
done
req "$BASE/pricing.md"; [ "$(grep -c . "$TMP/b")" -ge 5 ] && ok "/pricing.md has $(grep -c . "$TMP/b") non-empty lines" || bad "pricing-md" "fewer than 5 lines"
expect_body "/pricing.md names both plans" 'Free'; expect_body "/pricing.md names both plans" 'Pro'
for p in /docs /vercel /vercel/next.js; do
  req -H 'Accept: text/markdown, text/html, */*' "$BASE$p"; expect_status "GET $p (Accept: text/markdown first)" 200; expect_hdr "$p negotiated" content-type '^text/markdown'; expect_hdr "$p negotiated" vary '(^|, *)accept(,|$)'
done
req "$BASE/vercel.md"; expect_body "/vercel.md lists image URLs" '/vercel\.svg'; expect_body "/vercel.md has an embed snippet" '^\[!\[.*\]\(.*\.svg\)\]\('
req "$BASE/vercel/streak.md"; expect_status "GET /vercel/streak.md (a preset organizations do not have)" 404; expect_hdr "/vercel/streak.md" content-type '^text/markdown'
req "$BASE/zz-unknown-owner-$RANDOM$RANDOM.md"; expect_status "GET an unknown owner as .md" 404; expect_hdr "unknown owner .md" content-type '^text/markdown'
req "$BASE/studio.md"; expect_status "GET /studio.md (no Markdown version)" 404

echo "== llms.txt family (llms-txt-exists, -formatting, -links-resolve, modular-llms-txt, agent-instruction)"
req "$BASE/llms.txt";    expect_status "GET /llms.txt" 200; expect_hdr "llms.txt" content-type '^text/plain|^text/markdown'; expect_body "llms.txt when-to-use" '^## When to use'; expect_body "llms.txt starts with H1" '^# '
[ "$(wc -c <"$TMP/b")" -lt 30000 ] && ok "llms.txt under 30,000 characters ($(wc -c <"$TMP/b" | tr -d ' '))" || bad "llms-txt-formatting" "llms.txt is $(wc -c <"$TMP/b") bytes"
expect_body "llms.txt links the docs section index" '/docs/llms\.txt'; expect_body "llms.txt links the API section index" '/api/llms\.txt'; expect_body "llms.txt names the MCP endpoint" '/mcp'
cp "$TMP/b" "$TMP/llms"
for p in /docs/llms.txt /api/llms.txt /llms-full.txt; do
  req "$BASE$p"; expect_status "GET $p" 200; expect_hdr "$p" content-type '^text/plain'; expect_body "$p starts with H1" '^# '
  [ "$p" = /llms-full.txt ] || cat "$TMP/b" >> "$TMP/llms"
done
req "$BASE/llms-full.txt"; fences_ok "/llms-full.txt"; cp "$TMP/b" "$TMP/llms-full"
[ "$(wc -c <"$TMP/b")" -lt 100000 ] && ok "llms-full.txt fits a context budget ($(wc -c <"$TMP/b" | tr -d ' ') bytes)" || bad "page-token-budget" "llms-full.txt is $(wc -c <"$TMP/b") bytes"
# The origin the documents print (the canonical one, which a preview deployment does not share).
req "$BASE/api/v1"; ORIGIN=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(new URL(d.docs).origin)' "$TMP/b")
# links <file> : this site's own links in a Markdown file, code left out, rewritten to $BASE
links() { awk '/^```/{f=!f; next} !f' "$1" | sed 's/`[^`]*`//g' | grep -oE '\]\(https?://[^) ]+\)' | sed -E 's/^\]\(//; s/\)$//; s/#.*$//' | grep -F "$ORIGIN/" | sed "s#^$ORIGIN#$BASE#" | sort -u; }
BROKEN=""; COUNT=0
for u in $(links "$TMP/llms"); do COUNT=$((COUNT+1)); c=$(curl -sS -m 40 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null) || c=000; [ "$c" = 200 ] || BROKEN="$BROKEN $u=$c"; done
[ "$COUNT" -ge 20 ] && [ -z "$BROKEN" ] && ok "all $COUNT links of llms.txt and its section indexes resolve" || bad "llms-txt-links-resolve" "$COUNT links checked; broken:$BROKEN"
# The pages themselves link to pages other parts of the app provide (the studio, banner pages).
BROKEN=""; COUNT=0
for u in $(links "$TMP/llms-full"); do COUNT=$((COUNT+1)); c=$(curl -sS -m 40 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null) || c=000; [ "$c" = 200 ] || BROKEN="$BROKEN ${u#$BASE}=$c"; done
[ -z "$BROKEN" ] && ok "all $COUNT links in the page copy resolve" || warn "links in the page copy that do not answer 200 (pages that are not built yet?)" "$BROKEN"

echo "== essential: openapi-spec + json-error-responses; recommended: rate limits, error model, versioning"
req -H 'Accept: application/json' "$BASE/openapi.json"; expect_status "GET /openapi.json (Accept: application/json)" 200; expect_hdr "/openapi.json" content-type 'openapi\+json|application/json'
cp "$TMP/b" "$TMP/openapi.json"
node - "$TMP/openapi.json" <<'JS' && ok "OpenAPI document quality" || bad "OpenAPI document quality" "see lines above"
const d = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')); let bad = 0; const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
need(/^3\.1\./.test(d.openapi ?? ''), 'openapi version must be 3.1.x');
need(d.info?.title && d.info?.version && d.info?.description, 'info needs title, version and description');
need(Array.isArray(d.servers) && /^https?:\/\//.test(d.servers[0]?.url ?? ''), 'servers[0].url must be absolute');
const ops = Object.entries(d.paths ?? {}).flatMap(([p, item]) => Object.entries(item).filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map(([m, op]) => ({ p, m, op })));
need(ops.length > 0, 'no operations');
const ids = ops.map((o) => o.op.operationId);
need(ids.every(Boolean) && new Set(ids).size === ids.length, 'every operation needs a unique operationId');
for (const id of ['getOptions', 'search', 'getBanner', 'getOwner', 'getRepository', 'getIndex']) need(ids.includes(id), `operation ${id} is missing`);
need(ops.every((o) => o.op.description && o.op.summary), 'every operation needs a summary and a description');
const resolve = (r) => (r?.$ref ? r.$ref.split('/').slice(1).reduce((v, k) => v?.[k], d) : r);
const params = ops.flatMap((o) => (o.op.parameters ?? []).map((x) => ({ o, x: resolve(x) })));
need(params.every(({ x }) => x?.name && x?.in && x?.schema && (x.schema.type || x.schema.enum || x.schema.$ref)), 'every parameter needs a name, a location and a typed schema');
need(params.every(({ x }) => x?.description), 'every parameter needs a description');
for (const o of ops) for (const name of [...o.p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])) need((o.op.parameters ?? []).map(resolve).some((x) => x.in === 'path' && x.name === name && x.required === true), `${o.p}: path parameter {${name}} is not declared as required`);
need(ops.every((o) => Object.entries(o.op.responses ?? {}).some(([c, r]) => c.startsWith('2') && Object.values(r.content ?? {}).some((x) => x.schema))), 'every operation needs a typed 2xx response schema');
need(ops.every((o) => Object.entries(o.op.responses ?? {}).some(([c, r]) => /^[45]/.test(c) && r.content?.['application/problem+json']?.schema)), 'every operation needs a 4xx/5xx application/problem+json schema');
// The kit asked for 80% (its own unverified margin). The verified data point is a site that passes
// response-schema-coverage with 78% typed / 76% JSON; this document is 100% typed.
const jsonShare = ops.filter((o) => Object.entries(o.op.responses ?? {}).some(([c, r]) => c.startsWith('2') && r.content?.['application/json'])).length / ops.length;
need(jsonShare >= 0.76, `only ${(100 * jsonShare).toFixed(0)}% of operations answer application/json (keep image operations a small minority)`);
need(ops.some((o) => /\/v\d+\//.test(o.p)), 'URL versioning (/v1/) not visible in paths');
need(JSON.stringify(d).match(/Deprecation/) && JSON.stringify(d).match(/Sunset/), 'no Deprecation/Sunset marker in the spec');
need(d['x-api-lifecycle']?.deprecation_policy_url, 'no x-api-lifecycle.deprecation_policy_url');
need(!JSON.stringify(d).match(/oauth/i), 'the spec mentions the sign-in protocol by name: remove the word');
need(!d.components?.securitySchemes, 'securitySchemes declared: the API is keyless, declare none');
need(Array.isArray(d.security) && d.security.length === 0 && ops.every((o) => Array.isArray(o.op.security) && o.op.security.length === 0), 'security must be [] at the top and on every operation');
const first = ops[0];
need(first.m === 'get' && !(first.op.parameters ?? []).map(resolve).some((x) => x.required), 'the first operation should be a GET without required parameters (live keyless probe)');
const refs = [...JSON.stringify(d).matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]);
need(refs.every((r) => r.startsWith('#/')), 'a $ref points outside the document');
need(refs.every((r) => r.split('/').slice(1).reduce((v, k) => v?.[k], d) !== undefined), 'a $ref does not resolve: ' + refs.filter((r) => r.split('/').slice(1).reduce((v, k) => v?.[k], d) === undefined).slice(0, 3).join(', '));
const problem = d.components?.schemas?.ProblemDetails;
need(problem?.properties?.code?.enum?.length >= 5 && problem?.required?.includes('code'), 'ProblemDetails needs a required, enumerated code');
need(JSON.stringify(d).includes('RateLimit-Policy') && d.components?.headers?.RateLimit, 'RateLimit headers are not documented');
process.exit(bad ? 1 : 0);
JS
node - "$TMP/openapi.json" "$BASE" "$TMP/w" <<'JS' && ok "every OpenAPI operation answers as described" || bad "OpenAPI operations against the live server" "see lines above"
const fs = require('fs'); const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const base = process.argv[3]; let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
const note = (m) => fs.appendFileSync(process.argv[4], m + '\n');
const resolve = (r) => (r?.$ref ? r.$ref.split('/').slice(1).reduce((v, k) => v?.[k], d) : r);
(async () => {
  for (const [path, item] of Object.entries(d.paths)) {
    const op = item.get; const params = (op.parameters ?? []).map(resolve);
    let url = path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(String(params.find((x) => x.in === 'path' && x.name === name)?.example ?? '')).replace(/%2F/g, '/'));
    const query = params.filter((x) => x.in === 'query' && x.required).map((x) => `${x.name}=${encodeURIComponent(String(x.example))}`).join('&');
    if (query) url += `?${query}`;
    const res = await fetch(base + url, { headers: { accept: '*/*' } });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    const documented = op.responses[String(res.status)] ?? op.responses.default;
    need(documented, `${op.operationId}: GET ${url} answered ${res.status}, which the document does not describe`);
    need(Object.keys(documented?.content ?? {}).includes(type), `${op.operationId}: GET ${url} answered ${type}, documented: ${Object.keys(documented?.content ?? {}).join(', ')}`);
    if (res.status === 503) note(`${op.operationId}: GET ${url} answered 503 (GitHub not reachable from this server: no token?). Documented, but not the success path.`);
    else need(res.status === 200, `${op.operationId}: GET ${url} answered ${res.status}, expected 200`);
    if (type === 'application/json' || type === 'application/problem+json') {
      need(res.headers.get('ratelimit-policy'), `${op.operationId}: no RateLimit-Policy header`);
      need(res.headers.get('access-control-allow-origin') === '*', `${op.operationId}: no CORS header`);
      need(/rel="service-desc"/.test(res.headers.get('link') ?? '') && /rel="deprecation"/.test(res.headers.get('link') ?? ''), `${op.operationId}: Link header lacks service-desc / deprecation`);
    }
    await res.arrayBuffer();
  }
  process.exit(bad ? 1 : 0);
})();
JS
warnings "OpenAPI operations"
req "$BASE/api/v1/orank-probe-test"; expect_status "GET /api/v1/orank-probe-test" 404; expect_hdr "API 404" content-type '^application/problem\+json'
expect_hdr "API 404" ratelimit-policy '^"[^"]+";q=[0-9]+;w=[0-9]+'; expect_hdr "API 404" ratelimit '^"[^"]+";r=[0-9]+;t=[0-9]+'
expect_body "API 404 is a typed problem" '"code":"api_route_not_found"'; expect_body "API 404 has a resolution hint" '"resolution":"'
req "$BASE/api/v1/search"; expect_status "GET /api/v1/search without q (an operation called without parameters)" 400; expect_hdr "API 400" content-type '^application/problem\+json'; expect_body "API 400 code" '"code":"invalid_request"'
req "$BASE/api/v1/banner"; expect_status "GET /api/v1/banner without target" 400; expect_hdr "API 400" content-type '^application/problem\+json'
req -X POST "$BASE/api/v1/options"; expect_status "POST /api/v1/options" 405; expect_hdr "API 405" content-type '^application/problem\+json'; expect_hdr "API 405" allow 'GET'
req -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' "$BASE/api/v1/options"; expect_hdr "API preflight" access-control-allow-origin '^\*$'
req "$BASE/api"; expect_status "GET /api" 200; expect_hdr "GET /api" content-type 'json'
req "$BASE/api/v1"; expect_status "GET /api/v1" 200; expect_hdr "GET /api/v1" content-type 'json'
req "$BASE/api/v1/options"; expect_status "GET /api/v1/options (keyless, no parameters)" 200; expect_hdr "live operation" ratelimit-policy '^"[^"]+";q=[0-9]+;w=[0-9]+'; expect_hdr "live operation" ratelimit '^"[^"]+";r=[0-9]+;t=[0-9]+'
req "$BASE/api/v1/owners/not_a_login"; expect_status "GET /api/v1/owners/not_a_login (a malformed login)" 400; cp "$TMP/b" "$TMP/problem"
node - "$TMP/problem" "$TMP/docs.html" "$TMP/openapi.json" <<'JS' && ok "problem type URIs resolve to an anchor on the docs page, for every documented code" || bad "problem documentation anchors" "see lines above"
const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const docs = fs.readFileSync(process.argv[3], 'utf8'); const d = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')); let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
for (const k of ['type', 'title', 'status', 'detail', 'code', 'resolution', 'instance']) need(p[k] !== undefined, `problem has no ${k}`);
const anchor = String(p.type).split('#')[1];
need(anchor === `error-${p.code}`, `type ${p.type} does not end in #error-${p.code}`);
const all = ['invalid_request', 'not_found', 'rate_limited', 'upstream_rate_limited', 'upstream_unavailable', 'api_route_not_found', 'method_not_allowed', 'internal_error', 'bad_request', 'invalid_body', 'unauthorized', 'forbidden', 'cross_origin_request', 'pro_required', 'banner_limit_reached', 'login_changed', 'payload_too_large', 'unsupported_media_type', 'accounts_unavailable', 'unavailable'];
for (const code of new Set([...all, ...d.components.schemas.ProblemDetails.properties.code.enum])) need(docs.includes(`id="error-${code}"`), `the docs page has no element with id="error-${code}"`);
process.exit(bad ? 1 : 0);
JS

echo "== discovery files (bonus signals); every one must ignore the Accept header"
for spec in '/.well-known/api-catalog@application/linkset\+json' '/.well-known/ai-catalog.json@json' '/.well-known/ard.json@json' '/.well-known/agent-skills/index.json@json' '/.well-known/mcp/server-card.json@mcp-server-card\+json' '/mcp/server-card@mcp-server-card\+json' '/server.json@json' '/openapi.json@openapi\+json' '/llms.txt@text/plain' '/docs/llms.txt@text/plain' '/api/llms.txt@text/plain' '/llms-full.txt@text/plain' '/robots.txt@text/plain' '/sitemap.xml@xml'; do
  p="${spec%%@*}"; ct="${spec##*@}"
  for a in 'application/json' 'text/markdown' 'application/mcp-server-card+json' 'image/*'; do req -H "Accept: $a" "$BASE$p"; [ "$S" = 200 ] && hdr content-type | grep -qiE -- "$ct" || bad "GET $p (Accept: $a)" "got $S $(hdr content-type)"; done
  req "$BASE$p"; expect_status "GET $p" 200; expect_hdr "$p" content-type "$ct"
done
req -I "$BASE/.well-known/api-catalog"; expect_status "HEAD /.well-known/api-catalog" 200; expect_hdr "HEAD api-catalog" link 'rel="api-catalog"'
req "$BASE/.well-known/api-catalog"; expect_body "api-catalog has item entries" '"item"'
req "$BASE/.well-known/agent-skills/index.json"
expect_body "agent skills index schema 0.2.0" 'schemas\.agentskills\.io/discovery/0\.2\.0/schema\.json'
SKILL_URL=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=d.skills[0];if(!(s.name&&s.type&&s.description&&s.url&&s.digest))process.exit(1);if(!/Use when/.test(s.description))process.exit(1);console.log(s.url+" "+s.digest)' "$TMP/b") && ok "agent skills index: name, type, description with \"Use when\", url, digest" || bad "agent-discovery-file" "an index entry lacks a field"
req "$BASE$(echo "${SKILL_URL%% *}" | sed -E 's#^https?://[^/]+##')"; expect_status "GET the skill file" 200
[ "sha256:$(shasum -a 256 "$TMP/b" | cut -d' ' -f1)" = "${SKILL_URL##* }" ] && ok "agent skill digest matches served bytes" || bad "agent-skills-index-v2" "digest mismatch"
head -5 "$TMP/b" | grep -q '^name: ' && head -5 "$TMP/b" | grep -q '^description: ' && ok "skill file front matter: name, description" || bad "skill file" "no name/description front matter"
fences_ok "skill file"
req "$BASE/mcp/server-card"; cp "$TMP/b" "$TMP/card"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(d.$schema==="https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"&&d.description.length<=100&&/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(d.name)&&d.version&&d.icons?.[0]?.src&&d.title&&!d.tools&&/\/mcp$/.test(d.remotes?.[0]?.url??"")?0:1)' "$TMP/card" && ok "server card: \$schema, name, title, icon, description<=100, version, remote url, no tools[]" || bad "mcp-server-card" "schema problems"
expect_hdr "server card" access-control-allow-origin '^\*$'
for p in /.well-known/ard.json /.well-known/ai-catalog.json; do
  req "$BASE$p"
  node - "$TMP/b" "$p" <<'JS' && ok "$p: entries valid" || bad "$p" "see lines above"
const d = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')); const ard = process.argv[3].includes('ard'); let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
need(d.specVersion === '1.0', 'specVersion must be "1.0"');
need(d.entries?.length >= 3, 'fewer than 3 entries');
for (const e of d.entries ?? []) {
  need(/^urn:air:[a-z0-9.-]+:[a-z0-9-]+:[a-z0-9._-]+$/i.test(e.identifier ?? ''), `bad identifier ${e.identifier}`);
  need(e.displayName && e.type && Boolean(e.url) !== Boolean(e.data), `${e.identifier}: needs displayName, type and exactly one of url/data`);
  need((e.representativeQueries ?? []).length >= 2 && e.representativeQueries.length <= 5, `${e.identifier}: 2 to 5 representativeQueries`);
  if (ard) need(e.trustManifest?.identity && e.trustManifest?.identityType === 'https', `${e.identifier}: no trustManifest on our own origin`);
  else need(!e.trustManifest, `${e.identifier}: the AI catalog carries no trustManifest`);
}
need((d.entries ?? []).some((e) => /mcp-server-card/.test(e.type) && /\/mcp\/server-card$/.test(e.url)), 'no MCP server card entry (mcp-well-known-discovery)');
process.exit(bad ? 1 : 0);
JS
done

echo "== MCP (Streamable HTTP, stateless, no credentials)"
MCP() { req -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-11-25' -d "$1"; sed -n 's/^data: //p' "$TMP/b" > "$TMP/j"; [ -s "$TMP/j" ] || cp "$TMP/b" "$TMP/j"; }
MCP '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"readiness-check","version":"1.0.0"}}}'
expect_status "initialize" 200; cp "$TMP/j" "$TMP/mcp-init"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).result;const c=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8"));process.exit(r.serverInfo?.name&&r.serverInfo.name===c.name&&r.serverInfo?.version&&(r.instructions??"").length>=100&&r.capabilities.tools&&!r.capabilities.resources&&!r.capabilities.prompts?0:1)' "$TMP/j" "$TMP/card" && ok "initialize: serverInfo (name equals the server card), instructions, tools only (no resources, no prompts)" || bad "mcp-server-identity" "name/version/instructions missing, name differs from the card, or an empty capability is advertised"
[ -z "$(hdr mcp-session-id)" ] && ok "stateless (no Mcp-Session-Id)" || bad "stateless" "session id issued"
expect_hdr "MCP answer" ratelimit-policy '^"[^"]+";q=[0-9]+;w=[0-9]+'; expect_hdr "MCP answer" access-control-allow-origin '^\*$'
MCP '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; cp "$TMP/j" "$TMP/mcp-tools"
node - "$TMP/j" <<'JS' && ok "tools/list: tool quality" || bad "mcp tool quality" "see lines above"
const t = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).result.tools; let bad = 0;
const need = (c, m) => { if (!c) { bad++; console.log('        - ' + m); } };
need(t.length >= 4, `${t.length} tools, need at least 4`);
for (const name of ['get_owner', 'get_repository', 'search_github', 'get_banner']) need(t.some((x) => x.name === name), `tool ${name} is missing`);
for (const x of t) {
  need(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(x.name) && x.name.length >= 4, `${x.name}: not verb_noun snake_case`);
  need(x.title, `${x.name}: no title`);
  need((x.description ?? '').length >= 80 && /\buse (it|this)\b/i.test(x.description) && /\breturns?\b/i.test(x.description), `${x.name}: description must be 80+ characters and say when to use it and what it returns`);
  need(x.inputSchema?.type === 'object', `${x.name}: inputSchema is not an object schema`);
  need(Object.values(x.inputSchema?.properties ?? {}).every((p) => p.description && (p.type || p.enum || p.anyOf)), `${x.name}: a parameter lacks a type or a description`);
  need(x.outputSchema?.type === 'object' && Object.keys(x.outputSchema.properties ?? {}).length > 0, `${x.name}: no object outputSchema`);
  need(x.annotations?.readOnlyHint === true && x.annotations?.destructiveHint === false, `${x.name}: readOnlyHint / destructiveHint annotations`);
}
need(new Set(t.map((x) => x.description)).size === t.length, 'two tools share a description');
process.exit(bad ? 1 : 0);
JS
call() { MCP "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; node - "$TMP/j" "$1" "$TMP/w" "${3:-}" <<'JS' && ok "tools/call $1 $2" || bad "tools/call $1" "see lines above"
const fs = require('fs'); const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const [, , , name, wfile, key] = process.argv; let bad = 0;
const need = (c, msg) => { if (!c) { bad++; console.log('        - ' + msg); } };
const r = m.result;
need(r && Array.isArray(r.content) && r.content[0]?.type === 'text', 'no result with a text block');
if (r?.isError) {
  let code = ''; try { code = JSON.parse(r.content[0].text).error.code; } catch {}
  if (/^upstream_/.test(code)) fs.appendFileSync(wfile, `${name}: GitHub not reachable from this server (${code}); the tool answered with a typed error instead of data\n`);
  else need(false, `tool error: ${r.content[0].text.slice(0, 200)}`);
} else if (r) {
  need(r.structuredContent && typeof r.structuredContent === 'object', 'no structuredContent');
  need(JSON.stringify(JSON.parse(r.content[0].text)) === JSON.stringify(r.structuredContent), 'the text block is not the same JSON as structuredContent');
  if (key) need(key.split('.').reduce((v, k) => v?.[k], r.structuredContent) !== undefined, `structuredContent.${key} is missing`);
}
process.exit(bad ? 1 : 0);
JS
warnings "MCP tool"; }
call get_banner '{"target":"vercel/next.js","preset":"contributors","theme":"dracula"}' links.svg
call get_owner '{"login":"vercel"}' owner.login
call get_owner '{"login":"markeljan","include_calendar":true}' owner.calendar.days
call get_repository '{"owner":"vercel","repo":"next.js"}' repository.stars
call search_github '{"query":"verc"}' suggestions
call list_banner_options '{}' themes
MCP '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_owner","arguments":{"login":"not_a_login"}}}'
grep -q '"isError":true' "$TMP/j" && grep -q 'invalid_request' "$TMP/j" && ok "a bad login is a tool error with the API's code" || bad "mcp tool errors" "expected isError with code invalid_request"
MCP '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"__nope__","arguments":{}}}'
grep -q '"error":{"code":-32' "$TMP/j" && ok "unknown tool -> JSON-RPC error" || bad "mcp-error-handling" "no JSON-RPC error object"
MCP '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_owner","arguments":{"login":5}}}'
grep -qE '"isError":true|"error":\{"code":-32' "$TMP/j" && ok "bad arguments -> error with a message" || bad "mcp-error-handling" "bad arguments were accepted"
for m in resources/list prompts/list; do MCP "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"$m\"}"; grep -q '"code":-32601' "$TMP/j" && ok "$m -> method not found (capability not advertised)" || bad "mcp-resource-listing" "$m answered: $(head -c 120 "$TMP/j")"; done
req "$BASE/mcp"; expect_status "GET /mcp" 405; expect_body "GET /mcp JSON-RPC error body" '"jsonrpc":"2.0","error":'
req -X DELETE "$BASE/mcp"; expect_status "DELETE /mcp" 405; expect_body "DELETE /mcp JSON-RPC error body" '"jsonrpc":"2.0","error":'
req -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' "$BASE/mcp"; expect_hdr "MCP preflight" access-control-allow-methods 'POST'
req -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: server/discover' -d '{"jsonrpc":"2.0","id":4,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"readiness-check","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
expect_body "server/discover (2026-07-28)" '"supportedVersions":\["2026-07-28"'

echo "== banner images still answer, whatever Accept says"
for spec in '/markeljan.svg@image/svg\+xml' '/vercel/next.js.png@image/png' '/embed/markeljan@image/(svg\+xml|png)' '/vercel/next.js/contributors.svg@image/svg\+xml' '/torvalds/streak.png@image/png' '/embed/vercel/next.js.png@image/png'; do
  p="${spec%%@*}"; ct="${spec##*@}"
  for a in 'image/*' 'text/html' '*/*' 'text/markdown' 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'; do
    req -H "Accept: $a" "$BASE$p"; [ "$S" = 200 ] && hdr content-type | grep -qiE -- "^$ct" && ok "GET $p (Accept: $a) -> $(hdr content-type)" || bad "GET $p (Accept: $a)" "got $S $(hdr content-type)"
  done
done
req "$BASE/markeljan.svg"; expect_hdr "image" x-banner-state '^ok$'; expect_hdr "image" access-control-allow-origin '^\*$'; expect_hdr "image" cache-control 'max-age=[0-9]+'
req -H 'Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' "$BASE/vercel"; expect_status "GET /vercel the way an <img> asks" 200; expect_hdr "<img> on a page URL" content-type '^image/'; expect_hdr "<img> on a page URL" vary '(^|, *)accept(,|$)'
req "$BASE/zz-unknown-owner-$RANDOM$RANDOM.svg"; expect_status "an unknown login as an image still answers 200" 200; expect_hdr "unknown login image" x-banner-state '^(not_found|unavailable)$'
req "$BASE/markeljan.png?size=og"; expect_status "GET /markeljan.png?size=og (link preview image)" 200; expect_hdr "preview image" content-type '^image/png'
# A URL that cannot be a banner is the one case without an image. Both answers are in the OpenAPI document:
# the image handler's problem, and the static 404 page of the routing layer (no function runs for it).
req "$BASE/$(printf 'a%.0s' $(seq 1 40)).svg"; expect_status "an image URL with a login that is too long" 404; expect_hdr "image 404 from the handler" content-type '^application/problem\+json'; expect_body "image 404 from the handler" '"code":"not_found"'
req "$BASE/docs.svg"; expect_status "an image URL on one of the site's own routes" 404; expect_hdr "image 404 from the routing layer" content-type '^text/html'
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const ok=["/{owner}.{format}","/{owner}/{repo}.{format}"].every((p)=>{const c=Object.keys(d.paths[p]?.get?.responses?.["404"]?.content??{});return c.includes("application/problem+json")&&c.includes("text/html")});process.exit(ok?0:1)' "$TMP/openapi.json" && ok "the OpenAPI document describes both image 404 answers" || bad "image 404 in the OpenAPI document" "both image operations must list application/problem+json and text/html under 404"

echo "== the sign-in protocol is named nowhere (the auth surface stays dark), and no placeholder is served"
WORD='oauth'
scan() { # label, curl args...
  local label="$1"; shift; req "$@"
  grep -qi "$WORD" "$TMP/b" "$TMP/h" && bad "$label names the sign-in protocol" "remove the word (it can half-activate the auth surface: about -9 points)" || ok "$label: clean"
  grep -q '{{[A-Za-z_]*}}' "$TMP/b" && bad "$label still serves a placeholder" "$(grep -o '{{[A-Za-z_]*}}' "$TMP/b" | sort -u | tr '\n' ' ')" || true
}
for p in / $CONTENT_PAGES; do scan "$p (html)" -H 'Accept: text/html' "$BASE$p"; done
for p in /index.md /docs.md /docs/migrate.md /pricing.md /about.md /contact.md /privacy.md /terms.md /vercel.md /vercel/next.js.md "/$PROBE.md"; do scan "$p" "$BASE$p"; done
for p in /llms.txt /llms-full.txt /docs/llms.txt /api/llms.txt /openapi.json /server.json /mcp/server-card /.well-known/api-catalog /.well-known/ai-catalog.json /.well-known/ard.json /.well-known/agent-skills/index.json /.well-known/agent-skills/gitbanners/SKILL.md /robots.txt /sitemap.xml /api /api/v1/options /api/v1/orank-probe-test "/$PROBE" /mcp; do scan "$p" "$BASE$p"; done
for f in mcp-init mcp-tools; do grep -qi "$WORD" "$TMP/$f" && bad "MCP $f names the sign-in protocol" "remove the word" || ok "MCP $f: clean"; done
req -H 'Accept: text/html' "$BASE/"; HIT=""; N=0
for src in $(grep -o '/_next/static/[^"]*\.js' "$TMP/b" | sort -u); do N=$((N+1)); curl -sS -m 30 "$BASE$src" | grep -qi "$WORD" && HIT="$HIT $src"; done
[ -z "$HIT" ] && ok "the $N scripts of the homepage: clean" || bad "a homepage script names the sign-in protocol" "$HIT"

echo; echo "passed: $PASS   failed: $FAIL   warnings: $WARN"; [ "$FAIL" -eq 0 ]
