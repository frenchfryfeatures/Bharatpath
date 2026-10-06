const headings = /^(summary|professional summary|profile|experience|work experience|employment|education|skills|technical skills|projects|certifications|certificates|languages|achievements|interests|activities|volunteer work|other)$/i;

export function ResumeTextView({ text }: { text: string }) {
  const sections: Array<{ heading: string; lines: string[] }> = [{ heading: "Basics", lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (headings.test(trimmed)) sections.push({ heading: trimmed, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return <div className="space-y-3">{sections.filter((section) => section.lines.some((line) => line.trim())).map((section, index) => <section key={`${section.heading}-${index}`} className="rounded-xl border border-[#e7e9ee] bg-white p-4">
    <h3 className="mb-2 text-[13px] font-bold text-[#172033]">{section.heading}</h3>
    <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[#344054]">{section.lines.join("\n").trim()}</p>
  </section>)}</div>;
}
