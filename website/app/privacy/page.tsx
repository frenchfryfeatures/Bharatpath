import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How BharatPath collects, uses, shares, stores and deletes personal data.",
  alternates: { canonical: "/privacy/" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="3 November 2026">
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Account details: your name, email address and, if you give it, your phone number and city.</li>
          <li>Your CV and what we read from it, and anything you add or correct on the review screen.</li>
          <li>Your applications, and for employers and colleges, details of the organisation.</li>
          <li>Payments, through our payment partner. We never see or store your card or UPI PIN.</li>
        </ul>
        <p>We never ask for your age, date of birth, gender, religion, caste or marital status, and we do not use any of them to decide who sees you.</p>
      </section>
      <section>
        <h2>Who sees what</h2>
        <ul>
          <li>Employers see a search card with your name, skills, city, experience and band. Your phone, email and CV are shown only when an employer opens your full profile, and every open is recorded.</li>
          <li>You can see which organisations opened your profile in the last 90 days.</li>
          <li>A college sees you in counts if you link to it, and by name only if you choose to share.</li>
          <li>We do not sell your data, and employers cannot export candidate lists.</li>
        </ul>
      </section>
      <section>
        <h2>Where it is kept</h2>
        <p>On servers in Mumbai, India.</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <ul>
          <li>Ask for a copy of everything we hold about you, as one download.</li>
          <li>Ask us to delete your account. Deletion runs after a 24-hour cooling-off period, during which you can change your mind.</li>
          <li>Payment and audit records are kept for as long as the law requires, without your profile attached.</li>
        </ul>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Questions or complaints about your data: <a className="text-navy underline" href={`mailto:${CONTACT_EMAIL}?subject=Privacy`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
