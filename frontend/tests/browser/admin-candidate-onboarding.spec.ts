import { test, expect } from "@playwright/test";
import fixture from "../fixtures/career.json";

const candidateId = "00000000-0000-4000-8000-000000000011";
const details = {
  ...fixture.details,
  phone: "+919876543210", work_status: "EXPERIENCED", currently_employed: "YES",
  experience_years: 3, experience_months: 6, company_name: "Example Technologies",
  job_title: "Software Engineer", current_city: "Pune", employment_start: "2023-01",
  employment_end: "", annual_salary: 0, notice_period: "30_DAYS",
  key_skills: ["Python", "SQL"], industry: "Information Technology", department: "Engineering",
  role_category: "Software Development", job_role: "Backend Developer",
  highest_qualification: "Graduate", course: "BSc Computer Science", course_type: "FULL_TIME",
  specialization: "Computer Science", specialization_name: "Artificial Intelligence",
  institution: "Example University", starting_year: 2018, passing_year: 2021,
  headline: "Backend developer building reliable APIs", preferred_locations: ["Pune", "Bengaluru"],
  preferred_salary: 1200000, gender: "PREFER_NOT_TO_SAY",
};

for (const hasCareer of [true, false]) {
  test(`admin sees ${hasCareer ? "all saved career fields" : "an older account without career data"}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const payload = btoa(JSON.stringify({ email: "staff@example.test", exp: Math.floor(Date.now() / 1000) + 3600 }));
      localStorage.setItem("bharatpath_token", `e30.${payload}.test-signature`);
    });
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      const headers = {
        "access-control-allow-origin": "http://localhost:3000",
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "authorization,content-type,accept",
        "access-control-allow-methods": "GET,OPTIONS",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      let body: unknown = {};
      if (path === "/auth/me") body = { user_id: candidateId, role: "PLATFORM_ADMIN", pool: "BUSINESS", tenant_id: candidateId };
      else if (path === `/admin/candidates/${candidateId}`) body = {
        id: candidateId, full_name: "Kavya Iyer", status: "ACTIVE", city: "Pune", state_code: "MH",
        created_at: "2026-10-01T10:00:00Z", score: null, subscription: null,
      };
      else if (path.endsWith("/onboarding")) body = {
        id: candidateId, full_name: "Kavya Iyer", email: "kavya@example.test", phone: null,
        city: "Pune", state_code: "MH", locale: "en", questionnaire: [], college_links: [],
        career_fields: fixture.fields,
        career: hasCareer ? { details, completed: true, updated_at: "2026-10-06T10:00:00Z", resume_filename: "kavya.pdf" } : null,
      };
      else if (path.endsWith("/resume")) body = { latest: null, confirmed: null };
      else if (path.endsWith("/score-timeline")) body = { points: [] };
      else if (path.endsWith("/courses") || path.endsWith("/interviews")) body = [];
      else if (path.endsWith("/applications")) body = { items: [], analytics: { total: 0, open: 0, by_stage: {}, reached: {} } };
      else if (path === "/notifications") body = { items: [], unread_count: 0, next_cursor: null };
      await route.fulfill({ status: 200, headers, json: body });
    });
    await page.goto(`/admin/users/${candidateId}`);
    await expect(page.getByRole("heading", { name: "Kavya Iyer" })).toBeVisible();
    for (const title of ["Basic details", "Employment details", "Education details", "Headline and preferences"]) {
      await expect(page.getByRole("region", { name: title, exact: true })).toBeVisible();
    }
    // Every field defined for candidate onboarding also appears in the admin view.
    for (const field of fixture.fields) {
      await expect(page.locator("dt").filter({ hasText: new RegExp(`^${field.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })).toHaveCount(1);
    }
    if (hasCareer) {
      await expect(page.getByText("Profile completed", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Basic details" })).toContainText(details.phone);
      await expect(page.getByRole("region", { name: "Employment details" })).toContainText("Example Technologies");
      await expect(page.getByRole("region", { name: "Education details" })).toContainText("Full time");
      const preferences = page.getByRole("region", { name: "Headline and preferences" });
      await expect(preferences).toContainText("Pune, Bengaluru");
      await expect(preferences).toContainText("₹12,00,000");
      await expect(preferences).toContainText("Prefer not to say");
      const salary = page.locator("dt").filter({ hasText: /^Annual salary \(INR\)$/ });
      await expect(salary.locator("..")).toContainText("₹0");
      await page.screenshot({ path: "test-results/admin-onboarding-career.png", fullPage: true });
    } else {
      await expect(page.getByText("Career details not added", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Employment details" })).toContainText("Not provided");
    }
    await expect(page.getByRole("region", { name: "Basic details" }).getByText(/Password/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
