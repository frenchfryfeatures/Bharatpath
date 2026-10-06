"""Every limit is in one table, and the table keeps its promises.

Plan Day 20: rate limits per user, per tenant and per IP, **tightest on OTP
and the threshold preview**. The last clause is the one that erodes: somebody
adds a limit for a new route, picks a small number, and the two limits that
guard money and a score quietly stop being the tightest -- which matters only
because they were set tight on purpose.
"""

from __future__ import annotations

from app.core.ratelimit import Scope, policies
from app.settings import Settings


def test_otp_and_the_threshold_preview_are_the_tightest_limits() -> None:
    table = policies(Settings())
    # Anonymous model calls intentionally share the strict cost-control tier.
    guarded = {"otp.phone", "otp.ip", "jobs.threshold_preview", "resume.preview"}
    loosest_guarded = max(table[name].per_hour for name in guarded)
    tighter = sorted(
        name
        for name, policy in table.items()
        if name not in guarded and policy.per_hour <= loosest_guarded
    )
    assert not tighter, (
        f"{tighter} are as tight as OTP or the threshold preview. If that is deliberate, "
        "say so here; if not, loosen them."
    )


def test_all_three_scopes_the_plan_names_are_limited() -> None:
    scopes = {policy.scope for policy in policies(Settings()).values()}
    assert {Scope.USER, Scope.TENANT, Scope.IP} <= scopes


def test_only_the_global_tier_fails_open() -> None:
    for name, policy in policies(Settings()).items():
        assert policy.fail_open is name.startswith("global."), (
            f"{name}: a specific limit guards money or a leak and must fail closed; "
            "a global one must not take the API down with Redis"
        )


def test_a_tenant_shares_more_than_a_user_gets() -> None:
    table = policies(Settings())
    assert table["global.tenant"].limit > table["global.user"].limit
