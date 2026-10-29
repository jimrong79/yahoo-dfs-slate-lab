# 3-source blend (experimental)

Select **3-source blend (experimental)** on either Yahoo or DraftKings. Each player uses the equal arithmetic mean of the available SportsLine, Daily Fantasy Fuel, and betting-derived fantasy estimates. Three sources get 1/3 each, two get 1/2 each, one gets full weight. A published zero is a real value. With no available estimate, the player is unavailable; this mode has no private-model points fallback. The existing 50/50, Combined, Fuel default, and Trained model modes retain their recipes.

The table, lineup, copied text, and CSV identify contributing sources. Minutes still come from SportsLine or a compatible, fresh private-model export. Injury, starter, minutes, salary, roster, and authentication checks still apply.

## Activate the feed

No working complete no-key feed was confirmed. The adapter targets [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/) and its [NBA player-prop markets](https://the-odds-api.com/sports-odds-data/betting-markets.html). A credential is required. Production coverage cannot be confirmed until a real key is configured.

1. Obtain your own key from The Odds API. Review its plan and usage terms; the app does not register or buy a plan for you.
2. In [this repository's Actions secrets](https://github.com/jimrong79/yahoo-dfs-slate-lab/settings/secrets/actions), add `ODDS_API_KEY`. Do not put the key in source, JSON snapshots, browser code, or chat.
3. Around **3 p.m. Pacific**, open [Refresh betting odds (manual)](https://github.com/jimrong79/yahoo-dfs-slate-lab/actions/workflows/odds.yml), choose **Run workflow → main → Run workflow**, then click Refresh data on the site and choose 3-source blend. This is a manual action, not a 3 p.m. schedule.

## Separate refresh controls

| Action | SportsLine / Fuel and normal slate inputs | New Odds API calls |
| --- | --- | --- |
| Existing 15-minute schedule or code push | Refreshed | None |
| **Refresh NBA slates and publish** — Run workflow | Refreshed | None |
| Website **Refresh data** | Reloads published snapshot | None |
| **Refresh betting odds (manual)** — Run workflow | Refreshed | Enabled for today's first authorized manual run |

Only GitHub account `jimrong79` (ID `14351098`) can authorize the odds workflow on `main`. The original refresh has no odds input and does not receive the API key. New calls require an explicit `ODDS_FETCH_ENABLED=true` from the separate workflow's authorization step. The previous `ODDS_SCHEDULED` setting is no longer supported.

The odds workflow checks GitHub run history and allows **one attempt per Pacific calendar day**. A second run that day or a rerun skips odds and can still refresh normal inputs. Failed/cancelled earlier attempts also count because they may have spent credits before failing to publish; skipped, wrong-branch, and other-account runs do not. Shared deployment concurrency serializes both refresh workflows. If run history cannot be checked, the job stops without authorizing API calls.

Normal refreshes reuse still-fresh derived betting estimates from the published snapshot. This never renews quote timestamps. **Betting quotes expire after two hours**: a capture around 3 p.m. PT is generally usable only until about 5 p.m. PT (earlier if the provider quote was already old). After expiry, 3-source blend uses available SportsLine/Fuel estimates; normal 50/50 and Combined continue their existing behavior.

## Credit usage

One event request asks for nine markets in one region (`us`), costing up to **9 credits per game**, based on the number of markets actually returned. The event list is quota-free. A game's request is shared across Yahoo, DraftKings, and overlapping slates in the same run.

| Distinct games fetched | Maximum credits per refresh |
| --- | --- |
| 2 | 18 |
| 4 | 36 |
| 8 | 72 |
| 12 | 108 |

At full nine-market coverage, **500 credits cover about 55 game fetches per month**, approximately six eight-game refreshes or thirteen four-game refreshes. Once per day across a full slate can still exceed the free monthly allowance. Missing markets can reduce the actual charge. No automatic odds polling or paid plan changes are configured.

The workflow summary and logs report quota-free event discovery separately from player-odds requests, credits charged according to response headers, and provider-reported remaining quota. Per-game diagnostics distinguish missing matchups, start-time mismatches, ambiguous events, and invalid odds responses. The published snapshot retains the last manual attempt and its matching results across ordinary refreshes, so zero betting coverage does not imply the workflow never ran. If a network failure prevents confirming a charge, the summary labels it unknown instead of claiming zero. The collector checks remaining quota before another event request. No key, raw quotes, or request URLs containing the key are printed.

Missing credentials, empty/incomplete data, quota/network failures, and unsupported schemas are shown as betting unavailable. SportsLine and Fuel continue to work. No live betting coverage or accuracy claim is implied by passing synthetic fixture tests.

## Conversion and limitations

A sportsbook O/U line is not an expected fantasy score. This implementation is an explicit approximation:

1. Require paired Over/Under quotes for the same player, stat, half-integer line, bookmaker, and event. Use market-level timestamps, no older than two hours and no more than five minutes in the future. Integer lines with pushes are excluded.
2. Convert decimal odds to implied probabilities, then remove the margin proportionally: `p_under = (1 / under_odds) / (1 / under_odds + 1 / over_odds)`.
3. Assume each counting stat follows a **Poisson distribution**, and numerically solve `P(X <= floor(line)) = p_under` for its mean. A single threshold cannot identify a full distribution without an assumption; NBA stats can be overdispersed and this model has not been calibrated. These are estimates, not bookmaker-supplied projections.
4. Apply platform scoring. Yahoo requires points, rebounds, assists, steals, blocks, and turnovers from the same bookmaker. DK additionally requires threes and paired Yes/No double-double and triple-double markets. DK bonuses are `1.5 * P(DD) + 3 * P(TD)`, using de-vigged probabilities. No bonus is awarded just because a mean stat reaches ten.
5. For each player, take the **median of complete bookmaker fantasy estimates**. This counts as one betting source in the outer equal-weight blend, regardless of book count. Do not splice partial bookmakers, substitute provider stats, or treat missing categories as zero.

Matching requires the exact away/home matchup, the same Eastern calendar date, and one unique event starting within 15 minutes of the DFS tipoff. This accommodates scheduled starts versus sportsbook tipoff estimates without selecting ambiguous events or another day's game. Team normalization preserves digits in Philadelphia 76ers. The odds response must match the selected event ID, teams, and allowed start-time window; the resulting estimate retains the DFS tipoff for player identity and lock checks. Player matching requires a unique normalized name in that game's platform salary pool. Unsupported aliases are left unmatched. Re-fetches replace successful event data, including withdrawn quotes. Quotes expire independently of the public snapshot timestamp, in the UI and on the authenticated server.

## Projection feed outages

Public input downloads retry transient network errors and HTTP 429/500/502/503/504 up to three total attempts, with one- and two-second delays. Odds API requests are separate and are not automatically retried. If an entire SportsLine or Fuel feed still fails or cannot be parsed, the snapshot marks the feed unavailable and pauses lineup generation in every mode. A failed Fuel feed also marks its injury checks unresolved. The website names the failed provider and directs the owner to refresh. Fresh salaries and reports remain visible; successful later refreshes restore generation.

Missing coverage for an individual player in a successfully loaded feed still uses the existing Combined fallback recipe. A whole-feed outage no longer silently turns a two-provider lineup into a one-provider lineup or clears injury restrictions. No old projections are relabeled as newly captured.

Full coverage will likely be limited, particularly for DK bonus markets and bench players. SportsLine and Fuel may themselves incorporate market information, so the three sources are not independent. Profitability and improved accuracy are **not validated**. The fitted model and training data remain in the private repository; only derived daily estimates are published.
