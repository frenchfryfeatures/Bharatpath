"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import {
  closeInviteModal,
  type TeamRole,
  useAddEmployerTeamMemberMutation,
} from "@/store/employer/settings";

const inputClass =
  "min-h-[43px] w-full rounded-[9px] border border-[#dfe4ea] bg-white px-3.5 text-[13px] text-[#111827] outline-none transition focus:border-[#526cc8] focus:ring-4 focus:ring-[#526cc8]/10";

export function InviteMemberModal() {
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("Recruiter");
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [addMember, { isLoading, error }] = useAddEmployerTeamMemberMutation();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    try {
      await addMember({ email: email.trim(), role }).unwrap();
      dispatch(closeInviteModal());
    } catch {
      // The API error remains visible below the fields.
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 p-5">
      <form
        className="w-full max-w-[440px] rounded-[13px] border border-[#dfe4ea] bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && roleMenuOpen) {
            event.stopPropagation();
            setRoleMenuOpen(false);
          }
        }}
      >
        <div className="mb-[18px] flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-bold">
              Invite team member
            </h3>
            <p className="mt-0.5 text-xs leading-4 text-[#718096]">
              Give another person access to this employer account.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[7px] border border-[#dfe4ea] bg-white text-lg"
            onClick={() => dispatch(closeInviteModal())}
          >
            ×
          </button>
        </div>

        {error && <p className="text-xs text-[#c0392b]">Could not add this team member.</p>}

        <div className="mb-3 flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold leading-[15px] text-[#526074]">
            Work email
          </span>
          <input
            autoFocus
            type="email"
            aria-label="Work email"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="mb-3 flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold leading-[15px] text-[#526074]">
            Role
          </span>
          <div className="relative">
            <button
              type="button"
              aria-expanded={roleMenuOpen}
              aria-haspopup="listbox"
              className={`${inputClass} flex items-center justify-between text-left font-medium`}
              onClick={() => setRoleMenuOpen((open) => !open)}
            >
              {role}
              <ChevronDown
                className={`h-4 w-4 text-[#526074] transition-transform ${roleMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {roleMenuOpen && (
              <div
                role="listbox"
                aria-label="Team member role"
                className="absolute z-10 mt-1 w-full overflow-hidden rounded-[9px] border border-[#c9d2e2] bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
              >
                {(["Recruiter", "View only"] as TeamRole[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={role === option}
                    className={[
                      "block w-full cursor-pointer rounded-md px-3 py-2.5 text-left text-[13px] transition",
                      role === option
                        ? "bg-[#eef2ff] font-semibold text-[#4f43bd]"
                        : "text-[#172033] hover:bg-[#f4f6f8]",
                    ].join(" ")}
                    onClick={() => {
                      setRole(option);
                      setRoleMenuOpen(false);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-[18px] flex justify-end gap-2">
          <button
            type="button"
            className="min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033]"
            onClick={() => dispatch(closeInviteModal())}
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="min-h-9 cursor-pointer rounded-lg border border-[#5a4bd1] bg-[#5b4ed0] px-3.5 text-xs font-bold text-white hover:bg-[#4f43bd]"
          >
            {isLoading ? "Adding…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
