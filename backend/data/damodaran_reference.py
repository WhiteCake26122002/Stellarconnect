"""
Parses Aswath Damodaran's (NYU Stern) publicly-published reference datasets to
provide automated, sourced WACC defaults instead of requiring manual entry of
beta, equity risk premium, and tax rate (spec sections 13, 18-19).

Bundled files (backend/data/reference/):
  - betaIndia.xls        Levered/unlevered beta by industry, India-listed firms
  - totalbetaIndia.xls   Total beta (small-cap/private-company adjusted) by industry, India
  - histgrIndia.xls      Historical and expected revenue/EPS growth by industry, India
  - countrytaxrates.xls  Marginal corporate tax rate by country
    - ctryprem.xlsx         Country equity risk premium (ERP) by country

Nothing here is fabricated: every value returned is read directly out of these
workbooks and matched to the requested industry/country via fuzzy text
matching (rapidfuzz), never guessed or hardcoded.
"""
from __future__ import annotations

import functools
from pathlib import Path

import pandas as pd
from pydantic import BaseModel
from rapidfuzz import fuzz, process

REFERENCE_DIR = Path(__file__).parent / "reference"


class SectorBetaMatch(BaseModel):
    matched_industry: str
    match_score: float
    low_confidence: bool
    num_firms: int
    levered_beta: float
    unlevered_beta: float
    d_e_ratio: float
    effective_tax_rate: float
    total_beta: float | None = None
    total_unlevered_beta: float | None = None


