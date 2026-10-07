from backend.api.config import normalize_database_url


def test_hosted_postgres_urls_get_the_psycopg_driver():
    assert normalize_database_url("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("postgresql://u:p@host/db?sslmode=require") == "postgresql+psycopg://u:p@host/db?sslmode=require"


def test_other_urls_are_left_alone():
    assert normalize_database_url("sqlite:///./backend/data/app.db") == "sqlite:///./backend/data/app.db"
    assert normalize_database_url("postgresql+psycopg://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("  postgres://u@h/d \n") == "postgresql+psycopg://u@h/d"
