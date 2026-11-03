import { BandDemo, LanguagesDemo, MaskedContactDemo, NoExportDemo, ViewedByDemo } from "@/components/trust-demos";
import { SectionHeading } from "@/components/ui";

const ITEMS = [
  { title: "Contact stays private", body: "Search cards show skills, city and experience. Phone and email appear only when an employer opens the full profile, and every open is recorded.", demo: <MaskedContactDemo />, span: "lg:col-span-2" },
  { title: "See who looked", body: "Candidates see which organisations opened their profile in the last 90 days.", demo: <ViewedByDemo />, span: "" },
  { title: "A band, not a verdict", body: "Employers see one of four bands, worked out from what the CV shows and the candidate confirmed.", demo: <BandDemo />, span: "" },
  { title: "No spreadsheets of people", body: "No bulk download, no export button, and hourly and daily limits on opening profiles.", demo: <NoExportDemo />, span: "" },
  { title: "In your language", body: "Six languages throughout the app, nine for the essentials.", demo: <LanguagesDemo />, span: "" },
];

export function TrustGrid() {
  return (
    <section aria-labelledby="trust-heading" className="shell py-20 sm:py-24">
      <SectionHeading id="trust-heading" title="Built so people trust it" lead="Candidates share more when they know exactly who sees what. These rules are in the product, not in a promise." />
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((i) => (
          <li key={i.title} data-reveal className={`flex min-w-0 flex-col gap-5 rounded-[24px] bg-sand p-6 sm:p-7 ${i.span}`}>
            <div className="min-w-0">{i.demo}</div>
            <div>
              <h3 className="text-[19px] font-bold tracking-[-0.02em]">{i.title}</h3>
              <p className="mt-2 text-[15px] text-muted">{i.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
