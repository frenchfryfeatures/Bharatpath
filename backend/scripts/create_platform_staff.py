"""Make an email address a member of BharatPath's own staff, with roles.

**For the first SUPER_ADMIN of an environment, and for recovery.** Since
2026-11-19 a SUPER_ADMIN invites staff and assigns roles in the console
(`/admin/access`, `docs/backend-guide/19-access-management.md`), which also
checks the rules and writes the audit row. This script is how the first one
exists, and how a locked-out environment gets one back. Run it as the
**migrator** role: whoever holds that credential is already trusted with the
database.

    cd backend
    DATABASE_URL=postgresql+asyncpg://bharatpath_migrator:...@host/bharatpath \\
      .venv/Scripts/python.exe scripts/create_platform_staff.py \\
      priya@bharatpath.example SUPER_ADMIN [MORE_ROLES ...]

Roles: any system role key -- SUPER_ADMIN, OPERATIONS_ADMIN, KYB_REVIEWER,
INTEGRITY_REVIEWER, SUPPORT_AGENT, CONTENT_MANAGER, TAXONOMY_MANAGER,
FINANCE_MANAGER, READ_ONLY_AUDITOR -- or a custom role's key. PLATFORM_ADMIN
is accepted as the old name of SUPER_ADMIN.

**Two steps, and this is only the second.** The person also needs a user in
the *business* Cognito pool, and an authenticator app enrolled on it: every
HIGH or CRITICAL console permission refuses without one (`mfa_required`).
On their first sign-in the verified identity adopts the row written here by
email, exactly as an invited recruiter's does.

Idempotent for the same address and role. An address that already belongs to
an employer or a college is refused: one account, one organisation.
"""

from __future__ import annotations

import asyncio
import os
import sys


async def main(argv: list[str]) -> int:
    from app.core.db import get_session_factory
    from app.core.staff_permissions import LEGACY_ROLE_TO_SYSTEM_ROLE
    from app.modules.access import service as access_service
    from app.modules.identity import service as identity_service

    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    email, roles = argv[0], [LEGACY_ROLE_TO_SYSTEM_ROLE.get(r, r) for r in argv[1:]]
    try:
        async with get_session_factory()() as session, session.begin():
            tenant_id, user_id = await access_service.provision_staff(
                session, email=email, role_keys=roles
            )
    except (
        identity_service.AlreadyInOrganisationError,
        identity_service.CannotAddMemberError,
    ) as exc:
        print(f"refused: {exc.code}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    print(f"{', '.join(roles)} granted: user {user_id} in platform tenant {tenant_id}")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("ENVIRONMENT", "local")
    sys.exit(asyncio.run(main(sys.argv[1:])))
