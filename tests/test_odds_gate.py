from datetime import datetime, timezone

import pytest

from pipeline.odds_gate import decision

NOW = datetime(2026, 10, 28, 22, tzinfo=timezone.utc)  # 3 pm Pacific
ENV = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': 'jimrong79/yahoo-dfs-slate-lab',
       'GITHUB_REF': 'refs/heads/main', 'GITHUB_WORKFLOW': 'Refresh betting odds (manual)',
       'GITHUB_ACTOR': 'jimrong79', 'GITHUB_ACTOR_ID': '14351098', 'GITHUB_TRIGGERING_ACTOR': 'jimrong79',
       'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_RUN_ID': '100'}


def run(id=99, created='2026-10-28T21:00:00Z', **kwargs):
    return {'id': id, 'created_at': created, 'head_branch': 'main', 'actor': {'id': 14351098}, **kwargs}


def test_first_daily_manual_run_allowed_and_newer_queued_run_does_not_block_it():
    assert decision(ENV, NOW, lambda start, page: [run(100), run(101)])[0]


@pytest.mark.parametrize('state', ['success', 'failure', 'cancelled', None])
def test_prior_daily_attempt_blocks_repeat_even_if_it_did_not_finish(state):
    allowed, reason = decision(ENV, NOW, lambda start, page: [run(conclusion=state)])
    assert not allowed and 'already requested today' in reason


def test_other_branch_actor_and_skipped_runs_cannot_consume_the_daily_slot():
    records = [run(head_branch='feature'), run(actor={'id': 1}), run(conclusion='skipped')]
    assert decision(ENV, NOW, lambda start, page: records)[0]


@pytest.mark.parametrize('field,value', [('GITHUB_EVENT_NAME','schedule'), ('GITHUB_EVENT_NAME','push'),
    ('GITHUB_WORKFLOW','Refresh NBA slates and publish'), ('GITHUB_REF','refs/heads/feature'),
    ('GITHUB_ACTOR','someone-else'), ('GITHUB_ACTOR_ID','1'), ('GITHUB_TRIGGERING_ACTOR','someone-else'),
    ('GITHUB_REPOSITORY','someone-else/fork'), ('GITHUB_RUN_ATTEMPT','2')])
def test_original_workflow_wrong_owner_forks_and_reruns_cannot_authorize_odds(field, value):
    def unexpected(*args):
        raise AssertionError('Denied requests must not query history')
    assert not decision({**ENV, field:value}, NOW, unexpected)[0]


def test_daily_boundary_uses_pacific_time_and_handles_daylight_saving():
    observed=[]
    def yesterday(start,page):
        observed.append(start)
        return [run(created='2026-10-28T06:59:59Z')]
    assert decision(ENV, NOW, yesterday)[0]
    assert observed == [datetime(2026,10,28,7,tzinfo=timezone.utc)]
    assert not decision(ENV, NOW, lambda start,page:[run(created='2026-10-28T07:00:00Z')])[0]
    observed.clear()
    winter=datetime(2026,11,3,23,tzinfo=timezone.utc)
    assert decision(ENV,winter,yesterday)[0]
    assert observed[0] == datetime(2026,11,3,8,tzinfo=timezone.utc)


def test_guard_checks_pagination_and_fails_closed_on_unreadable_history():
    calls=[]
    def history(start,page):
        calls.append(page)
        return [run(101+i) for i in range(100)] if page==1 else [run()]
    assert not decision(ENV,NOW,history)[0]
    assert calls == [1,2]
    with pytest.raises(ValueError):
        decision(ENV,NOW,lambda start,page:{})


def test_main_failure_does_not_authorize_or_expose_github_token(monkeypatch,tmp_path,capsys):
    from pipeline import odds_gate
    for name,value in ENV.items():monkeypatch.setenv(name,value)
    output=tmp_path/'output';summary=tmp_path/'summary'
    monkeypatch.setenv('GITHUB_OUTPUT',str(output));monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(summary))
    def broken(*args):raise RuntimeError('private-token-value')
    monkeypatch.setattr(odds_gate,'github_runs',broken)
    assert odds_gate.main()==1
    assert not output.exists()
    assert 'private-token-value' not in capsys.readouterr().out


def test_main_writes_explicit_boolean_authorization(monkeypatch,tmp_path):
    from pipeline import odds_gate
    for name,value in ENV.items():monkeypatch.setenv(name,value)
    output=tmp_path/'output';summary=tmp_path/'summary'
    monkeypatch.setenv('GITHUB_OUTPUT',str(output));monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(summary))
    monkeypatch.setattr(odds_gate,'github_runs',lambda start,page:[])
    assert odds_gate.main()==0
    assert output.read_text()=='enabled=true\n'
    assert 'first owner-requested' in summary.read_text()
