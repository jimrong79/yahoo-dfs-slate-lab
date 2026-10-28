import csv
import json
import os
from pathlib import Path

import pytest

from pipeline.results import cents, merge_exports, public_report

NOW = '2026-10-28T12:00:00+00:00'


def dk(entry='100', **updates):
    return {'Sport':'NBA','Entry_Key':entry,'Entry':'NBA $2 Single Entry Double Up',
            'Contest_Key':'999','Contest_Date_EST':'2026-10-25 19:00:00',
            'Entry_Fee':'$2.00','Winnings_Non_Ticket':'$4.00','Winnings_Ticket':'$0.00',**updates}


def yahoo(entry='100', **updates):
    return {'Start Date':'10/25/2026','Sport':'NBA','Id':'888','Title':'NBA $2 10-Team 50/50',
            'Entry Id':entry,'Status':'resolved','Entry Fee':'$2.00','Winnings':'$0.00',**updates}


def write(path, rows, mtime=1_000_000_000):
    with path.open('w',newline='',encoding='utf-8-sig') as handle:
        writer=csv.DictWriter(handle,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    os.utime(path, ns=(mtime,mtime))
    return path


def metrics(report, field):
    return sum(row[field] for row in report['daily'])


def test_repeat_exports_do_not_double_count_and_platform_ids_are_separate(tmp_path):
    paths=[write(tmp_path/'dk.csv',[dk(),dk('101')]),write(tmp_path/'yahoo.csv',[yahoo()])]
    ledger=merge_exports(paths,now=NOW)
    again=merge_exports(paths,existing=ledger,now=NOW)
    assert len(again['entries'])==3
    assert public_report(again)==public_report(ledger)
    assert metrics(public_report(again),'feesCents')==600
    assert metrics(public_report(again),'payoutsCents')==800
    assert metrics(public_report(again),'cashed')==2


def test_new_export_corrects_payout_and_retains_old_unseen_dates(tmp_path):
    old=write(tmp_path/'old.csv',[dk(),dk('101',Contest_Date_EST='2026-10-22 19:00:00')])
    ledger=merge_exports([old],now=NOW)
    new=write(tmp_path/'new.csv',[dk(Winnings_Non_Ticket='$3.50')],mtime=2_000_000_000)
    revised=merge_exports([new],existing=ledger,now=NOW)
    assert metrics(public_report(revised),'entries')==2
    assert metrics(public_report(revised),'payoutsCents')==750
    # Re-reading an older download must not undo the later settlement correction.
    assert metrics(public_report(merge_exports([old],existing=revised,now=NOW)),'payoutsCents')==750


def test_unsettled_or_cancelled_yahoo_entries_do_not_count_as_losses(tmp_path):
    path=write(tmp_path/'yahoo.csv',[yahoo(),yahoo('101',Status='live',Winnings=''),yahoo('102',Status='cancelled')])
    ledger=merge_exports([path],now=NOW)
    assert len(ledger['entries'])==3
    assert metrics(public_report(ledger),'entries')==1
    # Later cancellation removes a previously recorded result from aggregates.
    write(path,[yahoo(Status='cancelled')],mtime=2_000_000_000)
    revised=merge_exports([path],existing=ledger,now=NOW)
    with pytest.raises(ValueError,match='No settled'):public_report(revised)


def test_filters_old_seasons_other_sports_and_explicit_report_end(tmp_path):
    path=write(tmp_path/'dk.csv',[dk(),dk('101',Sport='NFL'),dk('102',Contest_Date_EST='2025-02-12 19:00:00'),dk('103',Contest_Date_EST='2026-10-27 19:00:00')])
    ledger=merge_exports([path],now=NOW)
    assert len(ledger['entries'])==2
    assert metrics(public_report(ledger,'2026-10-25'),'entries')==1
    assert public_report(ledger)['through']=='2026-10-27'


def test_non_cash_prizes_are_separate_and_title_does_not_assign_model(tmp_path):
    path=write(tmp_path/'dk.csv',[dk(Entry='NBA $10 ticket qualifier',Winnings_Non_Ticket='$0.00',Winnings_Ticket='$20.00')])
    ledger=merge_exports([path],now=NOW);report=public_report(ledger)
    assert metrics(report,'payoutsCents')==0
    assert metrics(report,'ticketCents')==2000
    assert metrics(report,'cashed')==0
    assert report['daily'][0]['contestType']=='Other'
    assert ledger['entries']['draftkings:100']['projectionMode']=='unknown'


def test_public_report_is_only_whitelisted_aggregates(tmp_path):
    path=write(tmp_path/'personal-secret-filename.csv',[dk(entry='123456789',Entry='Private contest title')])
    report=public_report(merge_exports([path],now=NOW))
    text=json.dumps(report)
    for private in ('123456789','999','personal-secret-filename','Private contest title','projectionMode','sourceModifiedNs','entryId'):
        assert private not in text
    assert set(report)=={'schemaVersion','updatedAt','through','seasonStart','currency','coverage','daily'}
    assert set(report['daily'][0])=={'date','platform','contestType','entries','cashed','feesCents','payoutsCents','ticketCents'}


@pytest.mark.parametrize('bad',['NaN','Infinity','-$1.00','$1.001','$1,23.00','',None])
def test_bad_money_is_rejected(bad):
    with pytest.raises(ValueError):cents(bad)


def test_money_is_exact_and_csv_quoting_is_respected(tmp_path):
    assert cents('$1,234.56')==123456
    path=write(tmp_path/'yahoo.csv',[yahoo(Title='NBA $1,111 Guaranteed [$150 to 1st]',Winnings='$2.70',**{'Entry Fee':'$0.50'})])
    report=public_report(merge_exports([path],now=NOW))
    assert metrics(report,'feesCents')==50
    assert metrics(report,'payoutsCents')==270


def test_conflicting_duplicates_and_damaged_exports_fail_before_publishing(tmp_path):
    path=write(tmp_path/'bad.csv',[dk(),dk(Winnings_Non_Ticket='$7.00')])
    with pytest.raises(ValueError,match='conflicting'):merge_exports([path],now=NOW)
    path.write_text('Sport,Entry_Key\nNBA,100\n')
    with pytest.raises(ValueError,match='missing required'):merge_exports([path],now=NOW)


def test_normalized_reports_are_not_accidentally_reimported(tmp_path):
    derived=write(tmp_path/'derived.csv',[{'platform':'Yahoo','entry_id':'100','payout_usd':'4.00'}])
    raw=write(tmp_path/'raw.csv',[dk()])
    assert metrics(public_report(merge_exports([derived,raw],now=NOW)),'entries')==1


def test_committed_report_has_no_private_keys_and_totals_are_consistent():
    report=json.loads((Path(__file__).resolve().parents[1]/'public/data/results.json').read_text())
    assert set(report)=={'schemaVersion','updatedAt','through','seasonStart','currency','coverage','daily'}
    seen=set()
    for row in report['daily']:
        assert set(row)=={'date','platform','contestType','entries','cashed','feesCents','payoutsCents','ticketCents'}
        key=(row['date'],row['platform'],row['contestType']);assert key not in seen;seen.add(key)
        assert 0<=row['cashed']<=row['entries']
        assert all(type(row[k]) is int and row[k]>=0 for k in ('entries','cashed','feesCents','payoutsCents','ticketCents'))
