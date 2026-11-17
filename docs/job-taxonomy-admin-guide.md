# Manage Job Taxonomy

Sign in as a Platform Admin, then open **Job Taxonomy** in the admin sidebar.
Other staff roles do not have access to this module.

1. Choose **Industries**, **Departments**, **Role Categories** or **Job Roles**.
   Search by name. Filter categories by department and roles by category.
2. Use **Add** to create an option. Categories need a department; roles need a
   category. Departments also need a Tech/Non-tech type. Names must be unique
   within the same parent, regardless of case or surrounding whitespace.
3. Use the pencil to rename an option or select a new parent. Existing profiles
   keep their saved label and original selection chain; new selections use the
   updated hierarchy.
4. Use the eye to hide/show an option. Hiding a parent also hides its descendants
   from onboarding. Saved profiles retain their answers.
5. Use the trash action to **archive**. This removes the choice from onboarding
   while retaining its ID, profile snapshots and audit history. Permanent deletion
   through the API is refused when an option is in use.
6. Clear search and select one parent to reorder. Drag rows, or use the up/down
   arrows. The order is saved immediately. Larger lists have Next/Previous pages.

## Department priority

In **Departments**, choose an industry in **Department priority by industry**.
Drag departments or use the up arrows, then select **Save priority order**.
Every industry still shows every department; priority only changes the order.
Visibility is managed on the department itself, across all industries.

## Review Others

Open **Others Submissions**. Filter by status or level and search the user's text.
Each entry shows its parent chain, user, date, and how many users entered the same
normalized text in that context.

- **Add as dropdown option**: check the pre-filled name, adjust it if needed,
  choose the correct parent/type and save. Matching pending entries are approved
  together and the option becomes available to users.
- **Merge into existing option**: choose the parent and existing option. This
  avoids creating a duplicate spelling of the same job or department.
- **Reject**: close the suggestion without adding a choice. The user retains
  their original text.

Approval/merge automatically links matching profiles, provided the user still has
that answer. It never overwrites an answer they changed while review was pending.
For an Others chain, resolve the parent first, then its child suggestions.

## Import and export

Export **CSV** or **XLSX** from a master tab to obtain its template:

`id,name,parent_id,type,sort_order,is_visible,version`

Keep the columns in that order. Leave `id` blank for new entries. For edits, keep
the exported ID and version. Use parent UUIDs from the department/category export;
use `true`/`false` for visibility. Limits: 2 MB and 2,000 entries per import.
The whole import rolls back if a row is invalid or stale. XLSX exports store names
as literal text; CSV prefixes formula-like names with an apostrophe for Excel.

If another admin edits an entry first, refresh and repeat your change using the
latest version. Do not repeatedly import an old export to overwrite their work.

## Local versus AWS

The implementation and initial seed were applied to the local Docker PostgreSQL
instance on port 5433. Automated API tests use a separate local database. These
changes reach AWS only when the migration and seed are deliberately run against
an AWS environment during deployment.