# Curated mapping from common data-provider sector/industry labels (e.g. Yahoo
# Finance's GICS-derived `sector`/`industry` fields) straight to Damodaran's
# India industry categories. Checked first, before falling back to fuzzy
# text matching, because free-text fuzzy matching on short category names
# ties or misfires often enough (e.g. "Oil & Gas Refining & Marketing" fuzzy
# matches to "Metals & Mining") that it cannot be trusted alone for a number
# that materially affects WACC.
INDUSTRY_ALIASES: dict[str, str] = {
    "information technology services": "Computer Services",
    "computers - software & consulting": "Computer Services",
    "computers—software & consulting": "Computer Services",
    "software - infrastructure": "Software (System & Application)",
    "software - application": "Software (System & Application)",
    "software—infrastructure": "Software (System & Application)",
    "software—application": "Software (System & Application)",
    "internet content & information": "Software (Internet)",
    "semiconductors": "Semiconductor",
    "semiconductor equipment & materials": "Semiconductor Equip",
    "consumer electronics": "Electronics (Consumer & Office)",
    "computer hardware": "Computers/Peripherals",
    "communication equipment": "Telecom. Equipment",
    "telecom services": "Telecom. Services",
    "technology": "Computer Services",
    "banks - regional": "Banks (Regional)",
    "banks—regional": "Banks (Regional)",
    "banks - diversified": "Bank (Money Center)",
    "banks—diversified": "Bank (Money Center)",
    "financial services": "Financial Svcs. (Non-bank & Insurance)",
    "asset management": "Investments & Asset Management",
    "capital markets": "Brokerage & Investment Banking",
    "insurance - life": "Insurance (Life)",
    "insurance - property & casualty": "Insurance (Prop/Cas.)",
    "insurance - diversified": "Insurance (General)",
    "insurance - reinsurance": "Reinsurance",
    "oil & gas integrated": "Oil/Gas (Integrated)",
    "oil & gas e&p": "Oil/Gas (Production and Exploration)",
    "oil & gas refining & marketing": "Oil/Gas Distribution",
    "oil & gas equipment & services": "Oilfield Svcs/Equip.",
    "oil & gas midstream": "Oil/Gas Distribution",
    "thermal coal": "Coal & Related Energy",
    "utilities - regulated electric": "Utility (General)",
    "utilities - regulated water": "Utility (Water)",
    "utilities - renewable": "Green & Renewable Energy",
    "solar": "Green & Renewable Energy",
    "specialty chemicals": "Chemical (Specialty)",
    "chemicals": "Chemical (Diversified)",
    "agricultural inputs": "Farming/Agriculture",
    "steel": "Steel",
    "aluminum": "Metals & Mining",
    "other industrial metals & mining": "Metals & Mining",
    "gold": "Precious Metals",
    "copper": "Metals & Mining",
    "building materials": "Building Materials",
    "building products & equipment": "Construction Supplies",
    "engineering & construction": "Engineering/Construction",
    "farm & heavy construction machinery": "Machinery",
    "industrial machinery": "Machinery",
    "electrical equipment & parts": "Electrical Equipment",
    "specialty industrial machinery": "Machinery",
    "aerospace & defense": "Aerospace/Defense",
    "railroads": "Transportation (Railroads)",
    "trucking": "Trucking",
    "airlines": "Air Transport",
    "marine shipping": "Shipbuilding & Marine",
    "integrated freight & logistics": "Transportation",
    "auto manufacturers": "Auto & Truck",
    "auto parts": "Auto Parts",
    "auto & truck dealerships": "Retail (Automotive)",
    "farm products": "Farming/Agriculture",
    "packaged foods": "Food Processing",
    "food distribution": "Food Wholesalers",
    "beverages - non-alcoholic": "Beverage (Soft)",
    "beverages - wineries & distilleries": "Beverage (Alcoholic)",
    "beverages - brewers": "Beverage (Alcoholic)",
    "tobacco": "Tobacco",
    "household & personal products": "Household Products",
    "packaging & containers": "Packaging & Container",
    "textile manufacturing": "Apparel",
    "apparel manufacturing": "Apparel",
    "apparel retail": "Retail (Special Lines)",
    "footwear & accessories": "Shoe",
    "furnishings, fixtures & appliances": "Furn/Home Furnishings",
    "specialty retail": "Retail (Special Lines)",
    "grocery stores": "Retail (Grocery and Food)",
    "discount stores": "Retail (General)",
    "department stores": "Retail (General)",
    "internet retail": "Retail (Distributors)",
    "restaurants": "Restaurant/Dining",
    "lodging": "Hotel/Gaming",
    "resorts & casinos": "Hotel/Gaming",
    "gambling": "Hotel/Gaming",
    "travel services": "Recreation",
    "entertainment": "Entertainment",
    "broadcasting": "Broadcasting",
    "electronic gaming & multimedia": "Software (Entertainment)",
    "publishing": "Publishing & Newspapers",
    "advertising agencies": "Advertising",
    "real estate services": "Real Estate (Operations & Services)",
    "real estate - development": "Real Estate (Development)",
    "real estate - diversified": "Real Estate (General/Diversified)",
    "reit - residential": "R.E.I.T.",
    "reit - retail": "Retail (REITs)",
    "reit - office": "R.E.I.T.",
    "reit - industrial": "R.E.I.T.",
    "reit - diversified": "R.E.I.T.",
    "reit - healthcare facilities": "R.E.I.T.",
    "reit - hotel & motel": "R.E.I.T.",
    "reit - mortgage": "R.E.I.T.",
    "reit - specialty": "R.E.I.T.",
    "drug manufacturers - general": "Drugs (Pharmaceutical)",
    "drug manufacturers - specialty & generic": "Drugs (Pharmaceutical)",
    "biotechnology": "Drugs (Biotechnology)",
    "medical devices": "Healthcare Products",
    "diagnostics & research": "Healthcare Support Services",
    "medical care facilities": "Hospitals/Healthcare Facilities",
    "medical instruments & supplies": "Healthcare Products",
    "medical distribution": "Healthcare Support Services",
    "health information services": "Heathcare Information and Technology",
    "healthcare plans": "Insurance (General)",
    "education & training services": "Education",
    "staffing & employment services": "Business & Consumer Services",
    "consulting services": "Business & Consumer Services",
    "specialty business services": "Business & Consumer Services",
    "waste management": "Environmental & Waste Services",
    "pollution & treatment controls": "Environmental & Waste Services",
    "conglomerates": "Diversified",
}


