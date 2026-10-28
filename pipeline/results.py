"""Merge local contest exports; publish only aggregate NBA performance.

No account access or odds requests. Entry identities stay in contest-history/.
"""
import argparse
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = ('draftkings', 'yahoo')
TYPES = ('Double-up', '50/50', 'Tournament', 'Small-field group', 'Other')
DK_COLUMNS = {'Sport', 'Entry_Key', 'Entry', 'Contest_Key', 'Contest_Date_EST',
              'Winnings_Non_Ticket', 'Winnings_Ticket', 'Entry_Fee'}
YAHOO_COLUMNS = {'Start Date', 'Sport', 'Id', 'Title', 'Entry Id', 'Status',
                 'Entry Fee', 'Winnings'}
METRICS = ('entries', 'cashed', 'feesCents', 'payoutsCents', 'ticketCents')


def cents(value):
    if not isinstance(value, str) or not re.fullmatch(r'\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?', value.strip()):
        raise ValueError('Invalid monetary value in contest export')
    try:
        amount = Decimal(value.strip().replace('$', '').replace(',', '')) * 100
    except InvalidOperation as exc:
        raise ValueError('Invalid monetary value in contest export') from exc
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
        raise ValueError('Invalid monetary value in contest export')
    return int(amount)


def contest_type(title):
    text = title.lower()
    if 'double up' in text or 'double-up' in text:
        return 'Double-up'
    if '50/50' in text or '50-50' in text:
        return '50/50'
    if 'group' in text:
        return 'Small-field group'
    if any(word in text for word in ('head-to-head', 'head to head', 'triple up', 'qualifier', 'satellite', 'ticket')):
        return 'Other'
    if 'guaranteed' in text or '$' in text:
        return 'Tournament'
    return 'Other'


def parse_export(path, season_start):
    """Return None for unrelated CSVs; fail on malformed recognized exports."""
    with path.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        platform = 'draftkings' if DK_COLUMNS <= columns else 'yahoo' if YAHOO_COLUMNS <= columns else None
        if platform is None:
            # Never silently skip a truncated file with a recognizable source ID.
            if 'Entry_Key' in columns or {'Entry Id', 'Winnings'} <= columns:
                raise ValueError(f'{path.name}: contest export is missing required columns')
            return None
        entries = {}
        for line, row in enumerate(reader, 2):
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'{path.name}:{line}: malformed CSV row')
            if row['Sport'].strip().upper() != 'NBA':
                continue
            raw_date = row['Contest_Date_EST'] if platform == 'draftkings' else row['Start Date']
            fmt = '%Y-%m-%d %H:%M:%S' if platform == 'draftkings' else '%m/%d/%Y'
            day = datetime.strptime(raw_date, fmt).date()
            if day < season_start:
                continue
            entry_id = row['Entry_Key'] if platform == 'draftkings' else row['Entry Id']
            if not re.fullmatch(r'\d+', entry_id):
                raise ValueError(f'{path.name}:{line}: invalid entry identity')
            title = row['Entry'] if platform == 'draftkings' else row['Title']
            settled = platform == 'draftkings' or row['Status'].strip().lower() == 'resolved'
            entry = {
                'platform': platform, 'entryId': entry_id, 'date': day.isoformat(),
                'contestType': contest_type(title), 'settled': settled,
                'feesCents': cents(row['Entry_Fee'] if platform == 'draftkings' else row['Entry Fee']),
                'payoutsCents': cents(row['Winnings_Non_Ticket'] if platform == 'draftkings' else row['Winnings']) if settled else 0,
                'ticketCents': cents(row['Winnings_Ticket']) if platform == 'draftkings' and settled else 0,
                # The payout format is never used to infer a projection mode.
                'projectionMode': 'unknown',
            }
            key = f'{platform}:{entry_id}'
            if key in entries and entries[key] != entry:
                raise ValueError(f'{path.name}:{line}: conflicting copies of one entry')
            entries[key] = entry
    return platform, entries


def validate_entry(entry):
    if entry.get('platform') not in PLATFORMS or entry.get('contestType') not in TYPES:
        raise ValueError('Invalid ledger category')
    date.fromisoformat(entry['date'])
    if not re.fullmatch(r'\d+', entry.get('entryId', '')) or type(entry.get('settled')) is not bool:
        raise ValueError('Invalid ledger identity/status')
    for field in ('feesCents', 'payoutsCents', 'ticketCents'):
        if type(entry.get(field)) is not int or not 0 <= entry[field] <= 10**12:
            raise ValueError('Invalid ledger money')


