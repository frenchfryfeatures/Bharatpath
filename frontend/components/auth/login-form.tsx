"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { ErrorState } from "@/components/ui";
import { PORTAL_TYPES, PortalType } from "@/config/portal";
import {
  LoginFormValues,
  loginSchema,
} from "@/features/auth/schemas/login.schema";
import { authService } from "@/features/auth/services/auth.service";
import { setStoredToken } from "@/lib/auth/token";
import { setUser } from "@/store/common/slices/auth.slice";
import { setTenant } from "@/store/common/slices/tenant.slice";
import { useAppDispatch } from "@/store/hooks";

const portalTypeByName: Record<string, PortalType> = {
  student: PORTAL_TYPES.STUDENT,
  employer: PORTAL_TYPES.EMPLOYER,
  college: PORTAL_TYPES.COLLEGE,
  admin: PORTAL_TYPES.ADMIN,
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: searchParams.get("email") ?? "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError("");

    try {
      const result = await authService.login(values);

      if (result.token) {
        setStoredToken(result.token);
      }

      dispatch(
        setUser({ ...result.user, backendRole: result.backendRole }),
      );
      dispatch(
        setTenant({
          portal: portalTypeByName[result.portal] ?? null,
          tenantId: result.user.tenantId ?? null,
          tenantSlug: null,
          tenantName: null,
        }),
      );

      router.replace(result.path);
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again.",
      );
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-5"
    >
      {serverError && (
        <ErrorState message={serverError} />
      )}

      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-sm font-medium text-[#303747]"
        >
          Email address
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#9aa2b1]"
            aria-hidden="true"
          />
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@demo.bharatpath.test"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
            className="h-11 w-full rounded-lg border border-[#dfe2e8] bg-white pl-10 pr-3 text-sm text-[#17233a] outline-none transition placeholder:text-[#a0a6b1] focus:border-[#3566b8] focus:ring-2 focus:ring-[#3566b8]/10"
          />
        </div>
        {errors.email && (
          <p className="mt-1.5 text-xs text-red-600">
            {errors.email.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#17233a] text-sm font-semibold text-white transition hover:bg-[#223453] focus:outline-none focus:ring-2 focus:ring-[#3566b8] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting && (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
        {isSubmitting ? "Signing in..." : "Continue"}
      </button>

      <p className="text-center text-[11px] leading-5 text-[#8790a0]">
        Enter the email of a provisioned account. We&apos;ll route you to the
        right portal automatically.
      </p>

      <p className="text-center text-[13px] text-[#687386]">
        Looking for a job?{" "}
        <Link
          href="/signup/student"
          className="font-semibold text-[#3566b8] hover:text-[#254f96]"
        >
          Create a free candidate account
        </Link>
      </p>
    </form>
  );
}
