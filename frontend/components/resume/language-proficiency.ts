export const languageProficiencies = ["Native", "Fluent", "Advanced", "Intermediate", "Basic", "Beginner"];

export function languageProficiencyOptions(value: string) {
  const options = value && !languageProficiencies.includes(value)
    ? [value, ...languageProficiencies]
    : languageProficiencies;
  return [
    { value: "", label: "Select proficiency" },
    ...options.map((option) => ({ value: option, label: option })),
  ];
}
