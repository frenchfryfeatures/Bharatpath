"""Make an email address a member of BharatPath's own staff.

**There is no route for this, deliberately.** A route that grants staff roles
would be the one endpoint in the product worth attacking, and adding a
colleague is rare enough that a script run by an engineer is no burden. Run it
as the **migrator** role: the app role can add staff too, but whoever holds the
migrator credential is already trusted with the database.

    cd backend
    DATABASE_URL=postgresql+asyncpg://bharatpath_migrator:...@host/bharatpath \\
      .venv/Scripts/python.exe scripts/create_platform_staff.py \\
      priya@bharatpath.example PLATFORM_ADMIN

Roles: PLATFORM_ADMIN, KYB_REVIEWER, INTEGRITY_REVIEWER, SUPPORT_AGENT.

**Two steps, and this is only the second.** The person also needs a user in
the *business* Cognito pool (software-token MFA optional since 2026-10-07;
staff should turn it on).
On their first sign-in the verified identity adopts the row written here by
email, exactly as an invited recruiter's does. Create the Cognito user first
or second; the order does not matter.

Idempotent for the same address and role. An address that already belongs to
an employer or a college is refused: one account, one organisation.
"""

from __future__ import annotations

import asyncio
import os
import sys


async def main(argv: list[str]) -> int:
    from app.core.db import get_session_factory
    from app.modules.identity import service as identity_service
    from app.modules.identity.domain import PLATFORM_ROLES

    if len(argv) != 2 or argv[1] not in PLATFORM_ROLES:
        print(__doc__, file=sys.stderr)
        return 2
    email, role = argv
    try:
        async with get_session_factory()() as session, session.begin():
            tenant_id, user_id = await identity_service.provision_platform_staff(
                session, email=email, role=role
            )
    except (
        identity_service.AlreadyInOrganisationError,
        identity_service.CannotAddMemberError,
    ) as exc:
        print(f"refused: {exc.code}", file=sys.stderr)
        return 1
    print(f"{role} granted: user {user_id} in platform tenant {tenant_id}")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("ENVIRONMENT", "local")
    sys.exit(asyncio.run(main(sys.argv[1:])))
