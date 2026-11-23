import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));

// Exercise the hooks with controlled responses, including out-of-order requests.
// DOM rendering and real browser playback are separate manual checks.
function harness(path, modules = {}, globals = {}) {
  const slots = []; let cursor = 0; let effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) {
        slots[i]?.cleanup?.(); slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = fn(); });
      }
    },
    useCallback(fn) { cursor++; return fn; },
    useMemo(fn) { cursor++; return fn(); },
    useEffectEvent(fn) {
      const i = cursor++; slots[i] ??= {}; slots[i].fn = fn;
      return (...args) => slots[i].fn(...args);
    },
  };
  const events = new Map();
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name in modules) return modules[name];
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? true : String(property) });
  };
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const context = {
    exports: {}, require, encodeURIComponent, URL, process: { env: {} },
    window: { scrollTo() {}, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    ...globals,
  };
  vm.runInNewContext(compiled, context);
  return { exports: context.exports, events, unmount() { slots.forEach((slot) => slot?.cleanup?.()); }, render(fn) {
    cursor = 0; effects = []; const result = fn(); effects.forEach((effect) => effect()); return result;
  } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const control = (view, id) => nodes(view).find((n) => n.props.id === id && n.props.onChange);
function words(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return Array.isArray(node) ? node.map(words).join(" ") : words(node.props?.children);
}

test("notifications honor every server destination and retain old business routes", () => {
  const { notificationHref } = harness("../store/api/notification-api.ts", {
    "@reduxjs/toolkit/query/react": { fetchBaseQuery() {}, createApi: () => ({}) },
  }).exports;
  for (const [kind, path] of Object.entries({ APPLICATION: "board/id", APPLICATIONS: "board", JOB: "jobs/id", INTERVIEW_REPORT: "interview/id/feedback", SUBSCRIPTION: "subscription", PROFILE: "profile", STREAK: "streak" })) {
    assert.equal(notificationHref({ template_code: "IN_APP_SHORTLIST_INVITED", destination: { kind, id: "id" } }), `/student/${path}`);
  }
  assert.equal(notificationHref({ template_code: "X", destination: { kind: "APPLICATION" } }), "/student/board");
  assert.equal(notificationHref({ template_code: "IN_APP_SHORTLIST_INVITED", destination: { kind: "INBOX" } }), undefined);
  assert.equal(notificationHref({ template_code: "IN_APP_SHORTLIST_INVITED" }), "/student/invites");
  assert.equal(notificationHref({ template_code: "IN_APP_KYB_SUBMITTED", destination: { kind: "INBOX" } }), "/admin/queue?tab=kyb");
});

test("search keeps results and rejects stale first-page and load-more responses", async () => {
  const h = harness("../lib/pagination/use-cursor-load-more.ts"); const requests = []; let key = "initial";
  const fetch = () => { const d = deferred(); requests.push(d); return d.promise; };
  const render = () => h.render(() => h.exports.useCursorLoadMore(fetch, [key], true, { keepPreviousData: true, refreshOnFocus: true }));
  let view = render(); await tick(); assert.equal(view.isLoading, true);
  requests[0].resolve({ items: ["initial"], nextCursor: "next" }); await tick(); view = render();
  view.loadMore(); const pagination = requests[1];
  key = "old"; render(); await tick(); view = render();
  assert.equal(view.isLoading, false); assert.equal(view.isRefreshing, true); assert.deepEqual(plain(view.items), ["initial"]);
  key = "new"; render(); await tick(); requests[3].resolve({ items: ["new"], nextCursor: "new-next" }); await tick();
  requests[2].resolve({ items: ["old"], nextCursor: null }); pagination.resolve({ items: ["stale page"], nextCursor: null }); await tick();
  view = render(); assert.deepEqual(plain(view.items), ["new"]);
  h.events.get("focus")(); render(); await tick(); requests[4].reject(new Error("offline")); await tick(); view = render();
  assert.deepEqual(plain(view.items), ["new"]); assert.ok(view.error); assert.equal(view.hasMore, false);
  view.retry(); render(); await tick(); requests[5].resolve({ items: [], nextCursor: null }); await tick(); view = render();
  assert.deepEqual(plain(view.items), []); assert.equal(view.isRefreshing, false); assert.equal(view.error, null);
});

test("signup protects typed identity, locks fields, ignores old files and retries without storing passwords", async () => {
  const requests = []; let draft;
  const modules = {
    "./ui": { Field: "Field", ErrorNote: "ErrorNote", PillButton: "PillButton", StepHeader: "StepHeader", fieldBorder: () => "", fieldClass: "" },
    "@/features/student/profile/career-api": { usePreviewSignupResumeMutation: () => [() => ({ unwrap() { const d = deferred(); requests.push(d); return d.promise; } })] },
    "@/store/student": { useUpdateStudentNameMutation: () => [() => {}, {}] },
    "@/features/auth/hooks/use-signup-flow": { MIN_CANDIDATE_PASSWORD_LENGTH: 8, useSignupFlow: () => ({ phase: "DETAILS" }) },
    "@/lib/api/error-message": { getApiErrorMessage: () => "Read failed" },
  };
  const h = harness("../features/student/onboarding/components/account-steps.tsx", modules);
  const props = { onSignedUp() {}, onResumeSelected() {}, onDraftChange(value) { draft = value; } };
  const render = () => h.render(() => h.exports.AccountStep(props));
  let view = render();
  control(view, "signup-full-name").props.onChange({ target: { value: "Typed Person" } });
  control(view, "signup-password").props.onChange({ target: { value: "NeverPersist123" } });
  view = render(); control(view, "signup-resume").props.onChange({ target: { files: [{ name: "old.pdf" }] } }); await tick(); view = render();
  assert.equal(control(view, "signup-full-name").props.disabled, true);
  assert.ok(nodes(view).some((n) => n.props.id === "signup-full-name" && n.props.loading));
  control(view, "signup-resume").props.onChange({ target: { files: [{ name: "new.pdf" }] } }); await tick();
  requests[1].resolve({ full_name: "Other Person", email: "new@example.test", details: { current_city: "Pune" } }); await tick();
  requests[0].resolve({ full_name: "Old Person", email: "old@example.test", details: {} }); await tick(); view = render();
  assert.equal(control(view, "signup-full-name").props.value, "Typed Person");
  assert.equal(control(view, "signup-email").props.value, "new@example.test"); assert.match(words(view), /differs from the name you entered/);
  control(view, "signup-resume").props.onChange({ target: { files: [{ name: "broken.pdf" }] } }); await tick(); requests[2].reject(new Error("failed")); await tick(); view = render();
  nodes(view).find((n) => n.props.action && words(n).includes("Read failed")).props.action.props.onClick(); await tick();
  requests[3].resolve({ full_name: "Typed Person", email: null, details: {} }); await tick(); view = render();
  assert.equal(control(view, "signup-email").props.value, ""); assert.ok(!JSON.stringify(draft).includes("NeverPersist"));
  const restored = harness("../features/student/onboarding/components/account-steps.tsx", modules);
  const again = restored.render(() => restored.exports.AccountStep({ ...props, initialDraft: draft }));
  assert.equal(control(again, "signup-full-name").props.value, "Typed Person"); assert.equal(control(again, "signup-password").props.value, "");
});

test("existing cursor callers still retry a failed next page without replacing their list", async () => {
  const h = harness("../lib/pagination/use-cursor-load-more.ts");
  const requests = [];
  const fetch = (cursor) => { const d = deferred(); requests.push({ cursor, ...d }); return d.promise; };
  const render = () => h.render(() => h.exports.useCursorLoadMore(fetch));
  render(); await tick(); requests[0].resolve({ items: ["first"], nextCursor: "next" }); await tick();
  let view = render(); view.loadMore(); requests[1].reject(new Error("offline")); await tick();
  view = render(); view.retry(); assert.equal(requests[2].cursor, "next");
  requests[2].resolve({ items: ["second"], nextCursor: null }); await tick();
  assert.deepEqual(plain(render().items), ["first", "second"]);
});

test("course opening precedes completion; only a server-confirmed completion advances", async () => {
  const requests = []; let refreshed = 0;
  const lesson = (id) => ({ id, title: id, position_seconds: 0, duration_seconds: 120, completed: false, media_url: "video", media_kind: "UPLOAD" });
  const course = { data: { title: "Course", price_minor: 0, currency: "INR", locked: false, modules: [{ id: "module", title: "Module", lessons: [lesson("first"), lesson("second")] }] }, refetch() { refreshed++; } };
  const h = harness("../app/(portal)/student/courses/[courseId]/page.tsx", {
    "next/navigation": { useParams: () => ({ courseId: "course" }) },
    "@/store/student/learning.api": { useGetCourseDetailQuery: () => course, useCheckoutCourseMutation: () => [() => {}, {}], useUpdateLessonProgressMutation: () => [(args) => ({ unwrap() { const d = deferred(); requests.push({ args, ...d }); return d.promise; } })] },
  });
  const render = () => h.render(() => h.exports.default()); let view = render(); await tick();
  assert.equal(requests[0].args.positionSeconds, 0);
  const complete = () => nodes(view).find((n) => n.type === "button" && words(n).includes("Complete")).props.onClick();
  complete(); complete(); await tick(); assert.equal(requests.length, 1);
  requests[0].resolve({ completed: false }); await tick(); assert.equal(requests.length, 2);
  requests[1].resolve({ completed: false }); await tick(); view = render(); assert.match(words(view), /Keep watching/);
  assert.equal(nodes(view).find((n) => n.props.lesson).props.lesson.id, "first");
  complete(); await tick(); requests[2].resolve({ completed: true }); await tick(); view = render(); await tick();
  assert.equal(nodes(view).find((n) => n.props.lesson).props.lesson.id, "second"); assert.equal(requests[3].args.lessonId, "second"); assert.ok(refreshed >= 2);
  requests[3].resolve({ completed: false }); await tick();
});

test("a late Cognito refresh cannot resurrect credentials after logout", async () => {
  let stored = `header.${Buffer.from(JSON.stringify({ iss: "https://issuer/pool" })).toString("base64url")}.sig`;
  let writes = 0;
  const response = deferred();
  const h = harness("../lib/auth/refresh-session.ts", {
    "aws-amplify/auth": { fetchAuthSession: () => response.promise },
    "@/lib/auth/cognito": { COGNITO_CONFIG: { candidatePoolId: "pool" }, configureAmplify() {} },
    "@/lib/auth/token": { getStoredToken: () => stored, setStoredToken() { writes++; } },
    "@/lib/auth/token-expiration": { getTokenExpiration: () => 1 },
  }, { atob: (value) => Buffer.from(value, "base64").toString("utf8") });
  const token = h.exports.getFreshToken();
  stored = null;
  response.resolve({ tokens: { accessToken: { toString: () => "late-token" } } });
  assert.equal(await token, null); assert.equal(writes, 0);
});

test("the course score banner disappears as soon as any course is purchased", () => {
  let data = [];
  const h = harness("../app/(portal)/student/courses/page.tsx", {
    "@/store/student": { useGetStudentCoursesQuery: () => ({ data }) },
  });
  assert.match(words(h.render(() => h.exports.default())), /Earn up to \+30 points/);
  data = [{ id: "owned", title: "Owned", currency: "INR", priceMinor: 0, purchased: true }];
  assert.doesNotMatch(words(h.render(() => h.exports.default())), /Earn up to \+30 points/);
});

test("signup drafts survive a route remount without persisting files or passwords and clear on logout", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const load = () => harness("../features/student/onboarding/components/account-draft.ts", {}, { sessionStorage: storage }).exports;
  const draft = load();
  draft.writeAccountDraft({ fullName: "Typed Person", phone: "+919876543210", touched: ["fullName"], file: { name: "cv.pdf" }, password: "never-persist" });
  assert.equal(draft.readAccountDraft().file.name, "cv.pdf");
  assert.equal(draft.readAccountDraft().password, undefined);
  assert.ok(![...values.values()].join("").includes("never-persist"));
  const remounted = load();
  assert.equal(remounted.readAccountDraft().fullName, "Typed Person"); assert.equal(remounted.readAccountDraft().file, undefined);
  remounted.clearAccountDraft(); assert.deepEqual(plain(remounted.readAccountDraft()), {}); assert.equal(values.size, 0);
});

test("resume signature refresh keeps the visible PDF alive; a different CV resets the viewer", async () => {
  const requests = []; const revoked = [];
  class FileURL extends URL {
    static createObjectURL() { return "blob:pdf"; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const h = harness("../components/resume/original-resume-view.tsx", {}, {
    URL: FileURL, Blob, fetch() { const d = deferred(); requests.push(d); return d.promise; },
  });
  const props = { fileUrl: "https://s3.test/cv1.pdf?X-Amz-Signature=old", fileMime: "application/pdf" };
  const first = h.exports.OriginalResumeView(props);
  const renewed = { ...props, fileUrl: "https://s3.test/cv1.pdf?X-Amz-Signature=new" };
  assert.equal(first.key, h.exports.OriginalResumeView(renewed).key);
  assert.notEqual(first.key, h.exports.OriginalResumeView({ ...props, fileUrl: "https://s3.test/cv2.pdf" }).key);
  h.render(() => first.type(props));
  requests[0].resolve({ ok: true, blob: async () => new Blob(["%PDF-1.7"]) }); await tick();
  let view = h.render(() => first.type(props));
  assert.equal(nodes(view).find((n) => n.type === "iframe").props.src, "blob:pdf");
  view = h.render(() => first.type(renewed)); assert.equal(revoked.length, 0);
  assert.equal(nodes(view).find((n) => n.type === "iframe").props.src, "blob:pdf");
  requests[1].reject(new Error("offline")); await tick();
  view = h.render(() => first.type(renewed)); assert.ok(nodes(view).some((n) => n.type === "iframe"));
  h.unmount(); assert.deepEqual(revoked, ["blob:pdf"]);
});
