# Slate Lab

**Live site: https://jimrong79.github.io/yahoo-dfs-slate-lab/**

A personal Yahoo and DraftKings NBA lineup workbench. Select **Yahoo** or **DraftKings · Main slate** in the slate menu, review salaries, then click **Generate lineup**. Lock or exclude players to adjust the next build. Copy, download a review CSV, or save a lineup in your browser. Enter the selected players on the corresponding platform and check the contest's exact slate and late news first. The CSV is a review file, not a bulk-entry upload template. [Open DraftKings directly](https://jimrong79.github.io/yahoo-dfs-slate-lab/?platform=draftkings).

## What runs where

- This public repository contains the website, a browser optimizer, public-source adapters, and derived public slate snapshots. It contains no Yahoo account credentials, private entry identifiers, research training data, or trained model artifacts.
- The existing model/research repository remains private. Its old ML model is **not** used by v1. No automated training or profitability claim is implied.
- GitHub Actions discovers current Yahoo multi-game slates and the DraftKings NBA Classic main slate and publishes snapshots on a 15-minute schedule. GitHub Pages serves static files; the optimizer runs locally in a browser worker. No login or API key is needed. Dates follow Eastern time, so the next date's slate can appear during the previous Pacific evening.
- A newly released salary pool can appear before projections and official injury reports are ready. The page displays the pool and explains why generation is unavailable. Turn off **Eligible only** to inspect players without full projections.
- **Refresh data** reloads the latest published snapshot. It does not trigger a server job. GitHub schedules can be delayed, especially during heavy demand. Public repositories' schedules can also be disabled after 60 days without repository activity; re-enable the workflow in Actions if that happens.

## V1 method

**Yahoo:** the projection is a 50/50 average of SportsLine component-stat forecasts converted to Yahoo scoring and Daily Fantasy Fuel FanDuel projections. NBA Yahoo and FanDuel weights are identical: points + 1.2 rebounds + 1.5 assists + 3 steals + 3 blocks − turnovers. SportsLine's displayed fantasy total is deliberately not used. Both current sources must match the player's team and opponent. Value is fantasy points per salary dollar.

**DraftKings:** uses Daily Fantasy Fuel's native DraftKings forecast directly, including the provider's bonus estimates. SportsLine supplies projected minutes only. The scoring is points + 0.5 made threes + 1.25 rebounds + 1.5 assists + 2 steals + 2 blocks − 0.5 turnovers, plus 1.5 for a double-double and 3 for a triple-double. No bonus is inferred by applying a threshold to average projected stats; no Yahoo/FanDuel fantasy total is reused. Value is fantasy points per **$1,000** salary. This is one projection source, not the two-source Yahoo consensus.

Minutes come from SportsLine. Starting-five expectations come from RotoWire and can be projected rather than confirmed. Official NBA injury-report statuses and submission coverage are checked, together with Yahoo and Fuel flags. Out, doubtful, questionable, unknown, and unresolved flagged players are excluded. Probable players can be included. SportsLine has no publication timestamp in this feed; the retrieval time and current matchup are checked, which does not prove the underlying forecast was newly revised.

Default settings are projected starters, 24+ minutes, and at most two players whose selected platform's historical average is zero. The “NEW” marker is a rough proxy that includes rookies and missing history. These defaults are adjustable; the injury/source checks are not. Search, game chips, and position tabs affect the table display only. Locks, exclusions, and settings affect the lineup. Switching slates clears locks and exclusions; saved lineups retain their platform and cap.

The integer solver seeks a high total projection within each platform's rules:

| Platform | Slots | Cap | Diversity |
| --- | --- | --- | --- |
| Yahoo | PG, SG, G, SF, PF, F, C, UTIL | $200 | At least 3 teams; at most 6 per team |
| DraftKings Classic | PG, SG, SF, PF, C, G, F, UTIL | $50,000 | At least 2 games; at most 7 per team/game |

DraftKings supports multi-position eligibility, using the official salary CSV's position/roster fields and validating that they agree. One player cannot fill two slots. Only full-game NBA Classic is included; Showdown, Tiers, Pick6, and in-game contests are excluded. Main-slate discovery prefers the provider's Featured Classic slate, then full game coverage.

The solver can time out; every returned lineup is independently checked for legality. Later games preferentially occupy flexible positions. V1 blocks full-slate generation after first tip; it does not manage existing entries or provide late swaps. No ownership model, payout optimization, or validated profitability is included.

Snapshots older than two hours, official injury reports older than three hours, and archived dates block generation. Failed platform refreshes preserve that platform's previous per-slate successful timestamps and do not stop the other platform. Partial source availability publishes salaries with generation disabled. When no players meet the data checks, the table initially shows the full salary pool. Raw source HTML/PDFs are not published.

## Development and checks

Requires Node 22.23.2+ and Python 3.11+.

```sh
npm ci
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/refresh.py --strict
npm test
.venv/bin/python -m pytest tests/test_pipeline.py -q
npm run build
npm run dev
```

Browser checks: install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:browser`. They intercept data requests with historical Yahoo observations and explicitly synthetic DraftKings inputs, with a fixed clock. This tests both platforms on mobile and desktop, including generation, locks/exclusions, saved lineups, downloads, platform switching, secondary positions, missing-source states, and expiry. Synthetic test data is never copied into `public/` or deployed. Run the same UI checks against deployed assets with `SLATE_LAB_URL=https://jimrong79.github.io/yahoo-dfs-slate-lab/ npm run test:browser`; actual live availability still depends on current upstream reports.

The Actions workflow runs optimizer and parser checks before every deployment. It needs only the built-in workflow permissions for public Pages deployment. No access to the private model repository is configured. To refresh on demand, run **Refresh NBA slates and publish** from this repository's Actions tab.

## Sources

- [Yahoo contests](https://sports.yahoo.com/dailyfantasy/contests/nba) and [Yahoo NBA scoring rules](https://sports.yahoo.com/dailyfantasy/help/nba/rules)
- [SportsLine component projections](https://www.sportsline.com/nba/expert-projections/simulation/)
- [Daily Fantasy Fuel projections](https://www.dailyfantasyfuel.com/nba/projections/fanduel/)
- [DraftKings public draft groups](https://api.draftkings.com/draftgroups/v1/), its official salary CSV, and [NBA scoring overview](https://dknetwork.draftkings.com/2025/10/17/nba-daily-fantasy-101-how-to-play-dfs-on-draftkings/)
- [Daily Fantasy Fuel DraftKings projections](https://www.dailyfantasyfuel.com/nba/projections/draftkings/)
- [FanDuel scoring rules](https://www.fanduel.com/rules)
- [RotoWire starting lineups](https://www.rotowire.com/basketball/nba-lineups.php)
- [NBA injury reports](https://official.nba.com/nba-injury-report-2026-27-season/)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Independent personal research tool; not affiliated with Yahoo or these data providers.
