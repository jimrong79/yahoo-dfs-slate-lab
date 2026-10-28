# 3-source blend (experimental)

Select **3-source blend (experimental)** on either Yahoo or DraftKings. Each player uses the equal arithmetic mean of the available SportsLine, Daily Fantasy Fuel, and betting-derived fantasy estimates. Three sources get 1/3 each, two get 1/2 each, one gets full weight. A published zero is a real value. With no available estimate, the player is unavailable; this mode has no private-model points fallback. The existing 50/50, Combined, Fuel default, and Trained model modes retain their recipes.

The table, lineup, copied text, and CSV identify contributing sources. Minutes still come from SportsLine or a compatible, fresh private-model export. Injury, starter, minutes, salary, roster, and authentication checks still apply.

## Activate the feed

No working complete no-key feed was confirmed. The adapter targets [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/) and its [NBA player-prop markets](https://the-odds-api.com/sports-odds-data/betting-markets.html). A credential is required. Production coverage cannot be confirmed until a real key is configured.

1. Obtain your own key from The Odds API. Review its plan and usage terms; the app does not register or buy a plan for you.
2. In [this repository's Actions secrets](https://github.com/jimrong79/yahoo-dfs-slate-lab/settings/secrets/actions), add `ODDS_API_KEY`. Do not put the key in source, JSON snapshots, browser code, or chat.
3. Run [Refresh NBA slates and publish](https://github.com/jimrong79/yahoo-dfs-slate-lab/actions/workflows/pages.yml) manually, then click Refresh data on the site and choose 3-source blend.

By default only a **manual workflow run** fetches new odds. Scheduled and push runs can retain still-fresh derived estimates from the prior published slate, without consuming API credits. Successful event captures are reused for one hour; reuse never changes the original quote timestamp. To opt into fetching during scheduled/push runs, set the Actions repository **variable** `ODDS_SCHEDULED=true`.

One event request asks for nine markets in one region (`us`), costing up to **9 credits per game** according to the provider's returned-market quota formula. An eight-game refresh can therefore use up to 72 credits. The event list is quota-free. Quotes are fetched once per event per run and shared by Yahoo/DK. The collector checks returned remaining credits before another event request. This is not a spending cap; select a suitable plan before opting into scheduled calls.

Missing credentials, empty/incomplete data, quota/network failures, and unsupported schemas are shown as betting unavailable. SportsLine and Fuel continue to work. No live betting coverage or accuracy claim is implied by passing synthetic fixture tests.

## Conversion and limitations

A sportsbook O/U line is not an expected fantasy score. This implementation is an explicit approximation:

1. Require paired Over/Under quotes for the same player, stat, half-integer line, bookmaker, and event. Use market-level timestamps, no older than two hours and no more than five minutes in the future. Integer lines with pushes are excluded.
2. Convert decimal odds to implied probabilities, then remove the margin proportionally: `p_under = (1 / under_odds) / (1 / under_odds + 1 / over_odds)`.
3. Assume each counting stat follows a **Poisson distribution**, and numerically solve `P(X <= floor(line)) = p_under` for its mean. A single threshold cannot identify a full distribution without an assumption; NBA stats can be overdispersed and this model has not been calibrated. These are estimates, not bookmaker-supplied projections.
4. Apply platform scoring. Yahoo requires points, rebounds, assists, steals, blocks, and turnovers from the same bookmaker. DK additionally requires threes and paired Yes/No double-double and triple-double markets. DK bonuses are `1.5 * P(DD) + 3 * P(TD)`, using de-vigged probabilities. No bonus is awarded just because a mean stat reaches ten.
5. For each player, take the **median of complete bookmaker fantasy estimates**. This counts as one betting source in the outer equal-weight blend, regardless of book count. Do not splice partial bookmakers, substitute provider stats, or treat missing categories as zero.

Matching requires the exact away/home matchup and tipoff, plus a unique normalized player name in that game's platform salary pool. Unsupported aliases are left unmatched. Re-fetches replace successful event data, including withdrawn quotes. Quotes expire independently of the public snapshot timestamp, in the UI and on the authenticated server.

Full coverage will likely be limited, particularly for DK bonus markets and bench players. SportsLine and Fuel may themselves incorporate market information, so the three sources are not independent. Profitability and improved accuracy are **not validated**. The fitted model and training data remain in the private repository; only derived daily estimates are published.
