"""
Company-type classification for forecast policy.

This is a policy layer, not a second growth forecast. It decides which
operating template is appropriate and whether a standard FCFF DCF should run.
"""
from __future__ import annotations

import re
from enum import Enum

from pydantic import BaseModel

from .historical import HistoricalSummary
from .models import Company


class BusinessTemplate(str, Enum):
    IT_SERVICES = "it_services"
    TECHNOLOGY = "technology"
    CONSUMER = "consumer"
    MANUFACTURING = "manufacturing"
    INDUSTRIAL = "industrial"
    ASSET_HEAVY = "asset_heavy"
    ASSET_LIGHT = "asset_light"
    CYCLICAL = "cyclical"
    COMMODITY = "commodity"
    INFRASTRUCTURE = "infrastructure"
    TELECOM = "telecom"
    ENERGY = "energy"
    PHARMA = "pharma"
    PLATFORM = "platform"
    CONGLOMERATE = "conglomerate"
    REAL_ESTATE = "real_estate"
    FINANCIAL = "financial"
    OTHER = "other"


_FINANCIAL = re.compile(
    r"\b(bank|nbfc|insurer|insurance|housing finance|credit services|non.?banking|"
    r"asset management|finance - nbfc|financial services)\b",
    re.I,
)
_REAL_ESTATE = re.compile(r"\b(real estate|realty|developer|homebuilder|property)\b", re.I)
_PLATFORM = re.compile(
    r"\b(e-?commerce|internet|online|food delivery|quick commerce|marketplace|"
    r"platform|web aggregator|restaurants?|qsr)\b",
    re.I,
)
_TELECOM = re.compile(r"\b(telecom|telecommunication|wireless|cellular)\b", re.I)
_INFRA = re.compile(
    r"\b(infrastructure|port|ports|logistics|airport|toll|highway|warehouse)\b",
    re.I,
)
_PHARMA = re.compile(r"\b(pharma|pharmaceuticals?|drugs?|biotechs?|biotechnology)\b", re.I)
_ENERGY = re.compile(
    r"\b(power generation|power -|power\b|utilities|oil|natural gas|"
    r"energy|electric|refiner(?:y|ies)?|exploration|petroleum|consumable fuels)\b",
    re.I,
)
_CONGLOMERATE = re.compile(r"\b(conglomerate|diversified|holding company)\b", re.I)
_IT = re.compile(r"\b(software|it[- ]?services|information technology|saas|cloud|it -)\b", re.I)
_CONSUMER = re.compile(
    r"\b(consumer|fmcg|packaged foods|beverages?|retail|personal care|household|"
    r"tobacco|cigarettes?|jewellery|jewelry|watches)\b",
    re.I,
)
_MANUFACTURING = re.compile(
    r"\b(auto|automobile|automotive|cars|vehicles|steel|cement|chemical|industrial|"
    r"manufacturing|engineering|metals|mining|construction)\b",
    re.I,
)
_CYCLICAL_INDUSTRY = re.compile(
    r"\b(steel|auto|automobile|automotive|cars|vehicles|cement|commodity|mining|"
    r"metals|aluminium|aluminum|fertilizers?|agrochemicals?|agro.?chem)\b",
    re.I,
)


class CompanyProfile(BaseModel):
    template: BusinessTemplate
    asset_intensity: str  # heavy | light | mixed
    fcff_appropriate: bool
    fcff_block_reason: str | None = None
    capex_policy: str
    rationale: str
    sector: str = "other"


