# 19 — Access management: staff roles, permissions, scope and the step-up

Module `access`, mounted at **`/admin/access`** (17 routes), plus the
guard every other console route now uses. Added 2026-11-19. It replaces
the four hardcoded staff roles and the `CONSOLE_ROLES` map described in
[13 §0](13-admin-console-and-disputes-apis.md#0-the-big-picture--one-permission-table-one-bypass-session-one-audit-row-per-look).

**For the admin portal team:** §1 (what changed for you), §4 (the routes)
and §5 (the step-up headers and errors). **For backend:** §2, §3 and §6.

---

## 1. What changed, in one screen

* **Staff hold roles; roles hold permissions.** A member of staff may hold
  several roles. What they can do is the union of those roles. There are no
  "deny" rules.
* **Every console route requires named permissions** (for example
  `candidates.view` or `organisations.suspend`), not a role.
* **Nine system roles ship with the platform** (§2.2). Their permissions
  are defined in code and cannot be edited. A SUPER_ADMIN can create
  **custom roles** from the permission catalogue (§2.1), then edit,
  duplicate and archive them.
* **A role can be given for some organisations only, or until a date**
  (§3).
* **HIGH and CRITICAL permissions need extra checks** (§5): a reason in a
  header, an enrolled authenticator app, and for CRITICAL a recent sign-in.
* **`/auth/me` keeps working for the current portal.** `role` still reads
  `PLATFORM_ADMIN`, `KYB_REVIEWER`, `INTEGRITY_REVIEWER` or `SUPPORT_AGENT`
  for anyone holding that system role (SUPER_ADMIN reads `PLATFORM_ADMIN`),
  and `PLATFORM_STAFF` for anyone else. **That field is deprecated for
  staff.** Read the new `staff` object (`roles`, `permissions`,
  `scoped_permissions`, `is_super_admin`), or `GET /admin/access/me`, and
  decide pages and buttons from permissions.
* **Nobody lost access.** Migration `0022` moved each existing staff member
  onto the system role with the same name; `PLATFORM_ADMIN` became
  `SUPER_ADMIN`.

## 2. The catalogue

### 2.1 Permissions

`GET /admin/access/permissions` returns this list, grouped by module. The
source is `backend/app/core/staff_permissions.py`. "SA only" means only
SUPER_ADMIN can hold it.

| Module | Permission | Risk | Notes |
|---|---|---|---|
| Dashboard | `dashboard.view` | LOW | Queue sections inside are gated by `kyb.view`, `integrity.view`, `disputes.view` and `organisations.view` |
| Candidates | `candidates.view` | LOW | List, drill-down, score timeline, interviews, courses, applications. Contacts masked |
| Candidates | `candidates.leads` | HIGH | Sales follow-up list. **Requires `candidate_contact.view`**; the route checks both |
| Sensitive data | `candidate_contact.view` | HIGH | The onboarding page with the whole phone number and email. Also allows partial-contact search on lists |
| Sensitive data | `resume.download` | HIGH | A candidate's CV |
| Sensitive data | `recordings.listen` | HIGH | Interview recordings |
| Employers | `kyb.view` | LOW | KYB queue, a submission, the approval setting |
| Employers | `employers.approve_kyb` | LOW | Decide a submission. Also decides who receives KYB notifications |
| Employers | `kyb.configure` | CRITICAL | Switch KYB review manual/automatic. **SA only** |
| Employers | `employers.view` | LOW | Open an employer. Scopable |
| Integrity | `integrity.view`, `integrity.resolve` | LOW | |
| Organisations | `organisations.view` | LOW | List organisations, and an organisation's suspension history (that route is scopable) |
| Organisations | `organisations.suspend` | CRITICAL | Suspend or reinstate an organisation. Scopable |
| Institutes | `institutes.view` | LOW | Open a college. Scopable |
| Institutes | `institutes.manage_seats` | HIGH | Change a college's seat allocation. Scopable |
| Support | `disputes.view`, `disputes.resolve` | LOW | `resolve` covers assign and resolve |
| Support | `notifications.suppress` | LOW | |
| Accounts | `accounts.create` | HIGH | Create candidate, employer and college accounts; add an organisation member (that route is scopable) |
| Accounts | `accounts.resend_invitation` | LOW | |
| Payments | `discounts.view` | LOW | |
| Payments | `discounts.manage` | HIGH | Create and switch off discount codes |
| Taxonomies | `taxonomy.view`, `taxonomy.create`, `taxonomy.edit`, `taxonomy.import` | LOW | The employer search filters (`/admin/search-filters`) |
| Courses | `courses.view`, `courses.manage`, `courses.publish` | LOW | |
| Administration | `audit.view` | HIGH | The complete audit log, and §4's history. **SA only** |
| Administration | `admins.view` | LOW | Staff, roles, the catalogue, impact previews |
| Administration | `admins.invite` | CRITICAL | **SA only** |
| Administration | `admins.manage` | CRITICAL | Assign and remove roles; suspend and reinstate staff. **SA only** |
| Administration | `roles.manage` | CRITICAL | Create, edit, duplicate and archive roles. **SA only** |

**Not in the catalogue on purpose.** There are no refunds, no job
moderation and no data export, because no route does those things. A
permission is added together with the route that checks it; a test fails
on any permission that no route uses.

### 2.2 System roles

| Key | Holds |
|---|---|
| `SUPER_ADMIN` | Everything. Cannot be scoped or given an expiry. The last active one cannot be removed or suspended |
| `OPERATIONS_ADMIN` | Everything except the SA-only permissions |
| `KYB_REVIEWER` | Same access as before: dashboard, KYB view and decide, organisations list, employer drill-down |
| `INTEGRITY_REVIEWER` | Same access as before: dashboard, integrity, candidates, CVs |
| `SUPPORT_AGENT` | Same access as before: organisations, candidates, employer and college drill-downs, disputes, suppression, resend invitation, discount view, taxonomy, CVs, contacts, recordings, leads |
| `CONTENT_MANAGER` | Courses |
| `TAXONOMY_MANAGER` | Taxonomies |
| `FINANCE_MANAGER` | Discounts (view and manage), organisations, colleges, seat allocation |
| `READ_ONLY_AUDITOR` | Every LOW `.view` permission; no contacts, CVs or recordings, and not the audit log (SA only) |

## 3. Scope and expiry

An assignment can carry:

* **`scope_tenant_ids`**: the organisations the grant applies to (1 to 200),
  or null for all of them.
* **`expires_at`**: when the grant stops working. Expiry is checked on
  every request, not only when the cache refreshes.

**Scoped grants work only on routes about one organisation.** These are
the routes with `{tenant_id}` in the path: `/admin/employers/{id}`,
`/admin/colleges/{id}`, `/admin/colleges/{id}/seats`,
`/admin/tenants/{id}/suspend`, `/admin/tenants/{id}/reinstate`,
`/admin/tenants/{id}/suspensions` and `/admin/tenants/{id}/members`.
On every other route (lists, candidate pages, queues) a scoped grant
grants nothing. Restricting access works by refusing; a scoped grant never
falls back to "every organisation". A scoped assignment of a role with no
scopable permission is refused (`scope_grants_nothing`). The catalogue's
`scopable` flag tells the role editor which permissions can be scoped.

Example: a "College Support – North" custom role with `institutes.view`,
assigned with the ids of the northern colleges. Those colleges open; the
rest return 403.

**Not built:** scoping by region or state (no reliable region field
exists), and "assigned records only" (KYB and integrity queues have no
assignment).

## 4. Routes (`/admin/access`)

Every write is CRITICAL and SUPER_ADMIN only (§5). Request and response
shapes are in `openapi.json` under the `access` tag.

### Me
#### `GET /admin/access/me`
Any member of staff. Returns `roles` (key, name, scope, expiry),
`permissions` (held for every organisation), `scoped_permissions` and
`is_super_admin`. Use it to decide which pages and buttons to show.

### Permissions tab
#### `GET /admin/access/permissions`
`admins.view`. The catalogue in §2.1, grouped by module, with `risk`,
`super_admin_only`, `requires` and `scopable`.

### Roles tab
#### `GET /admin/access/roles`
`admins.view`. System roles first. `?include_archived=true` adds archived
custom roles. Each role has `permissions` and `holders`, the number of
people holding it now.
#### `GET /admin/access/roles/{role_id}`
`admins.view`.
#### `POST /admin/access/roles/{role_id}/impact`
`admins.view`. Body `{name, permissions}`. Returns `holders`, `added`,
`removed`, `high_risk_added` and `refusal` (the error code saving would
return, or null). Saves nothing. Use it to show "this affects N people"
and the high-risk warning before saving.
#### `POST /admin/access/roles`
`roles.manage`. Body `{name, description?, permissions}` → 201. The key is
generated as `CUSTOM_<NAME>`. 422 codes: `role_permissions_empty`,
`role_permission_unknown`, `role_permission_super_admin_only`,
`role_permission_requires_another`, `role_name_invalid`.
#### `PUT /admin/access/roles/{role_id}`
`roles.manage`. Same body. Applies to every holder on their next request.
409 `system_role_fixed` for a system role; 409 `role_archived`.
#### `POST /admin/access/roles/{role_id}/duplicate`
`roles.manage`. Body `{name}` → 201: a new custom role with the same
permissions. Duplicating SUPER_ADMIN drops the SA-only permissions.
#### `POST /admin/access/roles/{role_id}/archive`
`roles.manage`. 409 `role_in_use` while anyone holds it. 409
`system_role_fixed` for a system role.

### Admin Users tab
#### `GET /admin/access/staff`
`admins.view`. `?q=` (part of an email), `?status=ACTIVE|REVOKED`,
`?cursor=`, `?limit=` (max 200). Each item has `roles` (assignments with
scope, expiry, `expired`, reason, who granted it and when),
`effective_permissions`, `status` and `signed_in`.
#### `GET /admin/access/staff/{user_id}`
`admins.view`.
#### `POST /admin/access/staff` (invite)
`admins.invite`. Body `{email, roles: [{role_id, scope_tenant_ids?, expires_at?}]}`
(1 to 10 roles) → 201 `{member, invitation: SENT|ALREADY_REGISTERED}`.
Creates the staff account and its roles, then asks Cognito (business pool)
to email a temporary password. A refusal before that point sends no
email. A Cognito failure returns 502 `account_directory_unavailable` and
creates nothing. 409 `staff_already_member` (use assign, or reinstate);
409 `identity_already_in_organisation` or `identity_cannot_add_member`
for an address that belongs to a candidate or an organisation. Assignment
422 codes: `super_admin_is_unscoped`, `expiry_in_the_past`,
`expiry_needs_timezone`, `scope_grants_nothing`, `scope_size_invalid`,
`role_archived`, `role_repeated`.
#### `POST /admin/access/staff/{user_id}/roles`
`admins.manage`. Body `{role_id, scope_tenant_ids?, expires_at?}` → 201,
the updated member. 409 `role_already_held` (revoke it and assign again
to change its scope); 409 `staff_suspended`.
#### `POST /admin/access/staff/{user_id}/roles/{assignment_id}/revoke`
`admins.manage`. 409 `last_super_admin`.
#### `POST /admin/access/staff/{user_id}/suspend`
`admins.manage`. Their next request is refused, and every Cognito session
they have is ended. Their roles are kept for reinstatement. 409
`last_super_admin`.
#### `POST /admin/access/staff/{user_id}/reinstate`
`admins.manage`.

All of these return 409 `staff_self_change` when the target is the caller.
Nobody changes their own access.

### Audit History tab
#### `GET /admin/access/history`
`audit.view`. Newest first. `?user_id=` filters to rows about or by one
person; `?cursor=` and `?limit=` page. Includes every access-management
change (`staff_invited`, `staff_role_assigned`, `staff_role_revoked`,
`staff_suspended`, `staff_reinstated`, `staff_role_created`,
`staff_role_updated`, `staff_role_archived`) and every HIGH or CRITICAL
permission use (`staff_sensitive_access`). `metadata` holds the before
and after (roles and permissions), `reason`, `ip` and `user_agent`.
Reading this list is itself audited.

**Not built:** the Access Requests tab (two-person approval) and the
Login Sessions tab.

## 5. The step-up on HIGH and CRITICAL permissions

Every route requiring a HIGH or CRITICAL permission (§2.1), on any part of
the console and not only `/admin/access`, checks these in order:

1. **`X-Access-Reason` header**, 5 to 500 characters after decoding.
   **Percent-encode it** (`encodeURIComponent`): headers are Latin-1, and
   a reason may be typed in Hindi. Missing → **403 `access_reason_required`**.
   Ask once per task, not once per click; the portal can reuse a reason
   for the screen the person is on.
2. **CRITICAL only: a recent sign-in.** The token's `auth_time` must be
   within `STAFF_RECENT_AUTH_SECONDS` (default 900). Refreshing a token
   does not reset it. Too old → **401 `reauthentication_required`**: ask
   the person to sign in again, then retry.
3. **An authenticator app enrolled** on the person's Cognito user
   (software-token MFA, business pool). Not enrolled → **403 `mfa_required`**:
   send them to set up MFA. If Cognito cannot be reached → **503
   `staff_mfa_check_unavailable`** (the check fails closed).

When all three pass, one `staff_sensitive_access` audit row is written in
the same transaction as the action. It holds the permissions, risk,
reason, route template, full path, path ids, IP address and user agent.

**Before production:** every staff member who uses a HIGH permission
(contacts, CVs, recordings, leads, seats, discounts, account creation, the
audit log, everything SA does) needs MFA enrolled. The portal must send
`X-Access-Reason` and handle the three error codes above. Until it does,
those actions return 403.

## 6. How it is enforced (backend)

* **`require_permission(permission, also=(), tenant_param=None)`**
  (`app/core/deps.py`) is the only console guard. A staff member's access
  is resolved in `current_user` from `staff_role_assignments`
  (`app/core/auth/staff_access.py`) and cached for the membership TTL.
  **A change is never answered from the cache:** every write calls
  `staff_access.mark_changed` before committing (the same flag technique
  as tenant suspension), and expiry is evaluated on each request.
* **System role permissions are code**; custom role permissions are rows.
  `ck_staff_role_permissions_grantable` is generated from `GRANTABLE`, so
  an SA-only or unknown key cannot be stored.
* **Database guards (migration `0022`), applied to every writer:**
  * `guard_staff_role_write`: key and kind never change; a system role is
    never archived; archiving is permanent.
  * `guard_staff_role_permission_write`: no permission rows for a system
    or archived role.
  * `guard_staff_assignment_write`: an assignment starts live and goes to
    active staff only; SUPER_ADMIN is never scoped or expiring; only a
    revocation may be written afterwards; the last live SUPER_ADMIN is
    never revoked.
  * `guard_last_super_admin_membership`: the last active SUPER_ADMIN's
    membership cannot be revoked or deleted.
  * Both last-super-admin checks take the `staff_access` advisory lock.
* **No DELETE grant** on `staff_roles` or `staff_role_assignments`.
* **Tests:** `tests/invariants/test_admin_console.py` (every route's
  permissions, every system role driven at every route, every permission
  used by some route, `scopable` matching the routes),
  `tests/unit/test_staff_permissions.py` and
  `tests/integration/test_access_management.py`.
* **The first SUPER_ADMIN** of a new environment comes from
  `scripts/create_platform_staff.py EMAIL SUPER_ADMIN`, run as the
  migrator.
