# API contracts, schema, and authz (v1)

Private models. Password auth only. No OAuth. No sharing.

## Authz matrix

| Action | Owner | Other user | Anonymous |
|---|---|---|---|
| Register / login | — | — | allow |
| GET /me | self | — | 401 |
| Search companies | any authenticated | | 401 |
| Create model | self | | 401 |
| GET/PATCH/ingest/export model | owner | 404 (no leak) | 401 |
| List models | own rows only | | 401 |

## Invariants

- Email unique among users
- A model belongs to exactly one user
- Session token is hashed at rest; raw token only in httpOnly cookie `dcf_session`
- Password hash never logged
- Idempotency-Key on POST /models: same user + key replays the same model id

## Tables

- `users` (id PK `usr_…`, email unique, password_salt, password_hash, display_name, created_at)
- `sessions` (id PK `ses_…`, user_id FK, token_hash unique, expires_at, created_at)
- `models` (id PK `mod_…`, user_id FK, name, ticker, currency, country, company_type, source, company_json, historicals_json, drivers_json, run_json, ingest_notes_json, ingest_warnings_json, created_at, updated_at)
- `idempotency_keys` (user_id, key, model_id, created_at) unique (user_id, key)

Indexes: `(user_id, updated_at DESC)` on models; unique email; unique token_hash.

## Error envelope

`{ "code": "wacc_not_above_growth", "message": "...", "request_id": "..." }`

Codes: `unauthorized`, `validation_error`, `not_found`, `conflict`, `ingest_failed`, `wacc_not_above_growth`, `export_unavailable`.
