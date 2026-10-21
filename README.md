# Slate Lab

**Live site: https://jimrong79.github.io/yahoo-dfs-slate-lab/**

A personal Yahoo NBA lineup workbench. Select a slate, review the current salaries, then click **Generate lineup**. Lock or exclude players to adjust the next build. Copy, download a review CSV, or save a lineup in your browser. Enter the selected players manually on Yahoo and check the contest's exact slate and late news first. The CSV is a review file, not a Yahoo bulk-entry upload template.

## What runs where

- This public repository contains the website, a browser optimizer, public-source adapters, and derived public slate snapshots. It contains no Yahoo account credentials, private entry identifiers, research training data, or trained model artifacts.
- The existing model/research repository remains private. Its old ML model is **not** used by v1. No automated training or profitability claim is implied.
- GitHub Actions discovers current Yahoo multi-game slates and publishes snapshots on a 15-minute schedule. GitHub Pages serves static files; the optimizer runs locally in a browser worker. No login or API key is needed.
- A newly released salary pool can appear before projections and official injury reports are ready. The page displays the pool and explains why generation is unavailable. Turn off **Eligible only** to inspect players without full projections.
- **Refresh data** reloads the latest published snapshot. It does not trigger a server job. GitHub schedules can be delayed, especially during heavy demand. Public repositories' schedules can also be disabled after 60 days without repository activity; re-enable the workflow in Actions if that happens.

## V1 method

The projection is a 50/50 average of SportsLine component-stat forecasts converted to Yahoo scoring and Daily Fantasy Fuel FanDuel projections. NBA Yahoo and FanDuel weights are identical: points + 1.2 rebounds + 1.5 assists + 3 steals + 3 blocks − turnovers. SportsLine's displayed fantasy total is deliberately not used. Both current sources must match the player's team and opponent.

Minutes come from SportsLine. Starting-five expectations come from RotoWire and can be projected rather than confirmed. Official NBA injury-report statuses and submission coverage are checked, together with Yahoo and Fuel flags. Out, doubtful, questionable, unknown, and unresolved flagged players are excluded. Probable players can be included. SportsLine has no publication timestamp in this feed; the retrieval time and current matchup are checked, which does not prove the underlying forecast was newly revised.

Default settings are projected starters, 24+ minutes, and at most two players whose Yahoo historical average is zero. The “NEW” marker is a rough proxy that includes rookies and missing history. These defaults are adjustable; the injury/source checks are not. Search, game chips, and position tabs affect the table display only. Locks, exclusions, and settings affect the lineup.

The integer solver seeks a high total projection within eight distinct Yahoo slots (PG, SG, G, SF, PF, F, C, UTIL), a $200 cap, at least three teams, and at most six players per team. It can time out; every returned lineup is independently checked for legality. Later games preferentially occupy flexible positions. V1 blocks full-slate generation after first tip; it does not manage existing entries or provide late swaps. No ownership model, payout optimization, or validated profitability is included.

Snapshots older than two hours, official injury reports older than three hours, and archived dates block generation. Failed refreshes preserve the previous successful timestamps, so failures cannot make old forecasts appear fresh. Partial source availability publishes salaries with generation disabled. Raw source HTML/PDFs are not published.

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

Browser checks: install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:browser`. They use the real bundled snapshots with the clock fixed just after capture, verify mobile and desktop generation, locks/exclusions, saved lineups, downloads, slate selection, and expiry. Run against the deployed site with `SLATE_LAB_URL=https://jimrong79.github.io/yahoo-dfs-slate-lab/ npm run test:browser` after synchronizing the published snapshots locally.

The Actions workflow runs optimizer and parser checks before every deployment. It needs only the built-in workflow permissions for public Pages deployment. No access to the private model repository is configured. To refresh on demand, run **Refresh NBA slates and publish** from this repository's Actions tab.

## Sources

- [Yahoo contests](https://sports.yahoo.com/dailyfantasy/contests/nba) and [Yahoo NBA scoring rules](https://sports.yahoo.com/dailyfantasy/help/nba/rules)
- [SportsLine component projections](https://www.sportsline.com/nba/expert-projections/simulation/)
- [Daily Fantasy Fuel projections](https://www.dailyfantasyfuel.com/nba/projections/fanduel/)
- [FanDuel scoring rules](https://www.fanduel.com/rules)
- [RotoWire starting lineups](https://www.rotowire.com/basketball/nba-lineups.php)
- [NBA injury reports](https://official.nba.com/nba-injury-report-2026-27-season/)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Independent personal research tool; not affiliated with Yahoo or these data providers.
