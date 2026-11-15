"""Fuel session access and coverage reporting; never serialize credentials."""
import os
from pathlib import Path
import re

from bs4 import BeautifulSoup

FUEL_URLS = {
    'fuel': 'https://www.dailyfantasyfuel.com/nba/projections/fanduel/',
    'fuel_dk': 'https://www.dailyfantasyfuel.com/nba/projections/draftkings/',
}


def session_cookie(url):
    # Exact HTTPS endpoints only: no cookies on Google, other providers, or
    # arbitrary Fuel URLs. The caller must also disable redirects.
    if url not in FUEL_URLS.values():
        return ''
    value = os.environ.get('FUEL_COOKIE', '').strip()
    if value.lower().startswith('cookie:'):
        value = value[7:].strip()
    if value and (not re.fullmatch(r'[\x20-\x7e]+', value) or '=' not in value):
        raise ValueError('FUEL_COOKIE must contain the single-line Cookie request header value from Fuel.')
    return value


def coverage_metadata(html, row_count, failed=False):
    configured = bool(os.environ.get('FUEL_COOKIE', '').strip())
    text = BeautifulSoup(html, 'html.parser').get_text(' ', strip=True)
    restricted = bool(re.search(r'(?:log in or create a free account to see all players|log in to see all)', text, re.I))
    access = 'unavailable' if failed else 'restricted-preview' if restricted else 'unrestricted-page'
    warning = None
    if restricted and not failed:
        action = 'Renew the FUEL_COOKIE repository secret.' if configured else 'Set the FUEL_COOKIE repository secret for signed-in access.'
        warning = f'Fuel returned a login-limited preview ({row_count} players). {action}'
    return {'access': access, 'providerPlayerCount': row_count,
            'sessionConfigured': configured, 'coverageWarning': warning}


def write_coverage_summary(source_info):
    lines = ['## Fantasy Fuel coverage', '', '| Feed | Access | Parsed players |', '| --- | --- | ---: |']
    for name, label in [('fuel', 'FanDuel / Yahoo'), ('fuel_dk', 'DraftKings')]:
        info = source_info[name]
        lines.append(f'| {label} | {info["access"]} | {info["providerPlayerCount"]} |')
        print(f'Fuel {label}: {info["providerPlayerCount"]} players; {info["access"]}', flush=True)
        if info['coverageWarning']:
            print(f'::warning title=Fuel {label} coverage::{info["coverageWarning"]}', flush=True)
    warnings = [f'- {label}: {source_info[name]["coverageWarning"]}'
                for name, label in [('fuel', 'Yahoo'), ('fuel_dk', 'DraftKings')]
                if source_info[name]['coverageWarning']]
    lines += ['', *warnings, '', 'Counts are provider rows before matching each platform’s salary pool.', '']
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with Path(summary).open('a', encoding='utf-8') as handle:
            handle.write('\n'.join(lines) + '\n')
