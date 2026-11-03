import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms of using BharatPath for candidates, employers and colleges.",
  alternates: { canonical: "/terms/" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="3 November 2026">
      <section>
        <h2>Using BharatPath</h2>
        <p>BharatPath is a hiring platform for candidates, employers and colleges in India. One person holds one account, and you are responsible for what is done from it.</p>
      </section>
      <section>
        <h2>Candidates</h2>
        <ul>
          <li>Your CV must be your own and true. Hidden text, invented experience or instructions written into a CV to game the score are flagged and can remove you from search until a person reviews them.</li>
          <li>Plans and add-ons are described in the app before you pay.</li>
        </ul>
      </section>
      <section>
        <h2>Employers</h2>
        <ul>
          <li>Post only real vacancies, at real pay, for your own organisation.</li>
          <li>Never charge a candidate a fee, and never filter or reject anyone on age, gender, religion, caste or any other ground the law protects.</li>
          <li>Use candidate contact details only to discuss a role. Copying, exporting or reselling them ends your account.</li>
        </ul>
      </section>
      <section>
        <h2>Colleges</h2>
        <ul>
          <li>Invite only your own students, and respect each student’s choice about sharing.</li>
        </ul>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          <a className="text-purple underline" href={`mailto:${CONTACT_EMAIL}?subject=Terms`}>{CONTACT_EMAIL}</a>
        </p>
      </section>
    </LegalPage>
  );
}
