# Authenticated Fantasy Fuel refresh

Fuel's signed-out NBA projection pages now return a preview of 25 players. A
free signed-in account can see additional rows. The regular GitHub workflow
can use that Fuel session for both the FanDuel feed (Yahoo scoring) and the
DraftKings feed; daily CSV uploads are not needed.

## Connect the session

1. Sign in to Fuel, including through Google, then open its NBA projections.
2. In Chrome or Edge, open **F12 → Network**, reload, and select the projections
   page with Type **document**. Under **Headers → Request Headers**, copy the
   **Cookie** value from the `www.dailyfantasyfuel.com` request.
3. Create the repository Actions secret **FUEL_COOKIE** in
   [GitHub settings](https://github.com/jimrong79/yahoo-dfs-slate-lab/settings/secrets/actions).
   Paste the value into the secret. A leading `Cookie:` label is also accepted.
4. Run **Refresh NBA slates and publish**. Its **Fantasy Fuel coverage** summary
   reports each feed's access status and parsed player count. A successful
   signed-in response is labeled `unrestricted-page`; counts vary by slate.
   Click **Refresh data** on the site after the workflow finishes.

Use the Fuel request cookie, never a Google cookie or password. Do not commit
it, paste it into chat, or include it in a CSV. The workflow exposes it only to
the refresh step. Code sends it only to the two exact HTTPS Fuel projection
URLs, disables authenticated redirects, and publishes only coverage metadata
and projections. It does not export raw authenticated pages or cookies.

## Scheduled runs and expiry

Scheduled, push-triggered, and manual regular refreshes all use the secret.
The separate manual odds workflow also passes it to the shared refresh job;
this does not change the Odds API's manual-only credit gate.

A copied browser session can expire or be revoked. The workflow does not log
into Google or renew the stored secret automatically. If Fuel returns the
login gate again, it records `restricted-preview` and emits a warning to renew
**FUEL_COOKIE**, instead of claiming full coverage. A login redirect or an
authentication rejection is retried once against the same public page without
credentials; no redirect is followed with the Fuel cookie.

Valid preview projections remain usable under the existing Combined fallback
rules. Source outages, dates, scoring platforms, injury flags, and readiness
checks remain enforced. A healthy feed can still produce a slate that is not
ready because official injury reports have not been submitted.

Local `DFF_*.csv` downloads are ignored by Git and serve as a comparison when
checking coverage. They are not a substitute for a fresh scheduled fetch.
