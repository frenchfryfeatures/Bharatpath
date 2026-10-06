"use client";

import { useState } from "react";
import {
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";

import {
  ConfirmModal,
  DataTable,
  ErrorState,
  Modal,
  type ColumnDef,
} from "@/components/ui";
import { usePageHeader } from "@/components/layout/header-context";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useCursorPagination } from "@/lib/pagination/use-cursor-pagination";
import {
  useCreateAdminSearchFilterMutation,
  useGetAdminSearchFiltersQuery,
  useImportAdminSearchFiltersMutation,
  useUpdateAdminSearchFilterMutation,
  type CreateSearchFilterOption,
  type SearchFilterKind,
  type SearchFilterOption,
} from "@/store/api/admin-api";
import { showAdminFeedback } from "@/store/admin";
import { useAppDispatch } from "@/store/hooks";

import { parseImportCsv, type ParsedImport } from "../csv";
import { CsvImportPanel } from "./csv-import-panel";

interface FilterFormState {
  label: string;
  aliases: string;
  stateCode: string;
  featured: boolean;
}

const EMPTY_FORM: FilterFormState = {
  label: "",
  aliases: "",
  stateCode: "",
  featured: false,
};

function formFor(option: SearchFilterOption): FilterFormState {
  return {
    label: option.label,
    aliases: option.aliases.join(", "),
    stateCode: option.state_code ?? "",
    featured: option.featured,
  };
}

type FilterErrors = Partial<Record<"label" | "stateCode" | "aliases", string>>;

function formPayload(
  kind: SearchFilterKind,
  form: FilterFormState,
): { value?: CreateSearchFilterOption; errors?: FilterErrors } {
  const label = form.label.trim();
  const aliases = Array.from(
    new Set(
      form.aliases
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    ),
  );
  const stateCode = form.stateCode.trim().toUpperCase();

  const errors: FilterErrors = {};
  if (!label) {
    errors.label = kind === "SKILL" ? "Enter the skill's name." : "Enter the city's name.";
  } else if (label.length > 100) {
    errors.label = "Use 100 characters or fewer.";
  }
  if (aliases.length > 10) {
    errors.aliases = `An option can have at most 10 aliases. You entered ${aliases.length}.`;
  } else if (aliases.some((alias) => alias.length > 100)) {
    errors.aliases = "Each alias must be 100 characters or fewer.";
  }
  if (kind === "CITY" && !/^[A-Z]{2}$/.test(stateCode)) {
    errors.stateCode = "Enter the two-letter state code, like KA.";
  }
  if (Object.keys(errors).length) {
    return { errors };
  }

  return {
    value: {
      kind,
      label,
      aliases,
      state_code: kind === "CITY" ? stateCode : null,
      featured: form.featured,
    },
  };
}

