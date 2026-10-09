"""Cross-cutting foundations.

Retrofitting any of these is a rewrite, so every module builds on them: tenant
isolation, the audit trail, the transactional outbox, the error contract, rate
limits, and PII-redacting logs.
"""
