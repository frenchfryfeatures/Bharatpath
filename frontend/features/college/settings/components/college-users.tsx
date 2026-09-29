"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";

import { ListSkeleton } from "@/components/common/loading";
import { Dropdown } from "@/components/ui/dropdown";

import type { CollegeTeamRole } from "@/store/college/types";

import { useSettings } from "../hooks/use-settings";

const ROLE_OPTIONS: { value: CollegeTeamRole; label: string }[] = [
  { value: "COLLEGE_ADMIN", label: "Admin" },
  { value: "COLLEGE_STAFF", label: "Staff" },
];

export function CollegeUsers() {
  const { users, isLoadingUsers, inviteUser, removeUser, isInvitingUser } =
    useSettings("users");

  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollegeTeamRole>("COLLEGE_STAFF");
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!email.trim()) {
      return;
    }

    setError(null);

    try {
      await inviteUser(email.trim(), role);
      setEmail("");
      setRole("COLLEGE_STAFF");
      setShowInvite(false);
    } catch {
      setError("Could not add this member. Check the email and try again.");
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-4"
      style={{
        fontFamily: "'General Sans', sans-serif",
      }}
    >
      {/* Portal Users Card */}
      <section className="w-full max-w-[760px] overflow-hidden rounded-[12px] border border-[#e1e5eb] bg-white shadow-[0_4px_12px_rgba(19,26,38,0.024)]">
        {/* Card Header */}
        <div className="flex items-center gap-3 border-b border-[#e1e5eb] px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <h2 className="text-[14px] font-semibold leading-[18px] text-[#131A26]">
              Portal users
            </h2>

            <p className="text-[12px] font-normal leading-[17px] text-[#64748b]">
              Placement cell staff who can see cohort analytics.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="flex shrink-0 items-center gap-2 rounded-[8px] border-0 bg-[#5a4bd6] px-4 py-[10px] text-[13px] font-semibold leading-[17px] text-white transition hover:bg-[#4f41c8]"
          >
            <UserPlus size={16} strokeWidth={2} />
            Add user
          </button>
        </div>

        {/* Users */}
        <div>
          {isLoadingUsers ? (
            <div className="px-5 py-4">
              <ListSkeleton rows={3} avatar trailing />
            </div>
          ) : (
            <>
              {users.length === 0 && (
                <p className="px-5 py-6 text-[13px] text-[#64748b]">
                  No portal users yet. Add a placement cell member to get started.
                </p>
              )}

              {users.map((user, index) => (
            <div
              key={user.userId}
              className={[
                "grid min-h-[56px] grid-cols-[32px_minmax(0,1fr)_128px_32px]",
                "items-center gap-3 px-5 py-3",
                index > 0 ? "border-t border-[#eef0f3]" : "",
              ].join(" ")}
            >
              {/* Avatar */}
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#edf3fb] text-[11px] font-bold leading-[14px] text-[#24559d]">
                {user.initials}
              </div>

              {/* User information */}
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-[13px] font-semibold leading-[17px] text-[#131A26]">
                  {user.displayName}
                </span>

                <span className="truncate text-[11px] font-normal leading-[14px] text-[#64748b]">
                  {user.email}
                </span>
              </div>

              {/* Role */}
              <span
                className={[
                  "justify-self-start whitespace-nowrap rounded-full px-[10px] py-1",
                  "text-[11px] font-semibold leading-[14px]",
                  user.role === "COLLEGE_ADMIN"
                    ? "bg-[#131A26] text-white"
                    : "bg-[#edf3fb] text-[#131A26]",
                ].join(" ")}
              >
                {user.roleLabel}
              </span>

              {/* Remove */}
              <button
                type="button"
                aria-label={`Remove ${user.displayName}`}
                title="Remove user"
                onClick={() => removeUser(user.userId)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e1e5eb] bg-white text-[#64748b] transition hover:bg-[#f8fafc] hover:text-[#131A26]"
              >
                <X size={14} strokeWidth={2.2} />
              </button>
            </div>
          ))}
            </>
          )}
        </div>
      </section>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-[440px] rounded-[12px] bg-white p-5 shadow-[0_8px_30px_rgba(19,26,38,0.15)]">
            {/* Modal Header */}
            <div className="mb-5 flex items-start justify-between">
              <div className="flex flex-col gap-[2px]">
                <h3 className="text-[16px] font-semibold leading-5 text-[#131A26]">
                  Add user
                </h3>

                <p className="text-[12px] font-normal leading-[17px] text-[#64748b]">
                  Add a placement cell member by their account email.
                </p>
              </div>

              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowInvite(false)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-[#64748b] transition hover:bg-[#f4f6f8]"
              >
                <X size={17} />
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-4">
              {/* Email */}
              <label className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
                  Email
                </span>

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@college.edu"
                  className="w-full rounded-[10px] border border-[#e1e5eb] bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#131A26] outline-none transition placeholder:text-[#64748b] focus:border-[#5a4bd6] focus:ring-2 focus:ring-[#5a4bd6]/10"
                />
              </label>

              {/* Role */}
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
                  Role
                </span>

                <Dropdown<CollegeTeamRole>
                  value={role}
                  options={ROLE_OPTIONS}
                  onChange={setRole}
                  ariaLabel="Role"
                  width="w-full"
                  buttonClassName="h-[46px] rounded-[10px] border-[#e1e5eb] px-4 text-[14px] font-medium leading-5 text-[#131A26] focus:border-[#5a4bd6] focus:ring-[#5a4bd6]/10"
                />
              </div>

              {error && (
                <p className="text-[12px] font-medium text-[#c43d3d]">
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                type="button"
                disabled={isInvitingUser || !email.trim()}
                onClick={handleInvite}
                className="mt-1 self-start rounded-[8px] border-0 bg-[#5a4bd6] px-4 py-[10px] text-[13px] font-semibold leading-[17px] text-white transition hover:bg-[#4f41c8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isInvitingUser ? "Adding..." : "Add user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