class SectorGrowthMatch(BaseModel):
    matched_industry: str
    match_score: float
    low_confidence: bool
    expected_growth: float


class GrowthDataUnavailable(Exception):
    """Raised when the Damodaran India growth workbook is not installed."""


class CountryRiskData(BaseModel):
    country: str
    match_score: float
    mature_market_erp: float
    country_risk_premium: float
    total_equity_risk_premium: float
    corporate_tax_rate: float | None


@functools.lru_cache(maxsize=1)
def _load_india_beta() -> pd.DataFrame:
    df = pd.read_excel(REFERENCE_DIR / "betaIndia.xls", sheet_name="Industry Averages", header=9)
    df = df.rename(columns={"Beta ": "Beta"})
    return df.dropna(subset=["Industry Name"])


@functools.lru_cache(maxsize=1)
def _load_india_total_beta() -> pd.DataFrame:
    df = pd.read_excel(REFERENCE_DIR / "totalbetaIndia.xls", sheet_name="Industry Averages", header=7)
    return df.dropna(subset=["Industry Name"])


@functools.lru_cache(maxsize=1)
def _load_india_growth() -> pd.DataFrame:
    # histgrIndia.xls "Industry Averages": title block is rows 0-6; column headers sit on row 7.
    df = pd.read_excel(REFERENCE_DIR / "histgrIndia.xls", sheet_name="Industry Averages", header=7)
    return df.dropna(subset=["Industry Name"])


@functools.lru_cache(maxsize=1)
def _load_country_erp() -> pd.DataFrame:
    df = pd.read_excel(REFERENCE_DIR / "ctryprem.xlsx", sheet_name="ERPs by country", header=7)
    df = df.dropna(subset=["Country"])
    # The sheet has a second, unrelated ratings-lookup table sharing these columns further down;
    # restrict to rows with a real numeric ERP so a stray label row can never be treated as a country.
    df = df[pd.to_numeric(df["Total Equity Risk Premium"], errors="coerce").notna()]
    raw = pd.read_excel(REFERENCE_DIR / "ctryprem.xlsx", sheet_name="ERPs by country", header=None)
    mature_erp = float(raw.iloc[2, 4])
    return df, mature_erp


@functools.lru_cache(maxsize=1)
def _load_country_tax_rates() -> pd.DataFrame:
    df = pd.read_excel(REFERENCE_DIR / "countrytaxrates.xls", sheet_name="Sheet1", header=5)
    return df.dropna(subset=["Country"])


FUZZY_MATCH_CONFIDENCE_THRESHOLD = 55.0


def match_india_sector_beta(industry_text: str) -> SectorBetaMatch:
    """
    Resolves a free-text industry/sector description (as reported by a data
    provider such as Yahoo Finance) to one of Damodaran's ~96 India industry
    categories and returns its beta statistics.

    Resolution order:
      1. Exact match against the curated INDUSTRY_ALIASES table (reliable).
      2. Fuzzy text match (token_sort_ratio) against the category list, only
         accepted above FUZZY_MATCH_CONFIDENCE_THRESHOLD.
      3. Fallback to the "Total Market" row with `low_confidence=True`, so
         the caller can surface "no reliable sector match" instead of
         silently using a wrong industry's beta.
    """
    beta_df = _load_india_beta()
    choices = beta_df["Industry Name"].tolist()
    normalized = industry_text.strip().lower()

    match_name = None
    score = 0.0
    if normalized in INDUSTRY_ALIASES:
        match_name = INDUSTRY_ALIASES[normalized]
        score = 100.0
    else:
        result = process.extractOne(industry_text, choices, scorer=fuzz.token_sort_ratio)
        if result and result[1] >= FUZZY_MATCH_CONFIDENCE_THRESHOLD:
            match_name, score = result[0], result[1]

    low_confidence = match_name is None
    if match_name is None:
        match_name = "Total Market"
        score = 0.0

    row = beta_df[beta_df["Industry Name"] == match_name].iloc[0]

    tb_df = _load_india_total_beta()
    tb_match = tb_df[tb_df["Industry Name"] == match_name]
    total_beta_row = tb_match.iloc[0] if not tb_match.empty else None

    return SectorBetaMatch(
        matched_industry=match_name,
        match_score=score,
        low_confidence=low_confidence,
        num_firms=int(row["Number of firms"]),
        levered_beta=float(row["Beta"]),
        unlevered_beta=float(row["Unlevered beta"]),
        d_e_ratio=float(row["D/E Ratio"]),
        effective_tax_rate=float(row["Effective Tax rate"]),
        total_beta=float(total_beta_row["Total Levered Beta"]) if total_beta_row is not None else None,
        total_unlevered_beta=float(total_beta_row["Total Unlevered Beta"]) if total_beta_row is not None else None,
    )