def classify_company(company: Company, summary: HistoricalSummary) -> CompanyProfile:
    industry = company.industry or ""
    capex = summary.avg_capex_pct_revenue
    da = summary.avg_da_pct_revenue
    capex_to_da = (capex / da) if da and da > 1e-9 else None
    heavy = capex >= 0.08 or (capex_to_da is not None and capex_to_da >= 1.5)
    light = capex <= 0.04 and not heavy
    expansion = capex_to_da is not None and capex_to_da >= 1.3 and (
        (summary.last_1y_growth or 0) > 0.08 or (summary.revenue_cagr_3y or 0) > 0.08
    )

    if _FINANCIAL.search(industry):
        return CompanyProfile(
            template=BusinessTemplate.FINANCIAL,
            sector="financial",
            asset_intensity="mixed",
            fcff_appropriate=False,
            fcff_block_reason="Financial institutions are not valued with a standard corporate FCFF DCF.",
            capex_policy="n/a",
            rationale="Industry label indicates a bank, NBFC, or insurer. Use an excess-return or dividend model.",
        )
    if _REAL_ESTATE.search(industry) or (
        summary.years and summary.years[-1].nwc_pct_revenue > 1.0
    ):
        return CompanyProfile(
            template=BusinessTemplate.REAL_ESTATE,
            sector="real_estate",
            asset_intensity="heavy",
            fcff_appropriate=False,
            fcff_block_reason="Real-estate / land-bank economics usually need project-level or NAV analysis.",
            capex_policy="maintain_historical",
            rationale="Working capital or industry label indicates a developer. A consolidated FCFF DCF is a lower-bound check only.",
        )

    if _PLATFORM.search(industry):
        template = BusinessTemplate.PLATFORM
        sector = "platform"
        intensity = "light" if light else "mixed"
        capex_policy = "fade_growth_with_revenue" if expansion else "glide_to_da"
    elif _TELECOM.search(industry):
        template = BusinessTemplate.TELECOM
        sector = "telecom"
        intensity = "heavy"
        capex_policy = "fade_growth_with_revenue"
    elif _INFRA.search(industry):
        template = BusinessTemplate.INFRASTRUCTURE
        sector = "infrastructure"
        intensity = "heavy"
        capex_policy = "fade_growth_with_revenue"
    elif _PHARMA.search(industry):
        template = BusinessTemplate.PHARMA
        sector = "pharma"
        intensity = "mixed" if heavy else "light"
        capex_policy = "glide_to_da" if light else "partial_normalize"
    elif _ENERGY.search(industry):
        template = BusinessTemplate.ENERGY
        sector = "energy"
        intensity = "heavy"
        capex_policy = "maintain_historical"
    elif _CONGLOMERATE.search(industry):
        template = BusinessTemplate.CONGLOMERATE
        sector = "conglomerate"
        intensity = "mixed"
        capex_policy = "partial_normalize"
    elif _IT.search(industry):
        template = BusinessTemplate.IT_SERVICES
        sector = "technology"
        intensity = "light"
        capex_policy = "glide_to_da"
    elif _CONSUMER.search(industry):
        template = BusinessTemplate.CONSUMER
        sector = "consumer"
        intensity = "light" if light else "mixed"
        capex_policy = "glide_to_da" if light else "partial_normalize"
    elif _MANUFACTURING.search(industry) or heavy:
        template = BusinessTemplate.MANUFACTURING if _MANUFACTURING.search(industry) else BusinessTemplate.ASSET_HEAVY
        sector = "industrial"
        intensity = "heavy"
        capex_policy = "fade_growth_with_revenue" if expansion else "maintain_with_da_floor"
    elif light:
        template = BusinessTemplate.ASSET_LIGHT
        sector = "other"
        intensity = "light"
        capex_policy = "glide_to_da"
    else:
        template = BusinessTemplate.OTHER
        sector = "other"
        intensity = "mixed"
        capex_policy = "partial_normalize"

    if _CYCLICAL_INDUSTRY.search(industry):
        template = BusinessTemplate.CYCLICAL
        sector = "commodity"
        if intensity == "light":
            intensity = "mixed"
        if capex_policy == "glide_to_da":
            capex_policy = "maintain_with_da_floor"

    if (
        re.search(r"consumer discretionary", industry, re.I)
        and ((summary.revenue_cagr_3y or 0) > 0.40 or (summary.last_1y_growth or 0) > 0.40)
    ):
        template = BusinessTemplate.PLATFORM
        sector = "platform"
        intensity = "mixed"
        capex_policy = "fade_growth_with_revenue" if expansion else "glide_to_da"

    return CompanyProfile(
        template=template,
        sector=sector,
        asset_intensity=intensity,
        fcff_appropriate=True,
        capex_policy=capex_policy,
        rationale=(
            f"Template {template.value} / sector {sector} from industry '{industry or 'unspecified'}' "
            f"(capex {capex:.1%} of revenue, D&A {da:.1%}). Capex policy: {capex_policy}."
        ),
    )
