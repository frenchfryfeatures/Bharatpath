"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { Button, ConfirmModal, Modal, Table, TableContainer, TableHeader, TableHead, TableBody, TableRow, TableCell, TableEmpty } from "@/components/ui";
import { usePageHeader } from "@/components/layout/header-context";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { taxonomyAdminApi as api, type Level, type Option, type Submission } from "./api";

const tabs = [{key: "industry", label: "Industries"}, {key: "department", label: "Departments"}, {key: "category", label: "Role Categories"}, {key: "role", label: "Job Roles"}, {key: "others", label: "Others Submissions"}] as const;
const input = "w-full rounded-xl border border-[#e7e9ee] bg-white px-3 py-2 text-sm";
type Editor = {option?: Option; submission?: Submission; action: "approve" | "merge" | "edit"; level: Level};
const payload = (row: Option) => ({name: row.name, parent_id: row.parent_id, type: row.type || "Non-tech", sort_order: row.sort_order, is_visible: row.is_visible, version: row.version});

export function JobTaxonomyPage() {
  usePageHeader("Job Taxonomy", "Manage the choices candidates use to describe their work");
  const [tab, setTab] = useState<Level | "others">("industry");
  const [search, setSearch] = useState("");
  const q = useDebouncedSearch(search);
  const [parent, setParent] = useState("");
  const [industry, setIndustry] = useState("");
  const [status, setStatus] = useState("pending");
  const [levelFilter, setLevelFilter] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [kind, setKind] = useState("Non-tech");
  const [mergeId, setMergeId] = useState("");
  const [deleting, setDeleting] = useState<Option | null>(null);
  const [rejecting, setRejecting] = useState<Submission | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<{industry: string; ids: string[]; revision: string} | null>(null);
  const [change, saving] = api.useChangeTaxonomyMutation();
  const [exportFile, exporting] = api.useExportTaxonomyMutation();
  const industries = api.useTaxonomyAdminOptionsQuery("industry?limit=1000");
  const departments = api.useTaxonomyAdminOptionsQuery("department?limit=1000");
  const categories = api.useTaxonomyAdminOptionsQuery("category?limit=1000");
  const options = api.useTaxonomyAdminOptionsQuery(`${tab}?limit=100&offset=${page * 100}&q=${encodeURIComponent(q)}${parent ? `&parent_id=${parent}` : ""}`, {skip: tab === "others"});
  const reorderList = api.useTaxonomyAdminOptionsQuery(`${tab}?limit=1000${parent ? `&parent_id=${parent}` : ""}`, {skip: tab === "others" || !!q});
  const submissions = api.useTaxonomySubmissionsQuery(`status=${status}&limit=50&offset=${page * 50}&q=${encodeURIComponent(q)}${levelFilter ? `&level=${levelFilter}` : ""}`, {skip: tab !== "others"});
  const priorities = api.useTaxonomyPrioritiesQuery(industry, {skip: !industry || tab !== "department"});
  const targets = api.useTaxonomyAdminOptionsQuery(`${editor?.level || "industry"}?limit=1000${editParent ? `&parent_id=${editParent}` : ""}`, {skip: editor?.action !== "merge"});
  const parentOptions = (level: Level) => level === "category" ? departments.currentData?.items ?? [] : level === "role" ? categories.currentData?.items ?? [] : [];
  const rows = options.currentData?.items ?? [];
  const busy = saving.isLoading;
  const canReorder = !q && tab !== "others" && (!(tab === "category" || tab === "role") || !!parent) && !reorderList.currentData?.has_more && !reorderList.isFetching;
  const priorityIds = priorityDraft?.industry === industry ? priorityDraft.ids : priorities.currentData?.department_ids ?? [];
  const departmentRows = departments.currentData?.items ?? [];
  const priorityRows = [...priorityIds, ...departmentRows.filter((row) => !priorityIds.includes(row.id)).map((row) => row.id)]
    .map((id) => departmentRows.find((row) => row.id === id)).filter((row): row is Option => !!row);
  const begin = (value: Editor) => {
    setEditor(value); setName(value.option?.name || value.submission?.raw_text || "");
    setEditParent(value.option?.parent_id || value.submission?.parent_id || parent); setKind(value.option?.type || "Non-tech"); setMergeId(""); setError("");
  };
  async function perform(path: string, body?: unknown, method: "POST" | "PUT" | "DELETE" = "POST") {
    setError(""); setNotice("");
    try { await change({path, body, method}).unwrap(); setNotice("Changes saved."); return true; }
    catch (failure) { setError(getApiErrorMessage(failure, "The changes could not be saved. Refresh the list and try again.")); return false; }
  }
  async function saveEditor() {
    if (!editor) return;
    if (editor.action !== "merge" && !name.trim()) { setError("Enter a name."); return; }
    if ((editor.level === "category" || editor.level === "role") && !editParent) { setError("Choose a parent."); return; }
    if (editor.action === "merge" && !mergeId) { setError("Choose an existing option."); return; }
    const success = editor.submission ? await perform(`others/${editor.submission.id}/resolve`, {action: editor.action, version: editor.submission.version, name: name.trim(), parent_id: editParent || null, option_id: mergeId || null, type: kind}) :
      await perform(`${editor.level}${editor.option ? `/${editor.option.id}` : ""}`, {...(editor.option ? payload(editor.option) : {}), name: name.trim(), parent_id: editParent || null, type: kind}, editor.option ? "PUT" : "POST");
    if (success) setEditor(null);
  }
  async function move(source: string, target: string) {
    if (!canReorder || busy || source === target) return;
    const all = reorderList.currentData?.items ?? [];
    const ids = all.map((row) => row.id); const from = ids.indexOf(source); const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await perform(`${tab}/reorder`, {ids, versions: Object.fromEntries(all.map((row) => [row.id, row.version]))});
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
  const lookup = (id: string) => [...(industries.currentData?.items ?? []), ...departmentRows, ...(categories.currentData?.items ?? [])].find((row) => row.id === id)?.name || id;
  const listError = tab === "others" ? submissions.isError : options.isError;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job taxonomy">
      {tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === item.key ? "bg-[#5F4DB2] text-white" : "border border-[#e7e9ee] bg-white text-[#687182]"}`}
        onClick={() => {setTab(item.key); setParent(""); setSearch(""); setPage(0); setError(""); setNotice("");}}>{item.label}</button>)}
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-[#267044]">{notice}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label="Search taxonomy" placeholder="Search by name" className={`${input} max-w-xs`} value={search} onChange={(event) => {setSearch(event.target.value); setPage(0);}} />
      {(tab === "category" || tab === "role") && <div className="min-w-64"><AppSelect searchable ariaLabel="Filter by parent" value={parent} onChange={(id) => {setParent(id); setPage(0);}}
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
        <Button disabled={busy} onClick={() => begin({level: tab, action: "edit"})}><Plus size={14} />Add</Button>
      </div>}
    </div>
    {tab !== "others" && <p className="text-xs text-[#687182]">{canReorder ? "Drag rows or use the arrows to reorder." : "Clear search and choose one parent to reorder."} Hidden or archived choices remain on existing profiles.</p>}
    {listError && <p role="alert" className="text-sm text-red-700">The list could not be loaded. <button className="underline" onClick={() => tab === "others" ? submissions.refetch() : options.refetch()}>Retry</button></p>}
    <TableContainer><Table><TableHeader><TableRow>
      {(tab === "others" ? ["Text / Level", "Parent chain", "User", "Date", "Users with same text", "Status", "Actions"] : ["Name", "Parent / Type", "Usage", "Status", "Others pending", "Last updated", "Actions"]).map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
    </TableRow></TableHeader><TableBody>
      {tab !== "others" ? rows.map((row, index) => <TableRow key={row.id} draggable={canReorder && !busy}
        onDragStart={() => setDragId(row.id)} onDragOver={(event) => {if (canReorder) event.preventDefault();}}
        onDrop={(event) => {event.preventDefault(); if (dragId) void move(dragId, row.id); setDragId(null);}}>
        <TableCell><span className="flex items-center gap-2">{canReorder && <GripVertical aria-hidden size={15} className="text-[#8992a1]" />}<span>{row.name}</span></span></TableCell>
        <TableCell>{row.parent_name || row.type || "—"}</TableCell><TableCell>{row.usage_count}</TableCell>
        <TableCell>{row.is_visible ? "Visible" : "Hidden"}{row.is_user_added && <span className="block text-xs text-[#8992a1]">User suggested</span>}</TableCell>
        <TableCell>{row.others_pending}</TableCell><TableCell>{new Date(row.updated_at).toLocaleDateString()}</TableCell>
        <TableCell><div className="flex items-center gap-2">
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
    {tab === "department" && <section className="space-y-4 rounded-2xl border border-[#e7e9ee] bg-white p-5">
      <h2 className="font-semibold">Department priority by industry</h2><p className="text-sm text-[#687182]">Every industry shows every department. Set priority departments first; remaining departments follow.</p>
      <AppSelect searchable ariaLabel="Priority industry" value={industry} onChange={(id) => {setIndustry(id); setPriorityDraft(null);}}
        options={[{value: "", label: "Choose an industry"}, ...(industries.currentData?.items ?? []).map((row) => ({value: row.id, label: row.name}))]} />
      {priorities.isError && <button className="text-sm text-red-700 underline" onClick={() => priorities.refetch()}>Could not load priorities. Retry</button>}
      {industry && !priorities.isFetching && <><ol className="grid gap-2 sm:grid-cols-2">{priorityRows.map((row, index) => <li key={row.id} draggable={!busy}
        onDragStart={() => setDragId(row.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
          e.preventDefault(); const ids = priorityRows.map((d) => d.id); const from = dragId ? ids.indexOf(dragId) : -1;
          if (from >= 0) {ids.splice(index, 0, ids.splice(from, 1)[0]); setPriorityDraft({industry, ids, revision: priorityDraft?.industry === industry ? priorityDraft.revision : priorities.currentData!.revision});} setDragId(null);
        }} className="flex items-center gap-2 rounded-lg border border-[#e7e9ee] p-2 text-sm"><GripVertical size={14} />{index + 1}. {row.name}
        <button className="ml-auto" aria-label={`Prioritize ${row.name}`} disabled={index === 0 || busy} onClick={() => {const ids = priorityRows.map((d) => d.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; setPriorityDraft({industry, ids, revision: priorityDraft?.industry === industry ? priorityDraft.revision : priorities.currentData!.revision});}}><ArrowUp size={14} /></button></li>)}</ol>
        <Button disabled={busy || !priorityDraft || !priorities.currentData} onClick={async () => {if (priorityDraft && await perform(`priorities/${industry}`, {department_ids: priorityDraft.ids, revision: priorityDraft.revision}, "PUT")) setPriorityDraft(null);}}>Save priority order</Button></>}
    </section>}
    <Modal open={!!editor} title={editor?.action === "merge" ? "Merge suggestion" : editor?.submission ? "Add as dropdown option" : editor?.option ? "Edit option" : "Add option"} onClose={() => !busy && setEditor(null)} closeDisabled={busy}>
      {editor && <form className="mt-4 space-y-4" onSubmit={(event) => {event.preventDefault(); void saveEditor();}}>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {editor.action !== "merge" && <label className="block text-sm">Name<input autoFocus required maxLength={160} className={`${input} mt-1`} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        {(editor.level === "category" || editor.level === "role") && <label className="block text-sm">Parent<AppSelect searchable value={editParent} onChange={(id) => {setEditParent(id); setMergeId("");}} options={[{value: "", label: "Choose parent"}, ...parentOptions(editor.level).map((row) => ({value: row.id, label: `${row.name}${row.parent_name ? ` · ${row.parent_name}` : ""}`}))]} /></label>}
        {editor.level === "department" && editor.action !== "merge" && <label className="block text-sm">Type<AppSelect value={kind} onChange={setKind} options={[{value: "Tech", label: "Tech"}, {value: "Non-tech", label: "Non-tech"}]} /></label>}
        {editor.action === "merge" && <label className="block text-sm">Existing option<AppSelect searchable value={mergeId} onChange={setMergeId} options={[{value: "", label: targets.isFetching ? "Loading…" : "Choose option"}, ...(targets.currentData?.items ?? []).filter((row) => row.is_visible).map((row) => ({value: row.id, label: row.name}))]} /></label>}
        {editor.submission && <p className="text-sm text-[#687182]">Matching pending suggestions are resolved together. Their users are linked automatically if their answer is still current.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy}>Save</Button></div>
      </form>}
    </Modal>
    <ConfirmModal open={!!deleting} title="Archive this option?" description="It will disappear from dropdowns. Existing users keep their saved value." confirmLabel="Archive" confirmLoading={busy} onClose={() => setDeleting(null)} onConfirm={async () => {if (deleting && await perform(`${tab}/${deleting.id}?version=${deleting.version}`, undefined, "DELETE")) setDeleting(null);}} />
    <ConfirmModal open={!!rejecting} title="Reject this suggestion?" description="Matching pending suggestions will be rejected. Users retain their original text." confirmLabel="Reject" confirmLoading={busy} onClose={() => setRejecting(null)} onConfirm={async () => {if (rejecting && await perform(`others/${rejecting.id}/resolve`, {action: "reject", version: rejecting.version})) setRejecting(null);}} />
  </div>;
}
