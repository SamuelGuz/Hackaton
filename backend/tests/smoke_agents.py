"""Smoke tests for the agents — see CONTRACTS.md section 2.5.10."""

from __future__ import annotations

import os

import pytest

from backend.agents.crystal_ball import run_crystal_ball
from backend.agents.expansion import run_expansion

TEST_ACCOUNT_ID = os.environ.get("TEST_ACCOUNT_ID")


def test_crystal_ball_completes() -> None:
    if not TEST_ACCOUNT_ID:
        pytest.skip("TEST_ACCOUNT_ID env var not set")

    response = run_crystal_ball(TEST_ACCOUNT_ID, force_refresh=True)
    assert response.churn_risk_score is not None
    assert 0 <= response.churn_risk_score <= 100
    assert len(response.top_signals) >= 1
    assert response.confidence is not None


def test_expansion_completes() -> None:
    if not TEST_ACCOUNT_ID:
        pytest.skip("TEST_ACCOUNT_ID env var not set")

    response = run_expansion(TEST_ACCOUNT_ID, force_refresh=True)
    assert response.expansion_score is not None
    assert 0 <= response.expansion_score <= 100
    assert response.recommended_plan in {"starter", "growth", "business", "enterprise"}
    assert isinstance(response.ready_to_expand, bool)