export function SearchFiltersPage() {
  usePageHeader(
    "Attributes",
    "Curate the skills and cities employers can select when searching",
  );

  const dispatch = useAppDispatch();
  const [kind, setKind] = useState<SearchFilterKind>("SKILL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [includeInactive, setIncludeInactive] = useState(false);
  const pagination = useCursorPagination(
    [kind, debouncedSearch, includeInactive],
    10,
  );
  const [editor, setEditor] = useState<{
    optionId: string | null;
    form: FilterFormState;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingToggle, setPendingToggle] =
    useState<SearchFilterOption | null>(null);
  const [importFile, setImportFile] = useState<{
    name: string;
    parsed: ParsedImport;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FilterErrors>({});
  const [requestError, setRequestError] = useState<unknown>(null);

  const {
    currentData,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetAdminSearchFiltersQuery({
    kind,
    q: debouncedSearch || undefined,
    includeInactive,
    cursor: pagination.cursor,
    limit: pagination.pageSize,
  });
  const [createOption, createState] =
    useCreateAdminSearchFilterMutation();
  const [importOptions, importState] =
    useImportAdminSearchFiltersMutation();
  const [updateOption, updateState] =
    useUpdateAdminSearchFilterMutation();
  const isSaving =
    createState.isLoading ||
    importState.isLoading ||
    updateState.isLoading;

  function chooseKind(nextKind: SearchFilterKind) {
    setKind(nextKind);
    if (nextKind !== kind) {
      setSearch("");
    }
    setEditor(null);
    setFieldErrors({});
    setImportOpen(false);
    setImportFile(null);
    setPendingToggle(null);
    setFormError(null);
    setRequestError(null);
  }

  async function saveEditor() {
    if (!editor) {
      return;
    }

    const parsed = formPayload(kind, editor.form);
    if (!parsed.value) {
      setFieldErrors(parsed.errors ?? {});
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setRequestError(null);
    try {
      if (editor.optionId) {
        await updateOption({
          optionId: editor.optionId,
          changes: {
            label: parsed.value.label,
            aliases: parsed.value.aliases,
            state_code: parsed.value.state_code,
            featured: parsed.value.featured,
          },
        }).unwrap();
        dispatch(showAdminFeedback("Attribute updated."));
      } else {
        await createOption(parsed.value).unwrap();
        dispatch(showAdminFeedback("Attribute created."));
      }
      setEditor(null);
    } catch (mutationError) {
      setRequestError(mutationError);
    }
  }

  async function chooseImportFile(file: File) {
    setFormError(null);
    setRequestError(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportFile(null);
      setFormError("Choose a .csv file. Download the template to start.");
      return;
    }

    try {
      setImportFile({
        name: file.name,
        parsed: parseImportCsv(kind, await file.text()),
      });
    } catch {
      setImportFile(null);
      setFormError("The file could not be read. Save it as CSV and try again.");
    }
  }

  async function saveImport() {
    const parsed = importFile?.parsed;
    if (!parsed || parsed.fileError || parsed.errors.length > 0) {
      setFormError(
        parsed
          ? "Fix the rows listed below, then choose the file again."
          : "Choose a CSV file to import.",
      );
      return;
    }

    setFormError(null);
    setRequestError(null);
    try {
      const result = await importOptions(parsed.items).unwrap();
      dispatch(
        showAdminFeedback(
          `${result.items.length} attribute${result.items.length === 1 ? "" : "s"} imported.`,
        ),
      );
      setImportOpen(false);
      setImportFile(null);
    } catch (mutationError) {
      setRequestError(mutationError);
    }
  }

  async function confirmToggleActive() {
    if (!pendingToggle) {
      return;
    }

    const option = pendingToggle;
    setRequestError(null);
    try {
      await updateOption({
        optionId: option.id,
        changes: { active: !option.active },
      }).unwrap();
      dispatch(
        showAdminFeedback(
          option.active
            ? "Attribute switched off."
            : "Attribute reactivated.",
        ),
      );
      setPendingToggle(null);
    } catch (mutationError) {
      setRequestError(mutationError);
    }
  }

  function closeActionDialog() {
    if (isSaving) {
      return;
    }
    setEditor(null);
    setFieldErrors({});
    setImportOpen(false);
    setImportFile(null);
    setPendingToggle(null);
    setFormError(null);
    setRequestError(null);
  }

  const columns: ColumnDef<SearchFilterOption>[] = [
    {
      id: "label",
      header: "Label",
      headerClassName: "min-w-[220px]",
      cellClassName: "min-w-[220px]",
      cell: (option) => (
        <div>
          <p className="font-semibold">{option.label}</p>
          <p className="mt-0.5 text-[10px] text-[#8a92a0]">{option.key}</p>
        </div>
      ),
    },
    {
      id: "aliases",
      header: "Aliases",
      headerClassName: "min-w-[280px]",
      cellClassName: "min-w-[280px] max-w-[360px] text-[#687182]",
      cell: (option) =>
        option.aliases.length ? option.aliases.join(", ") : "-",
    },
    ...(kind === "CITY"
      ? [
          {
            id: "state",
            header: "State",
            headerClassName: "min-w-[90px]",
            cellClassName: "min-w-[90px]",
            cell: (option: SearchFilterOption) => option.state_code ?? "-",
          },
        ]
      : []),
    {
      id: "featured",
      header: "Featured",
      headerClassName: "min-w-[100px]",
      cellClassName: "min-w-[100px]",
      cell: (option) => (option.featured ? "Yes" : "No"),
    },
    {
      id: "status",
      header: "Status",
      headerClassName: "min-w-[110px]",
      cellClassName: "min-w-[110px]",
      cell: (option) => (
        <span
          className={[
            "rounded-full px-2 py-1 text-[10px] font-semibold",
            option.active
              ? "bg-[#e8f5ed] text-[#267044]"
              : "bg-[#f0f1f4] text-[#687182]",
          ].join(" ")}
        >
          {option.active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "min-w-[190px] text-right",
      cellClassName: "min-w-[190px]",
      cell: (option) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setEditor({
                optionId: option.id,
                form: formFor(option),
              });
              setImportOpen(false);
              setPendingToggle(null);
              setFormError(null);
              setRequestError(null);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-[#d9dee7] px-2 py-1.5 font-semibold text-[#43516a] hover:bg-[#f7f8fa]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => {
              setPendingToggle(option);
              setEditor(null);
              setImportOpen(false);
              setFormError(null);
              setRequestError(null);
            }}
            className="rounded-lg border border-[#d9dee7] px-2 py-1.5 font-semibold text-[#43516a] hover:bg-[#f7f8fa] disabled:opacity-50"
          >
            {option.active ? "Switch off" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];
  const paginationProps = {
    currentPage: pagination.currentPage,
    hasNextPage: Boolean(currentData?.next_cursor),
    onNextPage: () => pagination.goToNextPage(currentData?.next_cursor),
    onPreviousPage: pagination.goToPreviousPage,
    onPageSizeChange: pagination.setPageSize,
  };
  const tableLoading = isLoading || (isFetching && !currentData);
  const searchPlaceholder =
    kind === "SKILL"
      ? "Search by skill name or alias"
      : "Search by city name or alias";

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7e9ee]">
        <div className="flex items-center gap-1">
          {(["SKILL", "CITY"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseKind(value)}
              className={[
                "relative px-4 py-3 text-[13px] font-semibold",
                kind === value
                  ? "text-[#172033]"
                  : "text-[#687182] hover:text-[#172033]",
              ].join(" ")}
            >
              {value === "SKILL" ? "Skills" : "Cities"}
              {kind === value ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#315c9f]" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pb-2">
          <button
            type="button"
            onClick={() => {
              setImportOpen(true);
              setEditor(null);
              setPendingToggle(null);
              setFormError(null);
              setRequestError(null);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9dee7] bg-white px-3 text-[12px] font-semibold text-[#43516a] hover:bg-[#f7f8fa]"
          >
            <Upload className="h-4 w-4" />
            Bulk import
          </button>
          <button
            type="button"
            onClick={() => {
              setEditor({ optionId: null, form: EMPTY_FORM });
              setImportOpen(false);
              setPendingToggle(null);
              setFormError(null);
              setRequestError(null);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#315c9f] px-3 text-[12px] font-semibold text-white hover:bg-[#284f89]"
          >
            <Plus className="h-4 w-4" />
            Add {kind === "SKILL" ? "skill" : "city"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-9 min-w-64 flex-1 items-center gap-2 rounded-lg border border-[#e2e5eb] bg-white px-3 focus-within:border-[#315c9f]">
          <Search className="h-4 w-4 text-[#687182]" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#172033] outline-none placeholder:text-[#8a92a0]"
          />
        </label>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-[#e2e5eb] bg-white px-3 text-[12px] font-semibold text-[#566176]">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Show inactive
        </label>
      </div>

      {error ? (
        <ErrorState
          error={error}
          fallback="Attributes could not be loaded."
          onRetry={() => void refetch()}
        />
      ) : null}

      {editor ? (
        <Modal
          open
          title={`${editor.optionId ? "Edit" : "Add"} ${
            kind === "SKILL" ? "skill" : "city"
          }`}
          description="Changes are applied to the options employers can choose in candidate search."
          onClose={closeActionDialog}
          closeDisabled={isSaving}
          panelClassName="max-w-[640px]"
        >
          {requestError ? (
            <ErrorState
              error={requestError}
              fallback="The attribute change could not be saved."
              className="mb-4"
            />
          ) : null}
          {formError ? <ErrorState message={formError} className="mb-4" /> : null}
          <FilterEditor
            kind={kind}
            form={editor.form}
            isSaving={isSaving}
            errors={fieldErrors}
            onChange={(form) => {
              setFieldErrors({});
              setEditor((current) =>
                current ? { ...current, form } : current,
              );
            }}
            onCancel={closeActionDialog}
            onSave={() => void saveEditor()}
          />
        </Modal>
      ) : null}

      {importOpen ? (
        <Modal
          open
          title={`Bulk import ${kind === "SKILL" ? "skills" : "cities"}`}
          description="Upload a CSV file. It is checked here first, then every row is imported together, or none are."
          onClose={closeActionDialog}
          closeDisabled={isSaving}
          panelClassName="max-w-[680px]"
        >
          {requestError ? (
            <ErrorState
              error={requestError}
              fallback="The attributes could not be imported."
              className="mb-4"
            />
          ) : null}
          {formError ? <ErrorState message={formError} className="mb-4" /> : null}
          <CsvImportPanel
            kind={kind}
            file={importFile}
            isSaving={isSaving}
            onChooseFile={(file) => void chooseImportFile(file)}
            onClearFile={() => {
              setImportFile(null);
              setFormError(null);
              setRequestError(null);
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeActionDialog}
              disabled={isSaving}
              className="rounded-lg border border-[#d9dee7] px-3 py-2 text-[12px] font-semibold text-[#566176] hover:bg-[#f7f8fa]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                isSaving ||
                !importFile ||
                Boolean(importFile.parsed.fileError) ||
                importFile.parsed.errors.length > 0
              }
              onClick={() => void saveImport()}
              className="rounded-lg bg-[#315c9f] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#284f89] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving
                ? "Importing..."
                : importFile && !importFile.parsed.fileError && importFile.parsed.errors.length === 0
                  ? `Import ${importFile.parsed.items.length} row${importFile.parsed.items.length === 1 ? "" : "s"}`
                  : "Import"}
            </button>
          </div>
        </Modal>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[#e2e5eb] bg-white">
        <div className="flex items-center justify-between border-b border-[#e9ebef] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#172033]">
              {kind === "SKILL" ? "Skill options" : "City options"}
            </h2>
          </div>
          {isFetching && !isLoading ? (
            <span className="text-[11px] text-[#7b8494]">Refreshing...</span>
          ) : null}
        </div>

        <DataTable<SearchFilterOption>
          data={currentData?.items ?? []}
          columns={columns}
          keyExtractor={(option) => option.id}
          isLoading={tableLoading}
          skeletonRows={10}
          emptyTitle="No attributes match this view."
          emptySubtitle=""
          paginationMode="cursor"
          pageSize={pagination.pageSize}
          itemLabel="options"
          className="rounded-none border-0 shadow-none"
          {...paginationProps}
        />
      </section>

      <ConfirmModal
        open={pendingToggle !== null}
        title={
          pendingToggle?.active
            ? "Switch off attribute?"
            : "Reactivate attribute?"
        }
        description={
          pendingToggle
            ? pendingToggle.active
              ? `"${pendingToggle.label}" will stop appearing in employer filter suggestions.`
              : `"${pendingToggle.label}" will be available in employer filter suggestions again.`
            : ""
        }
        confirmLabel={pendingToggle?.active ? "Switch off" : "Reactivate"}
        cancelLabel="Cancel"
        confirmLoading={updateState.isLoading}
        onConfirm={() => void confirmToggleActive()}
        onClose={closeActionDialog}
      >
        {requestError ? (
          <ErrorState
            error={requestError}
            fallback="The attribute status could not be changed."
          />
        ) : null}
      </ConfirmModal>
    </div>
  );
}

function FilterEditor({
  kind,
  form,
  isSaving,
  errors,
  onChange,
  onCancel,
  onSave,
}: {
  kind: SearchFilterKind;
  form: FilterFormState;
  isSaving: boolean;
  errors: FilterErrors;
  onChange: (form: FilterFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <div className="grid gap-3">
        <Field label="Label" error={errors.label}>
          <input
            aria-invalid={errors.label ? true : undefined}
            value={form.label}
            maxLength={100}
            placeholder={
              kind === "SKILL" ? "e.g. Data Analysis" : "e.g. Bengaluru"
            }
            onChange={(event) =>
              onChange({ ...form, label: event.target.value })
            }
            className={fieldClass(errors.label)}
          />
        </Field>
        {kind === "CITY" ? (
          <Field label="State code" error={errors.stateCode}>
            <input
              aria-invalid={errors.stateCode ? true : undefined}
              value={form.stateCode}
              maxLength={2}
              placeholder="e.g. KA"
              onChange={(event) =>
                onChange({
                  ...form,
                  stateCode: event.target.value.toUpperCase(),
                })
              }
              className={`${fieldClass(errors.stateCode)} uppercase`}
            />
          </Field>
        ) : null}
        <Field label="Aliases (comma separated)" error={errors.aliases}>
          <input
            aria-invalid={errors.aliases ? true : undefined}
            value={form.aliases}
            placeholder={
              kind === "SKILL"
                ? "e.g. Excel, MS Excel"
                : "e.g. Bangalore, Bengaluru Urban"
            }
            onChange={(event) =>
              onChange({ ...form, aliases: event.target.value })
            }
            className={fieldClass(errors.aliases)}
          />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-[#566176]">
        <input
          type="checkbox"
          checked={form.featured}
          onChange={(event) =>
            onChange({ ...form, featured: event.target.checked })
          }
        />
        Show in the employer panel before typing
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[#d9dee7] px-3 py-2 text-[12px] font-semibold text-[#566176]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onSave}
          className="rounded-lg bg-[#315c9f] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function fieldClass(error?: string) {
  return `h-9 w-full rounded-lg border px-3 text-[12px] text-[#172033] outline-none placeholder:text-[#a0a7b4] ${
    error ? "border-[#d92d20] focus:border-[#d92d20]" : "border-[#dfe4ec] focus:border-[#315c9f]"
  }`;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#687182]">
      {label}
      {children}
      {error ? (
        <span role="alert" className="text-[12px] font-medium text-[#b42318]">
          {error}
        </span>
      ) : null}
    </label>
  );
}
