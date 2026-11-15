import json

import pytest
import requests

from pipeline.fuel_access import FUEL_URLS, coverage_metadata, session_cookie, write_coverage_summary
from pipeline.refresh import fetch, parse_fuel


SECRET = 'AWSELBAuthSessionCookie-0=test-private-session; AWSDFFAuthCheck=test-user'
GATE = '<div>Log In or create a free account to see all players</div>'


def response(status=200, text=''):
    result = requests.Response()
    result.status_code = status
    result._content = text.encode()
    return result


@pytest.mark.parametrize('url', list(FUEL_URLS.values()))
def test_session_is_sent_only_to_exact_fuel_feeds_and_cannot_follow_redirects(monkeypatch, url):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    calls = []
    monkeypatch.setattr('pipeline.refresh.requests.get', lambda u, **kw: calls.append((u, kw)) or response())
    fetch(url)
    assert len(calls) == 1
    assert calls[0][1]['headers']['Cookie'] == SECRET
    assert calls[0][1]['allow_redirects'] is False


@pytest.mark.parametrize('url', [
    'https://www.sportsline.com/nba/expert-projections/simulation/',
    'https://api.draftkings.com/draftgroups/v1/',
    'https://sports.yahoo.com/dailyfantasy/contests/nba',
    'https://accounts.google.com/',
    'http://www.dailyfantasyfuel.com/nba/projections/fanduel/',
    'https://www.dailyfantasyfuel.com.evil.test/nba/projections/fanduel/',
    'https://www.dailyfantasyfuel.com/auth',
])
def test_cookie_never_reaches_other_urls(monkeypatch, url):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    calls = []
    monkeypatch.setattr('pipeline.refresh.requests.get', lambda u, **kw: calls.append(kw) or response())
    fetch(url)
    assert 'Cookie' not in calls[0]['headers']


@pytest.mark.parametrize('status', [302, 307, 401, 403])
def test_rejected_session_recovers_public_preview_without_visiting_login(monkeypatch, status):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    calls = []
    def get(url, **kw):
        calls.append((url, kw))
        r = response(status) if len(calls) == 1 else response(text=GATE)
        r.headers['Location'] = 'https://accounts.google.com/'
        return r
    monkeypatch.setattr('pipeline.refresh.requests.get', get)
    url = FUEL_URLS['fuel_dk']
    result = fetch(url)
    assert [u for u, _ in calls] == [url, url]
    assert all(kw['allow_redirects'] is False for _, kw in calls)
    assert 'Cookie' not in calls[1][1]['headers']
    info = coverage_metadata(result.text, 25)
    assert info['access'] == 'restricted-preview'
    assert 'Renew the FUEL_COOKIE' in info['coverageWarning']
    assert SECRET not in json.dumps(info)


def test_missing_cookie_preserves_public_fetch_and_reports_preview(monkeypatch):
    monkeypatch.delenv('FUEL_COOKIE', raising=False)
    calls = []
    monkeypatch.setattr('pipeline.refresh.requests.get', lambda u, **kw: calls.append(kw) or response(text=GATE))
    fetch(FUEL_URLS['fuel'])
    assert 'Cookie' not in calls[0]['headers']
    info = coverage_metadata(GATE, 25)
    assert not info['sessionConfigured']
    assert 'Set the FUEL_COOKIE' in info['coverageWarning']


@pytest.mark.parametrize('value', [SECRET + '\nOther: secret', SECRET + '\rInjected: value', 'secret-without-cookie-name', 'name=☃'])
def test_invalid_cookie_never_reaches_request_or_error_output(monkeypatch, value):
    monkeypatch.setenv('FUEL_COOKIE', value)
    def unexpected(*a, **kw):
        pytest.fail('Invalid header was sent to HTTP client')
    monkeypatch.setattr('pipeline.refresh.requests.get', unexpected)
    with pytest.raises(ValueError) as exc:
        fetch(FUEL_URLS['fuel'])
    assert value not in str(exc.value)
    assert 'test-private-session' not in str(exc.value)


def test_cookie_header_prefix_is_accepted(monkeypatch):
    monkeypatch.setenv('FUEL_COOKIE', 'Cookie: ' + SECRET)
    assert session_cookie(FUEL_URLS['fuel']) == SECRET


def test_transport_errors_cannot_echo_cookie_into_published_errors(monkeypatch):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    def bad_request(*a, **kw):
        raise requests.exceptions.InvalidHeader(SECRET)
    monkeypatch.setattr('pipeline.refresh.requests.get', bad_request)
    with pytest.raises(ValueError) as exc:
        fetch(FUEL_URLS['fuel'])
    assert SECRET not in str(exc.value)


def test_complete_feed_is_parsed_past_25_with_dates_and_flags_preserved(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    rows = []
    for i in range(153):
        cells = [i, 'PG', f'Player {i}' + (' Q' if i == 152 else ''), '', '', 'GS', 'LAL', '', 30, '', '', '', '', '', '', '']
        rows.append('<tr>' + ''.join(f'<td>{x}</td>' for x in cells) + '</tr>')
    html = "window.platform='draftkings';Updated At: Sun, Nov 15, 2026, 12:48 PM ET<table>" + ''.join(rows) + '</table>'
    parsed, stamp = parse_fuel(html, '2026-11-15', 'draftkings')
    assert len(parsed) == 153 and stamp == '2026-11-15T17:48:00Z'
    assert parsed[('player152', 'GSW')]['badge'] == 'Q'
    with pytest.raises(ValueError, match='another date'):
        parse_fuel(html, '2026-11-16', 'draftkings')
    info = coverage_metadata(html, len(parsed))
    assert info['access'] == 'unrestricted-page' and info['coverageWarning'] is None
    summary = tmp_path / 'summary.md'
    monkeypatch.setenv('GITHUB_STEP_SUMMARY', str(summary))
    write_coverage_summary({'fuel': coverage_metadata(GATE, 25), 'fuel_dk': info})
    output = capsys.readouterr().out + summary.read_text() + json.dumps(info)
    assert '153' in output and '::warning' in output and SECRET not in output


def test_failed_feed_is_unavailable_not_misreported_as_unrestricted(monkeypatch):
    monkeypatch.setenv('FUEL_COOKIE', SECRET)
    info = coverage_metadata('', 0, failed=True)
    assert info['access'] == 'unavailable'
    assert info['providerPlayerCount'] == 0


def test_workflow_passes_fuel_secret_to_refresh_and_reusable_odds_workflow():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    pages = (root / '.github/workflows/pages.yml').read_text()
    odds = (root / '.github/workflows/odds.yml').read_text()
    assert 'FUEL_COOKIE:\n        required: false' in pages
    refresh_step = pages.split('- name: Discover current slates and refresh public inputs')[1].split('- name: Build public site')[0]
    assert 'FUEL_COOKIE: ${{ secrets.FUEL_COOKIE }}' in refresh_step
    assert 'FUEL_COOKIE: ${{ secrets.FUEL_COOKIE }}' in odds
