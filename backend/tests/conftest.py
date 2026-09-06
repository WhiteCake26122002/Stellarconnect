import pytest

from ..data.sample_company import build_orion_company, build_orion_historicals
from ..data.sample_wacc import build_orion_wacc_inputs
from ..engine.forecast import build_default_assumptions, project_financials
from ..engine.historical import analyze_historicals
from ..engine.wacc import calculate_wacc


@pytest.fixture
def company():
    return build_orion_company()


@pytest.fixture
def hist():
    return build_orion_historicals()


@pytest.fixture
def summary(hist):
    return analyze_historicals(hist)


@pytest.fixture
def assumptions(hist, summary):
    return build_default_assumptions(hist, summary, forecast_years=5, long_term_growth_rate=0.04)


@pytest.fixture
def forecast(hist, assumptions):
    return project_financials(hist, assumptions)


@pytest.fixture
def wacc_inputs(hist, company):
    return build_orion_wacc_inputs(hist, company.current_share_price, company.diluted_shares_outstanding)


@pytest.fixture
def wacc_result(wacc_inputs):
    return calculate_wacc(wacc_inputs)
