# Slate Lab

**Live site: https://jimrong79.github.io/yahoo-dfs-slate-lab/**

A personal Yahoo and DraftKings NBA lineup workbench. Select **Yahoo** or **DraftKings · Main slate** in the slate menu, review salaries, then click **Generate lineup**. Lock or exclude players to adjust the next build. Copy, download a review CSV, or save a lineup in your browser. Enter the selected players on the corresponding platform and check the contest's exact slate and late news first. The CSV is a review file, not a bulk-entry upload template. [Open DraftKings directly](https://jimrong79.github.io/yahoo-dfs-slate-lab/?platform=draftkings).

## What runs where

- This public repository contains the website, a browser optimizer, public-source adapters, and derived public slate snapshots. It contains no Yahoo account credentials, private entry identifiers, research training data, or trained model artifacts.
- The model/research repository remains private. Yahoo defaults to the **50/50 consensus**. An optional **Trained model (experimental)** selector uses separately exported predictions from separate private Yahoo and DraftKings fits. Model weights, code and training data are not published. No automated training or profitability claim is implied.
- GitHub Actions discovers current Yahoo multi-game slates and the DraftKings NBA Classic main slate and publishes snapshots on a 15-minute schedule. GitHub Pages serves the public player table. Lineup generation requires GitHub sign-in and runs on a separate backend that permits only `jimrong79` (GitHub account ID `14351098`). Other visitors see an access popup linking to `jimrong79@gmail.com`. Dates follow Eastern time, so the next date's slate can appear during the previous Pacific evening.
- Yahoo discovery reads advertised NBA slate metadata and queries its public NBA contest list for each slate. The general lobby's small featured preview can omit NBA contests when other sports dominate; it is not used as the contest inventory.
- A newly released salary pool can appear before projections and official injury reports are ready. The page displays the pool and explains why generation is unavailable. Turn off **Eligible only** to inspect players without full projections.
- **Refresh data** reloads the latest published snapshot. It does not trigger a server job. GitHub schedules can be delayed, especially during heavy demand. Public repositories' schedules can also be disabled after 60 days without repository activity; re-enable the workflow in Actions if that happens.
- If the snapshot is stale, open [Refresh NBA slates and publish](https://github.com/jimrong79/yahoo-dfs-slate-lab/actions/workflows/pages.yml), select **Run workflow → Run workflow**, wait for the green check, then click **Refresh data** on the site. The stale-data message links to this workflow. This updates public-source snapshots, not private-model predictions.
- Each workflow attempt uploads and deploys a uniquely named Pages artifact, so reruns cannot select an earlier attempt's build. After a workflow fix, start **Run workflow** on `main`; rerunning an older run uses that run's original workflow version.

**Optional 3-source blend:** equal-average the available SportsLine, Fuel, and betting-derived estimates (three, two, or one source). Live betting needs an `ODDS_API_KEY` Actions secret. [Setup, quota controls, and experimental conversion assumptions](docs/betting-blend.md).

**Optional Betting hybrid:** use betting for available stat categories and retain SportsLine estimates for missing categories. The adjusted forecast replaces SportsLine in its average with Fuel, so fallback estimates are not counted twice. DraftKings threes and DD/TD remain one group unless betting covers all three. **Stat sources** and CSV exports show the contributions. The next manual odds run supplies partial betting components; older snapshots fall back to provider totals. [Hybrid details](docs/betting-blend.md#betting-hybrid-experimental).

**Separate manual odds refresh:** run [Refresh betting odds (manual)](https://github.com/jimrong79/yahoo-dfs-slate-lab/actions/workflows/odds.yml) on `main` when you want betting data (for example, 3 p.m. Pacific). It permits one owner-requested attempt per Pacific day and reports credit use. Existing scheduled, push, and manual **Refresh NBA slates and publish** runs continue updating SportsLine/Fuel with **zero Odds API requests**. Betting quotes expire after two hours; normal refreshes never make old quotes look fresh.

## V1 method

**Yahoo:** the projection is a 50/50 average of SportsLine component-stat forecasts converted to Yahoo scoring and Daily Fantasy Fuel FanDuel projections. NBA Yahoo and FanDuel weights are identical: points + 1.2 rebounds + 1.5 assists + 3 steals + 3 blocks − turnovers. SportsLine's displayed fantasy total is deliberately not used. Both current sources must match the player's team and opponent. Value is fantasy points per salary dollar.

**Optional Combined (Yahoo and DraftKings):** choose **Combined** in **Build using**. For each player, average both provider forecasts when available; use the sole provider when only one is available; use a fresh, matching private-model prediction when neither is available. A published zero is retained, never replaced by an optimistic fallback. The table and lineup label the source; saved lineups, copied text and CSVs retain it. These are projection providers, not two direct betting-market feeds. A missing forecast does not establish low expected minutes.

Combined uses SportsLine minutes for provider forecasts, with fresh model minutes when those are missing. Model-based points use model minutes. Missing minutes still exclude a player even with the minutes filter set to zero. All official injury coverage, Yahoo/provider flags, starter filters, salary rules and freshness checks remain enforced. Missing Fuel coverage is distinguished from an actual injury flag. A provider outage can leave Combined usable if sufficient fresh alternatives exist; missing official injury reports or starting-lineup data still block generation. Expired or mismatched model data never fill gaps, and a lineup that used expired model points or minutes is invalidated. Yahoo keeps 50/50 as its default; DraftKings keeps the original Fuel option as its default.

**Optional trained model:** choose it in **Build using**, then generate another lineup. The table shows the alternate forecast below each active forecast, and the lineup shows both totals for the same eight players. Saved lineups, copied text and CSVs preserve the selected method. The model is the private v8 blend of direct points and availability × role-adjusted minutes × efficiency, with current starter overrides. Yahoo retains its existing SportsLine minutes policy in standalone model mode. DraftKings standalone model mode uses native-model minutes. Both enforce the same minutes thresholds and injury checks. Higher predictions from one method are not evidence of better accuracy.

The private repository's `scripts/export_site_predictions.py` loads the saved fit, verifies it reproduces its original predictions, builds fresh features and writes only derived records to `public/data/ml-YYYY-MM-DD.json` for Yahoo and `public/data/ml-draftkings-YYYY-MM-DD.json` for DraftKings. Inference does not retrain the model. Publish that file through the normal site deployment. Inputs expire after two hours independently of public snapshots. A change in either team's roster, injury flags or starters invalidates model predictions for that matchup; missing predictions are excluded without a consensus fallback. DraftKings forecasts come from a separately fitted model trained against actual DraftKings points, including made threes and stackable double-/triple-double bonuses. Its feature builder currently uses the Yahoo pool: only exact name/team/matchup matches with consistent current news transfer to DraftKings IDs. Unmatched players remain unavailable. The shared feature design and training population are experimental; short chronological replay checks do not establish superiority over the providers.

**Private-model exports currently run on demand.** The public GitHub workflow cannot access the private model and does not refresh these exports. When a fresh model file is unavailable, the selector explains why generation is disabled; provider methods remain usable when their required data are available. No credentials or private-repository access were added to the public site.

**DraftKings:** offers **Fuel DraftKings (original default)**, **50/50 consensus**, **Combined**, and **Trained model (experimental)**. The 50/50 option averages SportsLine's explicit `DK` column and Fuel's native DraftKings forecast. Each source supplies its own bonus estimates. The parser never substitutes SportsLine's `FP` or `FD` column when `DK` is missing. Combined uses the same both → sole provider → fresh native-model hierarchy as Yahoo. The scoring is points + 0.5 made threes + 1.25 rebounds + 1.5 assists + 2 steals + 2 blocks − 0.5 turnovers, plus 1.5 for a double-double and 3 for a triple-double. No bonus is inferred by applying a threshold to average projected stats; no Yahoo/FanDuel fantasy total is reused. Value is fantasy points per **$1,000** salary. The original Fuel option uses one provider; 50/50 requires both native DraftKings forecasts.

Provider minutes come from SportsLine; Combined can use fresh native-model minutes if those are unavailable. Starting-five expectations come from RotoWire and can be projected rather than confirmed. Official NBA injury-report statuses and submission coverage are checked, together with Yahoo and Fuel flags. Out, doubtful, questionable, unknown, and unresolved flagged players are excluded. Probable players can be included. SportsLine has no publication timestamp in this feed; the retrieval time and current matchup are checked, which does not prove the underlying forecast was newly revised.

Two-game slates default to including healthy bench players with 16+ projected minutes. Larger slates default to projected starters with 24+ minutes. This allows affordable rotation players into small slates where eight starters may exceed the budget. Both defaults allow at most two players whose selected platform's historical average is zero. The “NEW” marker is a rough proxy that includes rookies and missing history. These defaults are adjustable; the injury/source checks are not. Custom settings are kept when switching slates. Search, game chips, and position tabs affect the table display only. Locks, exclusions, and settings affect the lineup. Switching slates clears locks and exclusions; saved lineups retain their platform and cap.

The integer solver seeks a high total projection within each platform's rules:

| Platform | Slots | Cap | Diversity |
| --- | --- | --- | --- |
| Yahoo | PG, SG, G, SF, PF, F, C, UTIL | $200 | At least 3 teams; at most 6 per team |
| DraftKings Classic | PG, SG, SF, PF, C, G, F, UTIL | $50,000 | At least 2 games; at most 7 per team/game |

DraftKings supports multi-position eligibility, using the official salary CSV's position/roster fields and validating that they agree. One player cannot fill two slots. Only full-game NBA Classic is included; Showdown, Tiers, Pick6, and in-game contests are excluded. Main-slate discovery prefers the provider's Featured Classic slate, then full game coverage.

The solver can time out; every returned lineup is independently checked for legality. Later games preferentially occupy flexible positions. V1 blocks full-slate generation after first tip; it does not manage existing entries or provide late swaps. No ownership model, payout optimization, or validated profitability is included.

Snapshots older than two hours, official injury reports older than three hours, and archived dates block generation. Failed platform refreshes preserve that platform's previous per-slate successful timestamps and do not stop the other platform. Partial source availability publishes salaries; generation depends on the selected method's available forecasts and required injury/lineup reports. When no players meet the data checks, the table initially shows the full salary pool. Raw source HTML/PDFs are not published.

## Weekly results

[Weekly results](https://jimrong79.github.io/yahoo-dfs-slate-lab/results.html) publishes the owner's approved aggregate NBA results: entry fees, payouts, profit, ROI, cash rate, a cumulative-profit graph, and weekly/contest-type breakdowns. It is public and does not require sign-in. The builder's GitHub authentication is unchanged. No raw exports, entry IDs, contest IDs, player lineups, or account credentials are published.

Each week, download the DraftKings entry-history CSV and Yahoo contest-history CSV into the ignored `contest-history/` folder. Preserve the source headers. Then run:

```sh
npm run results:import
npm test
python3 -m pytest tests/test_results.py -q
npm run build
```

The importer recognizes source CSVs by their headers and ignores the derived tracking CSVs in that folder. It reads downloads by modification time, merges by platform plus entry ID, retains prior weeks in the private `contest-history/results-ledger.json`, and applies corrections from newer files. Re-importing overlapping downloads does not add duplicate entries, and an older download cannot overwrite a newer correction. Keep a private backup of the folder; a fresh clone of this public repo does not contain the entry ledger. Explicit inputs can be provided with `python3 pipeline/results.py --input path/to/dk.csv path/to/yahoo.csv`.

Review and commit only `public/data/results.json`, then publish through the existing main-branch Pages workflow. A normal slate refresh preserves this committed report; it does not download account history or spend odds credits to update results. This is a manual weekly import, not an account sync or scheduled reminder.

Tracking starts October 20, 2026. Older seasons and other sports are excluded. The report's default seven-day window ends on the latest recorded settled date; calendar weeks run Monday–Sunday. `--through YYYY-MM-DD` selects an earlier end date, and `--season-start` with a separate `--ledger` starts a new season. Coverage dates are shown per platform; absent records are not verified zero activity. Yahoo unresolved/cancelled entries are excluded, while DraftKings's history export is treated as settled. DraftKings ticket prizes are separate from cash; Yahoo does not distinguish ticket prize value. Entry funding, subscription expenses, model choice and late swaps cannot be inferred from these exports. Contest types are inferred from titles and never treated as projection-mode labels.

The public report contains daily aggregate groups only. Tests check deduplication, settlement corrections, privacy fields, exact cents, report filtering, and financial reconciliation. Browser checks cover both page sizes, public access, filters, chart interactions and errors using synthetic aggregates.

## Development commands

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

## GitHub access implementation

The deployed authentication backend is configured with a dedicated GitHub app.
Only the verified owner account may use its generation endpoint.

The backend lives in the separate `yahoo-dfs-auth` workspace and Sites source repo.
It verifies GitHub identity, stores only hashes of eight-hour app sessions, and
authorizes every generation request. The browser sends slate selection and filters;
the server fetches the published data and enforces the clock, injury checks and
platform rules. OAuth secrets and GitHub access tokens never enter the frontend.
The frontend contains no optimizer worker or fallback generation path.

For credential rotation and backend maintenance, follow
`yahoo-dfs-auth/AUTH-SETUP.md`. The backend is
`https://jimrong79-slate-lab-api.jimrong79.chatgpt.site`. Keep backend source modules
in sync when changing the optimizer, eligibility, platform or projection code.
Public projections and previously published code remain public; access controls
protect this hosted generation service, not independently copied implementations.

## Sources

- [Yahoo contests](https://sports.yahoo.com/dailyfantasy/contests/nba) and [Yahoo NBA scoring rules](https://sports.yahoo.com/dailyfantasy/help/nba/rules)
- [SportsLine projection methodology](https://www.sportsline.com/insiders/how-do-we-produce-player-projections/) explains simulations and platform-specific mean fantasy totals. These are projections, not direct sportsbook prices.
- [SportsLine component projections](https://www.sportsline.com/nba/expert-projections/simulation/)
- [Daily Fantasy Fuel projections](https://www.dailyfantasyfuel.com/nba/projections/fanduel/)
- [DraftKings public draft groups](https://api.draftkings.com/draftgroups/v1/), its official salary CSV, and [NBA scoring overview](https://dknetwork.draftkings.com/2025/10/17/nba-daily-fantasy-101-how-to-play-dfs-on-draftkings/)
- [Daily Fantasy Fuel DraftKings projections](https://www.dailyfantasyfuel.com/nba/projections/draftkings/)
- [FanDuel scoring rules](https://www.fanduel.com/rules)
- [RotoWire starting lineups](https://www.rotowire.com/basketball/nba-lineups.php)
- [NBA injury reports](https://official.nba.com/nba-injury-report-2026-27-season/)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Independent personal research tool; not affiliated with Yahoo or these data providers.
