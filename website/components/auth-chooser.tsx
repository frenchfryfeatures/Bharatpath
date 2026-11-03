import Link from "next/link";
import { ArrowRight, Building2, GraduationCap, UserRound } from "lucide-react";

import { AUDIENCE_COPY } from "@/content/audiences";
import { AUDIENCES } from "@/lib/site";

const ICONS = { student: UserRound, employer: Building2, college: GraduationCap } as const;

/** /login and /signup: three doors, one per audience. There is no fourth. */
export function AuthChooser({ mode }: { mode: "login" | "signup" }) {
  const signIn = mode === "login";
  return (
    <section className="shell pb-10 pt-14 lg:pt-20">
      <h1 className="text-[clamp(40px,5.6vw,80px)] font-bold leading-[1] tracking-[-0.045em]">
        {signIn ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-5 max-w-[52ch] text-[17px] text-muted">
        {signIn
          ? "Candidates, employers and colleges each have their own sign-in. Choose yours."
          : "Choose who you are signing up as. Each kind of account has its own space and its own tools."}
      </p>
      <ul className="mt-12 grid gap-2 lg:grid-cols-3">
        {AUDIENCES.map((a, i) => {
          const c = AUDIENCE_COPY[a];
          const Icon = ICONS[a];
          return (
            <li key={a}>
              <Link
                href={`/${mode}/${a}/`}
                className={`group flex min-h-[300px] flex-col justify-between rounded-[24px] p-6 transition-colors sm:p-8 ${
                  i === 0 ? "bg-purple text-white hover:bg-purple-deep" : "bg-sand hover:bg-lavender"
                }`}
              >
                <Icon className={`h-7 w-7 ${i === 0 ? "text-gold" : "text-purple"}`} aria-hidden="true" />
                <span>
                  <span className="block text-[28px] font-semibold leading-tight tracking-[-0.03em]">{c.name}</span>
                  <span className={`mt-2 block max-w-[36ch] ${i === 0 ? "text-white/75" : "text-muted"}`}>
                    {signIn ? c.signInLead : c.signUpLead}
                  </span>
                  <span className={`mt-6 inline-flex items-center gap-2 font-medium ${i === 0 ? "text-gold" : "text-purple"}`}>
                    {signIn ? "Sign in" : "Sign up"}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-[15px] text-muted">
        {signIn ? "New to BharatPath? " : "Already have an account? "}
        <Link href={signIn ? "/signup/" : "/login/"} className="font-medium text-purple hover:underline">
          {signIn ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </section>
  );
}
