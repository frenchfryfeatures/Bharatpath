import { test, expect, type Page } from "@playwright/test";
import fixture from "../fixtures/career.json";

const versionId = "00000000-0000-4000-8000-000000000001";
const revisedId = "00000000-0000-4000-8000-000000000002";

async function mockBackend(page: Page, { completed = false, noPlans = false } = {}) {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let profile = {
    details: {
      ...fixture.details,
      phone: "+919876543210",
      work_status: "FRESHER",
      current_city: "Pune",
      key_skills: ["Python"],
      headline: "Graduate software developer",
    },
    resume_version_id: versionId,
    resume_file_id: versionId,
    resume_filename: "resume.pdf",
    completed,
    updated_at: new Date().toISOString(),
  };
  const confirmations: string[] = [];
  let paid = false;
  const saves: { complete: boolean; details: Record<string, unknown> }[] = [];
  await page.addInitScript(() => {
    const payload = btoa(
      JSON.stringify({
        email: "candidate@example.test",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    localStorage.setItem("bharatpath_token", `e30.${payload}.test-signature`);
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const headers = {
      "access-control-allow-origin": "http://localhost:3000",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type,accept",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let body: unknown = {};
    if (path === "/auth/me")
      body = {
        user_id: versionId,
        role: "CANDIDATE",
        pool: "CANDIDATE",
        tenant_id: null,
        full_name: "Kavya Iyer",
        email: "candidate@example.test",
      };
    else if (
      path === "/candidate/profile" ||
      path === "/candidate/profile/name"
    )
      body = {
        full_name: "Kavya Iyer",
        city: "Pune",
        state_code: "MH",
        updated_at: new Date().toISOString(),
      };
    else if (path === "/candidate/resume/versions")
      body = [
        {
          resume_version_id: versionId,
          source: "UPLOAD",
          confirmed: false,
          superseded: false,
          confirmed_at: null,
          created_at: new Date().toISOString(),
        },
      ];
    else if (path === "/candidate/profile/form") body = fixture.fields;
    else if (path === "/candidate/profile/details") {
      if (request.method() === "PUT") {
        const submitted = request.postDataJSON();
        saves.push(submitted);
        profile = {
          ...profile,
          details: submitted.details,
          completed: submitted.complete,
          resume_version_id: submitted.complete ? revisedId : versionId,
        };
      }
      body = profile;
    } else if (path.startsWith("/candidate/profile/prefill")) body = profile;
    else if (path === "/candidate/subscription/plans")
      body = noPlans ? [] : [
        {
          code: "MONTHLY",
          audience: "CANDIDATE",
          months: 1,
          period: "MONTHLY",
          price_minor: 19900,
          seat_allowance: null,
        },
      ];
    else if (path === "/candidate/subscription/checkout") {
      expect(request.postDataJSON().plan_code).toBe("MONTHLY");
      body = {
        payment_id: versionId,
        status: "PENDING",
        amount_minor: 19900,
        list_amount_minor: 19900,
        currency: "INR",
        redirect_url: `https://stub-payments.invalid/${versionId}`,
      };
    } else if (path === `/billing/dev/payments/${versionId}/simulate`) {
      expect(request.postDataJSON().outcome).toBe("SUCCEEDED");
      paid = true;
      body = { id: versionId, status: "SUCCEEDED", amount_minor: 19900, currency: "INR" };
    } else if (path === "/candidate/subscription")
      body = {
        state: paid ? "ACTIVE" : "NONE",
        has_access: paid,
        plan_code: null,
        period: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at: null,
        renews_automatically: false,
        mandate_state: null,
      };
    else if (path.includes("/confirm")) {
      confirmations.push(path);
      await route.fulfill({
        status: 402,
        headers,
        json: {
          code: "subscription_required",
          title: "Subscription required",
        },
      });
      return;
    } else if (path.includes("/score/me"))
      body = {
        status: "PENDING",
        value: null,
        band: null,
        computed_at: null,
      };
    else if (path.includes("/courses")) body = [];
    else if (path.includes("/applications"))
      body = { items: [], total: 0, next_cursor: null };
    else if (path === "/notifications/preferences")
      body = {
        push_enabled: false,
        email_enabled: false,
        sms_enabled: false,
      };
    else if (path === "/notifications")
      body = { items: [], next_cursor: null, unread_count: 0 };
    await route.fulfill({ status: 200, headers, json: body });
  });
  return { confirmations, saves, browserErrors };
}

test("resume profile is reviewed and saved before payment without scoring", async ({
  page,
}) => {
  const calls = await mockBackend(page);
  await page.goto("/signup/student");
  await expect(
    page.getByRole("heading", { name: "Basic details", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Mobile number *")).toHaveValue("+919876543210");
  await expect(page.getByLabel("Email ID")).toHaveValue(
    "candidate@example.test",
  );
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Employment details", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/Company name/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Education details", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(page.getByText("This field is required.").first()).toBeVisible();
  await page.getByLabel("Highest qualification *").fill("Graduate");
  await page
    .getByLabel("Course *", { exact: true })
    .fill("BSc Computer Science");
  await page.getByRole("button", { name: "Course type" }).click();
  await page.getByRole("option", { name: "Full time", exact: true }).click();
  await page.getByLabel("University / Institute *").fill("University");
  await page.getByLabel("Starting year *").fill("2020");
  await page.getByLabel("Passing / expected passing year *").fill("2023");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Headline and preferences",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and continue to membership" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose your membership" }),
  ).toBeVisible();
  expect(calls.confirmations).toEqual([]);
  expect(calls.saves.at(-1)?.complete).toBe(true);
  expect(calls.saves.at(-1)?.details.institution).toBe("University");
  expect(calls.browserErrors).toEqual([]);
  await page.screenshot({
    path: "test-results/membership-after-profile.png",
    fullPage: true,
  });
});

test("web profile places career sections before reports", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/student/profile");
  await expect(page.getByRole("heading", { name: "Kavya Iyer" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Profile quick links" }),
  ).toBeVisible();
  const career = await page.locator("#profile-education").boundingBox();
  const report = await page
    .getByRole("button", { name: /Interview report/ })
    .boundingBox();
  expect(career && report && career.y < report.y).toBeTruthy();
  await page.screenshot({
    path: "test-results/career-profile.png",
    fullPage: true,
  });
  const quickLinks = page.getByRole("navigation", {
    name: "Profile quick links",
  });
  await quickLinks.getByRole("link", { name: "Reports and learning" }).click();
  await expect(
    page.getByRole("heading", { name: "Reports and learning", exact: true }),
  ).toBeVisible();
  await quickLinks.getByRole("link", { name: "Privacy and account" }).click();
  await expect(
    page.getByRole("heading", { name: "Privacy and account", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/profile-connected-sections.png",
    fullPage: true,
  });
});

test("resume fills the first onboarding step before account creation", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "http://localhost:3000",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type,accept",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (route.request().url().endsWith("/auth/resume-preview")) {
      expect(route.request().headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      await route.fulfill({
        status: 200,
        headers,
        json: {
          full_name: "Kavya Iyer",
          email: "kavya@example.test",
          details: {
            ...fixture.details,
            phone: "+919876543210",
            work_status: "FRESHER",
            key_skills: ["Python"],
          },
        },
      });
    } else
      await route.fulfill({
        status: 401,
        headers,
        json: { code: "unauthenticated" },
      });
  });
  await page.goto("/signup/student");
  await expect(
    page.getByRole("heading", { name: "Basic details", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await page
    .getByLabel("Upload your resume", { exact: true })
    .setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("test file"),
    });
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Kavya Iyer",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "kavya@example.test",
  );
  await expect(page.getByLabel("Mobile number *")).toHaveValue("+919876543210");
  await expect(
    page.getByRole("button", { name: "Work status", exact: true }),
  ).toContainText("I'm a fresher");
  await expect(page.getByText(/Profile details ·/)).toHaveCount(0);
  await page.screenshot({
    path: "test-results/unified-basic-details.png",
    fullPage: true,
  });
});


test("completed onboarding resumes at available membership plans", async ({ page }) => {
  await mockBackend(page, { completed: true });
  await page.goto("/signup/student");
  await expect(page.getByRole("heading", { name: "Choose your membership" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Monthly/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue.*199/ })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Basic details", exact: true })).toHaveCount(0);
});

test("missing membership catalogue does not display a zero price", async ({ page }) => {
  await mockBackend(page, { completed: true, noPlans: true });
  await page.goto("/signup/student");
  await expect(page.getByText("No membership plans are available right now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select a membership plan" })).toBeDisabled();
  await expect(page.getByText(/Continue.*0\.00/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("simulated checkout activates membership before scoring", async ({ page }) => {
  const calls = await mockBackend(page, { completed: true });
  await page.goto("/signup/student");
  await page.getByRole("button", { name: /Continue.*199/ }).click();
  const checkout = page.getByRole("dialog", { name: "BharatPath membership" });
  await expect(checkout.getByText(/No money will be charged/)).toBeVisible();
  await checkout.getByRole("button", { name: /Pay.*199/ }).click();
  await expect(page.getByRole("heading", { name: "You’re a member" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start resume scoring/ })).toBeEnabled();
  expect(calls.confirmations).toEqual([]);
  expect(calls.browserErrors).toEqual([]);
});