def public_report(ledger, through=None):
    entries = list(ledger['entries'].values())
    for entry in entries:
        validate_entry(entry)
    settled = [e for e in entries if e['settled'] and e['date'] >= ledger['seasonStart']]
    if not settled:
        raise ValueError('No settled NBA entries to report')
    through = through or max(e['date'] for e in settled)
    date.fromisoformat(through)
    settled = [e for e in settled if e['date'] <= through]
    if not settled:
        raise ValueError('No settled entries through the requested date')
    groups = {}
    for entry in settled:
        key = (entry['date'], entry['platform'], entry['contestType'])
        group = groups.setdefault(key, dict(zip(('date', 'platform', 'contestType'), key)) | {k: 0 for k in METRICS})
        group['entries'] += 1
        group['cashed'] += int(entry['payoutsCents'] > 0)
        for field in ('feesCents', 'payoutsCents', 'ticketCents'):
            group[field] += entry[field]
    coverage = []
    for platform in PLATFORMS:
        dates = [e['date'] for e in settled if e['platform'] == platform]
        if dates:
            coverage.append({'platform': platform, 'firstDate': min(dates), 'lastDate': max(dates),
                             'importedAt': ledger['imports'][platform]['importedAt']})
    # Explicit whitelist: no raw rows, source filenames, names, IDs, scores or modes.
    return {'schemaVersion': 1, 'updatedAt': ledger['updatedAt'], 'through': through,
            'seasonStart': ledger['seasonStart'], 'currency': 'USD',
            'coverage': coverage, 'daily': [groups[k] for k in sorted(groups)]}


def merge_exports(paths, existing=None, season_start='2026-10-20', now=None):
    start = date.fromisoformat(season_start)
    now = now or datetime.now(timezone.utc).isoformat()
    ledger = json.loads(json.dumps(existing)) if existing else {
        'schemaVersion': 1, 'seasonStart': season_start, 'entries': {}, 'imports': {}}
    if ledger.get('schemaVersion') != 1 or ledger.get('seasonStart') != season_start:
        raise ValueError('Ledger season/schema mismatch; use a separate ledger for a new season')
    for key, entry in ledger['entries'].items():
        validate_entry(entry)
        if key != f"{entry['platform']}:{entry['entryId']}":
            raise ValueError('Ledger identity mismatch')
    recognized = 0
    for path in paths:
        parsed = parse_export(Path(path), start)
        if parsed is None:
            continue
        recognized += 1
        platform, entries = parsed
        source_modified = Path(path).stat().st_mtime_ns
        for key, value in entries.items():
            previous = ledger['entries'].get(key, {})
            if previous.get('sourceModifiedNs', 0) > source_modified:
                continue
            # Preserve manually supplied provenance, but never invent it.
            value['projectionMode'] = previous.get('projectionMode', 'unknown')
            value['sourceModifiedNs'] = source_modified
            ledger['entries'][key] = value
        ledger['imports'][platform] = {'importedAt': now, 'sourceFile': Path(path).name}
    if not recognized:
        raise ValueError('No DraftKings/Yahoo source exports found')
    ledger['updatedAt'] = now
    return ledger


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', nargs='+', type=Path, help='Exports in oldest-to-newest order; defaults to source CSVs in contest-history')
    parser.add_argument('--ledger', type=Path, default=ROOT/'contest-history/results-ledger.json')
    parser.add_argument('--output', type=Path, default=ROOT/'public/data/results.json')
    parser.add_argument('--season-start', default='2026-10-20')
    parser.add_argument('--through', help='Last included contest date, YYYY-MM-DD; defaults to latest settled date')
    args = parser.parse_args()
    paths = args.input or sorted((ROOT/'contest-history').glob('*.csv'), key=lambda p: (p.stat().st_mtime_ns, p.name))
    existing = json.loads(args.ledger.read_text()) if args.ledger.exists() else None
    ledger = merge_exports(paths, existing, args.season_start)
    report = public_report(ledger, args.through)
    write_json(args.ledger, ledger)
    write_json(args.output, report)
    count = sum(row['entries'] for row in report['daily'])
    print(f'Prepared {count} settled NBA entries as {len(report["daily"])} aggregate groups through {report["through"]}.')
    print('Raw exports and the entry ledger stay local. Review the aggregate report before committing it.')


if __name__ == '__main__':
    main()