def match_india_sector_growth(industry_text: str) -> SectorGrowthMatch:
    """
    Resolves a free-text industry/sector description to one of Damodaran's
    India industry categories and returns its expected revenue growth rate.
    Same resolution order as match_india_sector_beta(): curated alias table,
    then fuzzy match above FUZZY_MATCH_CONFIDENCE_THRESHOLD, then a
    low-confidence fallback — never silently guesses a wrong industry.
    """
    try:
        growth_df = _load_india_growth()
    except FileNotFoundError as exc:
        raise GrowthDataUnavailable(
            "Damodaran India growth workbook is not installed at "
            f"{REFERENCE_DIR / 'histgrIndia.xls'}. Download histgrIndia.xls from "
            "https://pages.stern.nyu.edu/~adamodar/pc/datasets/histgrIndia.xls "
            "into backend/data/reference/."
        ) from exc

    choices = growth_df["Industry Name"].tolist()
    normalized = industry_text.strip().lower()

    match_name = None
    score = 0.0
    if normalized in INDUSTRY_ALIASES:
        match_name = INDUSTRY_ALIASES[normalized]
        score = 100.0
    else:
        result = process.extractOne(industry_text, choices, scorer=fuzz.token_sort_ratio)
        if result and result[1] >= FUZZY_MATCH_CONFIDENCE_THRESHOLD:
            match_name, score = result[0], result[1]

    low_confidence = match_name is None
    if match_name is None:
        match_name = "Total Market"
        score = 0.0

    row = growth_df[growth_df["Industry Name"] == match_name].iloc[0]
    return SectorGrowthMatch(
        matched_industry=match_name,
        match_score=score,
        low_confidence=low_confidence,
        expected_growth=float(row["Expected Growth in Revenues - Next 5 years"]),
    )


def get_country_risk(country: str = "India") -> CountryRiskData:
    """Looks up mature-market ERP, country risk premium, and marginal tax rate for any country."""
    erp_df, mature_erp = _load_country_erp()
    choices = erp_df["Country"].tolist()
    match_name, score, idx = process.extractOne(country, choices, scorer=fuzz.WRatio)
    if score < 70:
        raise ValueError(
            f"'{country}' was not found in the country risk-premium reference data "
            f"(closest match: '{match_name}', confidence {score:.0f}%). Check the spelling, "
            "or enter WACC inputs manually for this country."
        )
    row = erp_df.iloc[idx]

    tax_df = _load_country_tax_rates()
    tax_match_name, tax_score, tax_idx = process.extractOne(country, tax_df["Country"].tolist(), scorer=fuzz.WRatio)
    tax_rate = float(tax_df.iloc[tax_idx]["Corporate Tax Rate"]) if tax_score > 70 else None

    return CountryRiskData(
        country=match_name,
        match_score=score,
        mature_market_erp=mature_erp,
        country_risk_premium=float(row["Country Risk Premium"]),
        total_equity_risk_premium=float(row["Total Equity Risk Premium"]),
        corporate_tax_rate=tax_rate,
    )
