"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { Button, ConfirmModal, Modal, Table, TableContainer, TableHeader, TableHead, TableBody, TableRow, TableCell, TableEmpty } from "@/components/ui";
import { usePageHeader } from "@/components/layout/header-context";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { educationAdminApi as api, type Level, type Option, type Submission } from "./api";

const tabs = [{key: "qualification", label: "Qualifications"}, {key: "course", label: "Courses"}, {key: "specialization", label: "Specializations"}, {key: "others", label: "Others Submissions"}] as const;
const input = "w-full rounded-xl border border-[#e7e9ee] bg-white px-3 py-2 text-sm";
type Editor = {option?: Option; submission?: Submission; action: "approve" | "merge" | "edit"; level: Level};
const payload = (row: Option) => ({name: row.name, parent_id: row.parent_id, level_rank: row.level_rank || 1, is_not_applicable: row.is_not_applicable, sort_order: row.sort_order, is_visible: row.is_visible, version: row.version});

export function EducationTaxonomyPage() {
  usePageHeader("Education Taxonomy", "Manage the choices candidates use to describe their education");
  const [tab, setTab] = useState<Level | "others">("qualification");
  const [search, setSearch] = useState("");
  const q = useDebouncedSearch(search);
  const [parent, setParent] = useState("");
  const [status, setStatus] = useState("pending");
  const [levelFilter, setLevelFilter] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [rank, setRank] = useState("1");
  const [mergeId, setMergeId] = useState("");
  const [deleting, setDeleting] = useState<Option | null>(null);
  const [rejecting, setRejecting] = useState<Submission | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linkCourses, setLinkCourses] = useState<string[]>([]);
  const [linkSpecializations, setLinkSpecializations] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState("");
  const linkRevision = api.useEducationRevisionQuery(undefined, {skip: !linksOpen, refetchOnMountOrArgChange: true});
  const [dragId, setDragId] = useState<string | null>(null);
  const [change, saving] = api.useChangeEducationMutation();
  const [exportFile, exporting] = api.useExportEducationMutation();
  const qualifications = api.useEducationAdminOptionsQuery("qualification?limit=1000");
  const courses = api.useEducationAdminOptionsQuery("course?limit=1000");
  const specializations = api.useEducationAdminOptionsQuery("specialization?limit=1000");
  const options = api.useEducationAdminOptionsQuery(`${tab}?limit=100&offset=${page * 100}&q=${encodeURIComponent(q)}${parent ? `&parent_id=${parent}` : ""}`, {skip: tab === "others"});
  const reorderList = api.useEducationAdminOptionsQuery(`${tab}?limit=1000${parent ? `&parent_id=${parent}` : ""}`, {skip: tab === "others" || !!q});
  const submissions = api.useEducationSubmissionsQuery(`status=${status}&limit=50&offset=${page * 50}&q=${encodeURIComponent(q)}${levelFilter ? `&level=${levelFilter}` : ""}`, {skip: tab !== "others"});
  const targets = api.useEducationAdminOptionsQuery(`${editor?.level || "qualification"}?limit=1000${editParent && editor?.level !== "specialization" ? `&parent_id=${editParent}` : ""}`, {skip: editor?.action !== "merge"});
  const parentOptions = (level: Level) => level === "course" ? qualifications.currentData?.items ?? [] : level === "specialization" ? courses.currentData?.items ?? [] : [];
  const rows = options.currentData?.items ?? [];
  const busy = saving.isLoading;
  const canReorder = !q && tab !== "others" && (!(tab === "course" || tab === "specialization") || !!parent) && !reorderList.currentData?.has_more && !reorderList.isFetching;
  const begin = (value: Editor) => {
    setEditor(value); setName(value.option?.name || value.submission?.raw_text || "");
    setEditParent(value.option?.parent_id || value.submission?.parent_id || parent); setRank(String(value.option?.level_rank || 1)); setMergeId(""); setError("");
  };
  async function perform(path: string, body?: unknown, method: "POST" | "PUT" | "DELETE" = "POST") {
    setError(""); setNotice("");
    try { await change({path, body, method}).unwrap(); setNotice("Changes saved."); return true; }
    catch (failure) { setError(getApiErrorMessage(failure, "The changes could not be saved. Refresh the list and try again.")); return false; }
  }
  async function saveEditor() {
    if (!editor) return;
    if (editor.action !== "merge" && !name.trim()) { setError("Enter a name."); return; }
    if ((editor.level === "course" || (editor.level === "specialization" && !!editor.submission)) && !editParent) { setError("Choose a parent."); return; }
    if (editor.action === "merge" && !mergeId) { setError("Choose an existing option."); return; }
    const success = editor.submission ? await perform(`others/${editor.submission.id}/resolve`, {action: editor.action, version: editor.submission.version, name: name.trim(), parent_id: editParent || null, option_id: mergeId || null, level_rank: Number(rank)}) :
      await perform(`${editor.level}${editor.option ? `/${editor.option.id}` : ""}`, {...(editor.option ? payload(editor.option) : {}), name: name.trim(), parent_id: editParent || null, level_rank: Number(rank)}, editor.option ? "PUT" : "POST");
    if (success) setEditor(null);
  }
  async function move(source: string, target: string) {
    if (!canReorder || busy || source === target) return;
    const all = reorderList.currentData?.items ?? [];
    const ids = all.map((row) => row.id); const from = ids.indexOf(source); const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await perform(`${tab}/reorder`, {ids, parent_id: parent || null, versions: Object.fromEntries(all.map((row) => [row.id, tab === "specialization" && parent ? row.link_version : row.version]))});
  }
  async function download(format: "csv" | "xlsx") {
    if (tab === "others") return;
    setError("");
    try {
      const blob = await exportFile({level: tab, format}).unwrap();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `taxonomy-${tab}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(getApiErrorMessage(failure, "The export could not be downloaded.")); }
  }
  const lookup = (id: string) => [...(qualifications.currentData?.items ?? []), ...(courses.currentData?.items ?? []), ...(specializations.currentData?.items ?? [])].find((row) => row.id === id)?.name || id;
  const listError = tab === "others" ? submissions.isError : options.isError;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Education taxonomy">
      {tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === item.key ? "bg-[#5F4DB2] text-white" : "border border-[#e7e9ee] bg-white text-[#687182]"}`}
        onClick={() => {setTab(item.key); setParent(""); setSearch(""); setPage(0); setError(""); setNotice("");}}>{item.label}</button>)}
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-[#267044]">{notice}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label="Search taxonomy" placeholder="Search by name" className={`${input} max-w-xs`} value={search} onChange={(event) => {setSearch(event.target.value); setPage(0);}} />
      {(tab === "course" || tab === "specialization") && <div className="min-w-64"><AppSelect searchable ariaLabel="Filter by parent" value={parent} onChange={(id) => {setParent(id); setPage(0);}}
        options={[{value: "", label: "All parents"}, ...parentOptions(tab).map((row) => ({value: row.id, label: `${row.name}${row.parent_name ? ` · ${row.parent_name}` : ""}`}))]} /></div>}
      {tab === "others" && <>
        <AppSelect ariaLabel="Submission status" value={status} onChange={(v) => {setStatus(v); setPage(0);}} options={["pending", "approved", "merged", "rejected"].map((v) => ({value: v, label: v[0].toUpperCase() + v.slice(1)}))} />
        <AppSelect ariaLabel="Submission level" value={levelFilter} onChange={(v) => {setLevelFilter(v); setPage(0);}} options={[{value: "", label: "All levels"}, ...tabs.filter((t) => t.key !== "others").map((t) => ({value: t.key, label: t.label}))]} />
      </>}
      {tab !== "others" && <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="secondary" disabled={exporting.isLoading} onClick={() => download("csv")}><Download size={14} />CSV</Button>
        <Button variant="secondary" disabled={exporting.isLoading} onClick={() => download("xlsx")}>XLSX</Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e7e9ee] px-3 py-2 text-sm"><Upload size={14} />Import
          <input aria-label="Import taxonomy" type="file" className="sr-only" accept=".csv,.xlsx" disabled={busy} onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            const body = new FormData(); body.append("file", file); await perform(`${tab}/import`, body);
          }} /></label>
        {tab === "specialization" && <Button variant="secondary" disabled={busy} onClick={() => {setLinksOpen(true); setLinkCourses([]); setLinkSpecializations([]);}}>Manage links</Button>}
        <Button disabled={busy} onClick={() => begin({level: tab, action: "edit"})}><Plus size={14} />Add</Button>
      </div>}
    </div>
    {tab !== "others" && <p className="text-xs text-[#687182]">{canReorder ? "Drag rows or use the arrows to reorder." : "Clear search and choose one parent to reorder."} Hidden or archived choices remain on existing profiles.</p>}
    {listError && <p role="alert" className="text-sm text-red-700">The list could not be loaded. <button className="underline" onClick={() => tab === "others" ? submissions.refetch() : options.refetch()}>Retry</button></p>}
    <TableContainer><Table><TableHeader><TableRow>
      {(tab === "others" ? ["Text / Level", "Parent chain", "User", "Date", "Users with same text", "Status", "Actions"] : ["Name", "Parent / Linked courses", "Usage", "Status", "Others pending", "Last updated", "Actions"]).map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {tab !== "others" ? rows.map((row, index) => <TableRow key={row.id} draggable={canReorder && !busy}
        onDragStart={() => setDragId(row.id)} onDragOver={(event) => {if (canReorder) event.preventDefault();}}
        onDrop={(event) => {event.preventDefault(); if (dragId) void move(dragId, row.id); setDragId(null);}}>
        <TableCell><span className="flex items-center gap-2">{canReorder && <GripVertical aria-hidden size={15} className="text-[#8992a1]" />}<span>{row.name}</span></span></TableCell>
        <TableCell>{row.parent_name || (row.level_rank ? `Rank ${row.level_rank}` : "—")}</TableCell><TableCell>{row.usage_count}</TableCell>
        <TableCell>{row.is_visible ? "Visible" : "Hidden"}{row.is_user_added && <span className="block text-xs text-[#8992a1]">User suggested</span>}</TableCell>
        <TableCell>{row.others_pending}</TableCell><TableCell>{new Date(row.updated_at).toLocaleDateString()}</TableCell>
        <TableCell><div className="flex items-center gap-2">
          {tab === "specialization" && <button aria-label={`Manage courses for ${row.name}`} disabled={busy} onClick={() => {setLinkSpecializations([row.id]); setLinkCourses(row.courses?.map((c) => c.id) || []); setLinksOpen(true);}}>Links</button>}
          <button title="Edit" aria-label={`Edit ${row.name}`} disabled={busy} onClick={() => begin({level: tab, action: "edit", option: row})}><Pencil size={16} /></button>
          <button title={row.is_visible ? "Hide" : "Show"} aria-label={`${row.is_visible ? "Hide" : "Show"} ${row.name}`} disabled={busy} onClick={() => perform(`${tab}/${row.id}`, {...payload(row), is_visible: !row.is_visible}, "PUT")}>{row.is_visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          <button aria-label={`Delete ${row.name}`} disabled={busy} onClick={() => setDeleting(row)}><Trash2 size={16} /></button>
          {canReorder && <><button aria-label={`Move ${row.name} up`} disabled={busy || index === 0} onClick={() => move(row.id, rows[index - 1].id)}><ArrowUp size={15} /></button>
            <button aria-label={`Move ${row.name} down`} disabled={busy || index === rows.length - 1} onClick={() => move(row.id, rows[index + 1].id)}><ArrowDown size={15} /></button></>}
        </div></TableCell>
      </TableRow>) : submissions.currentData?.items.map((row) => <TableRow key={row.id}>
        <TableCell>{row.raw_text}<span className="block text-xs text-[#8992a1]">{row.level}</span></TableCell>
        <TableCell>{row.parent_labels?.join(" → ") || Object.values(row.parent_chain).map(lookup).join(" → ") || "—"}</TableCell>
        <TableCell>{row.user_email || row.user_id}</TableCell><TableCell>{new Date(row.created_at).toLocaleDateString()}</TableCell><TableCell>{row.count}</TableCell><TableCell>{row.status}</TableCell>
        <TableCell>{row.status === "pending" && <div className="flex flex-col items-start gap-2 text-xs text-[#5F4DB2]">
          <button disabled={busy} onClick={() => begin({level: row.level, action: "approve", submission: row})}>Add as dropdown option</button>
          <button disabled={busy} onClick={() => begin({level: row.level, action: "merge", submission: row})}>Merge into existing option</button>
          <button disabled={busy} onClick={() => setRejecting(row)}>Reject</button>
        </div>}</TableCell>
      </TableRow>)}
      {(tab === "others" ? !submissions.currentData?.items.length : !rows.length) && <TableEmpty colSpan={7} loading={tab === "others" ? submissions.isFetching : options.isFetching} title="No matching entries" subtitle="Try a different search or add a new option." />}
    </TableBody></Table></TableContainer>
    <div className="flex items-center justify-end gap-3 text-sm"><span>{tab === "others" ? submissions.currentData?.total : options.currentData?.total} entries · Page {page + 1}</span>
      <Button variant="secondary" disabled={page === 0} onClick={() => setPage((v) => v - 1)}>Previous</Button><Button variant="secondary" disabled={!(tab === "others" ? submissions.currentData?.has_more : options.currentData?.has_more)} onClick={() => setPage((v) => v + 1)}>Next</Button></div>
    <Modal open={!!editor} title={editor?.action === "merge" ? "Merge suggestion" : editor?.submission ? "Add as dropdown option" : editor?.option ? "Edit option" : "Add option"} onClose={() => !busy && setEditor(null)} closeDisabled={busy}>
      {editor && <form className="mt-4 space-y-4" onSubmit={(event) => {event.preventDefault(); void saveEditor();}}>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {editor.action !== "merge" && <label className="block text-sm">Name<input autoFocus required maxLength={160} className={`${input} mt-1`} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        {(editor.level === "course" || editor.level === "specialization") && <label className="block text-sm">Parent<AppSelect searchable value={editParent} onChange={(id) => {setEditParent(id); setMergeId("");}} options={[{value: "", label: "Choose parent"}, ...parentOptions(editor.level).map((row) => ({value: row.id, label: `${row.name}${row.parent_name ? ` · ${row.parent_name}` : ""}`}))]} /></label>}
        {editor.level === "qualification" && editor.action !== "merge" && <label className="block text-sm">Level rank<AppSelect value={rank} onChange={setRank} options={Array.from({length: 9}, (_, i) => ({value: String(i + 1), label: `${i + 1}${i === 8 ? " (highest)" : i === 0 ? " (lowest)" : ""}`}))} /></label>}
        {editor.action === "merge" && <label className="block text-sm">Existing option<AppSelect searchable value={mergeId} onChange={setMergeId} options={[{value: "", label: targets.isFetching ? "Loading…" : "Choose option"}, ...(targets.currentData?.items ?? []).filter((row) => row.is_visible).map((row) => ({value: row.id, label: row.name}))]} /></label>}
        {editor.submission && <p className="text-sm text-[#687182]">Matching pending suggestions are resolved together. Their users are linked automatically if their answer is still current.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy}>Save</Button></div>
      </form>}
    </Modal>
    <Modal open={linksOpen} title="Attach or detach specializations" onClose={() => !busy && setLinksOpen(false)} closeDisabled={busy}>
      <p className="mt-3 text-sm text-[#687182]">Choose courses and specializations. A shared specialization&apos;s name and visibility apply across every course.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <input className={`${input} my-3`} aria-label="Search courses and specializations" placeholder="Search choices" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">{([
        {label: "Courses", rows: courses.currentData?.items ?? [], selected: linkCourses, set: setLinkCourses},
        {label: "Specializations", rows: specializations.currentData?.items ?? [], selected: linkSpecializations, set: setLinkSpecializations},
      ]).map((group) => <fieldset key={group.label} className="max-h-64 space-y-2 overflow-auto rounded-lg border border-[#e7e9ee] p-3"><legend className="font-semibold">{group.label}</legend>
        {group.rows.filter((row) => row.name.toLowerCase().includes(linkSearch.toLowerCase())).map((row) => <label key={row.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={group.selected.includes(row.id)} onChange={(event) => group.set((old) => event.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} />{row.name}{row.parent_name ? ` · ${row.parent_name}` : ""}</label>)}
      </fieldset>)}</div>
      {linkRevision.isError && <button className="text-sm text-red-700" onClick={() => linkRevision.refetch()}>Refresh link version</button>}
      <div className="mt-4 flex justify-end gap-2">{(["attach", "detach"] as const).map((action) => <Button key={action} variant={action === "detach" ? "secondary" : "primary"} disabled={busy || !linkCourses.length || !linkSpecializations.length || linkRevision.isFetching || !linkRevision.currentData} onClick={async () => {
        if (await perform("links", {course_ids: linkCourses, specialization_ids: linkSpecializations, action, revision: linkRevision.currentData!.revision}, "PUT")) setLinksOpen(false);
      }}>{action === "attach" ? "Attach selected" : "Detach selected"}</Button>)}</div>
    </Modal>
    <ConfirmModal open={!!deleting} title="Archive this option?" description="It will disappear from dropdowns. Existing users keep their saved value." confirmLabel="Archive" confirmLoading={busy} onClose={() => setDeleting(null)} onConfirm={async () => {if (deleting && await perform(`${tab}/${deleting.id}?version=${deleting.version}`, undefined, "DELETE")) setDeleting(null);}} />
    <ConfirmModal open={!!rejecting} title="Reject this suggestion?" description="Matching pending suggestions will be rejected. Users retain their original text." confirmLabel="Reject" confirmLoading={busy} onClose={() => setRejecting(null)} onConfirm={async () => {if (rejecting && await perform(`others/${rejecting.id}/resolve`, {action: "reject", version: rejecting.version})) setRejecting(null);}} />
  </div>;
}
