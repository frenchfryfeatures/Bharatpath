import type {
  CreateSearchFilterOption,
  SearchFilterKind,
} from "@/store/api/admin-api";

/*
 * CSV bulk import for search filter options.
 *
 * The file is parsed and checked here, then sent as the JSON body of
 * `POST /admin/search-filters/import`. The checks mirror the backend's
 * request schema: the backend still validates and refuses the whole file if
 * any row is bad, but catching it here names every bad row at once.
 */

/** The most rows one request may carry (the backend's `max_length`). */
export const MAX_IMPORT_ROWS = 500;
const MAX_LABEL_LENGTH = 100;
const MAX_ALIASES = 10;
const MAX_SORT_ORDER = 10_000;
/** Aliases share one cell, so they are separated by this, not a comma. */
export const ALIAS_SEPARATOR = ";";

const COLUMNS: Record<SearchFilterKind, readonly string[]> = {
  SKILL: ["label", "aliases", "featured", "sort_order"],
  CITY: ["label", "state_code", "aliases", "featured", "sort_order"],
};

const REQUIRED_COLUMNS: Record<SearchFilterKind, readonly string[]> = {
  SKILL: ["label"],
  CITY: ["label", "state_code"],
};

const TEMPLATE_ROWS: Record<SearchFilterKind, string[][]> = {
  SKILL: [
    ["Microsoft Excel", "Excel;MS Excel", "true", "10"],
    ["Python", "", "false", "0"],
    ["Customer Service", "Customer Support;Client Service", "false", "20"],
  ],
  CITY: [
    ["Bengaluru", "KA", "Bangalore", "true", "10"],
    ["Pune", "MH", "", "false", "0"],
    ["Mumbai", "MH", "Bombay", "true", "20"],
  ],
};

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The downloadable template: the header row and a few worked examples. */
export function importTemplate(kind: SearchFilterKind): string {
  return [COLUMNS[kind], ...TEMPLATE_ROWS[kind]]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

export function importTemplateFileName(kind: SearchFilterKind): string {
  return `attributes-${kind === "SKILL" ? "skills" : "cities"}-template.csv`;
}

export function downloadImportTemplate(kind: SearchFilterKind): void {
  const blob = new Blob([importTemplate(kind)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = importTemplateFileName(kind);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * RFC 4180 parsing: quoted fields may hold commas, quotes (doubled) and line
 * breaks. A leading byte-order mark, which Excel writes, is dropped.
 */
export function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank rows are kept, so a row's index is its row number in a spreadsheet.
  return rows;
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

/** The backend's city rule: letters, combining marks, spaces and `. ' -`. */
function cityNameProblem(label: string): string | null {
  if (!/^[\p{L}\p{M} .'-]+$/u.test(label)) {
    return "a city name is letters, spaces and . ' - only";
  }
  if (!/\p{L}/u.test(label)) {
    return "a city name needs at least one letter";
  }
  return null;
}

export interface ImportRowError {
  /** The spreadsheet row number, counting the header as row 1. */
  line: number;
  message: string;
}

export interface ParsedImport {
  items: CreateSearchFilterOption[];
  errors: ImportRowError[];
  /** A problem with the file as a whole (header, size), not one row. */
  fileError: string | null;
}

const TRUE_VALUES = new Set(["true", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0", ""]);

function parseFeatured(value: string): boolean | null {
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  return null;
}

/** Parse and validate a CSV file for one kind of option. */
export function parseImportCsv(
  kind: SearchFilterKind,
  source: string,
): ParsedImport {
  const empty = (fileError: string): ParsedImport => ({
    items: [],
    errors: [],
    fileError,
  });
  const rows = parseCsv(source);
  const headerIndex = rows.findIndex((cells) => !isBlankRow(cells));

  if (headerIndex === -1) {
    return empty("The file is empty. Start from the template.");
  }

  const header = rows[headerIndex].map((cell) => cell.trim().toLowerCase());
  const allowed = new Set(COLUMNS[kind]);
  const unknown = header.filter((name) => name && !allowed.has(name));
  const missing = REQUIRED_COLUMNS[kind].filter(
    (name) => !header.includes(name),
  );

  if (missing.length > 0 || unknown.length > 0) {
    const plural = (names: string[]) =>
      `column${names.length === 1 ? "" : "s"} ${names.join(", ")}`;
    const problems = [
      missing.length ? `missing ${plural(missing)}` : "",
      unknown.length ? `unexpected ${plural(unknown)}` : "",
    ].filter(Boolean);
    return empty(
      `Check the header row: ${problems.join("; ")}. Expected columns: ${COLUMNS[kind].join(", ")}.`,
    );
  }

  const dataRows = rows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .slice(headerIndex + 1)
    .filter(({ cells }) => !isBlankRow(cells));
  if (dataRows.length === 0) {
    return empty("The file has a header but no rows to import.");
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return empty(
      `The file has ${dataRows.length} rows; one import can contain at most ${MAX_IMPORT_ROWS}.`,
    );
  }

  const column = (cells: string[], name: string): string => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (cells[index] ?? "").trim();
  };

  const items: CreateSearchFilterOption[] = [];
  const errors: ImportRowError[] = [];
  const seenLabels = new Map<string, number>();

  dataRows.forEach(({ cells, line }) => {
    const rowErrors: string[] = [];

    const label = column(cells, "label").split(/\s+/).join(" ");
    if (!label) {
      rowErrors.push("label is required");
    } else if (label.length > MAX_LABEL_LENGTH) {
      rowErrors.push(`label is longer than ${MAX_LABEL_LENGTH} characters`);
    } else {
      const cityProblem = kind === "CITY" ? cityNameProblem(label) : null;
      const key = label.toLowerCase();
      const firstLine = seenLabels.get(key);
      if (cityProblem) {
        rowErrors.push(cityProblem);
      } else if (firstLine) {
        rowErrors.push(`"${label}" is already on row ${firstLine}`);
      } else {
        seenLabels.set(key, line);
      }
    }

    const aliases = Array.from(
      new Set(
        column(cells, "aliases")
          .split(ALIAS_SEPARATOR)
          .map((alias) => alias.split(/\s+/).join(" ").trim())
          .filter(Boolean),
      ),
    );
    if (aliases.length > MAX_ALIASES) {
      rowErrors.push(`has ${aliases.length} aliases; at most ${MAX_ALIASES}`);
    }

    let stateCode: string | null = null;
    if (kind === "CITY") {
      stateCode = column(cells, "state_code").toUpperCase();
      if (!/^[A-Z]{2}$/.test(stateCode)) {
        rowErrors.push("state_code must be two letters, e.g. MH");
      }
    }

    const featured = parseFeatured(column(cells, "featured"));
    if (featured === null) {
      rowErrors.push("featured must be true or false");
    }

    const sortSource = column(cells, "sort_order");
    const sortOrder = sortSource === "" ? 0 : Number(sortSource);
    if (
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > MAX_SORT_ORDER
    ) {
      rowErrors.push(`sort_order must be a whole number from 0 to ${MAX_SORT_ORDER}`);
    }

    if (rowErrors.length > 0) {
      errors.push({ line, message: rowErrors.join("; ") });
      return;
    }

    items.push({
      kind,
      label,
      aliases,
      state_code: stateCode,
      featured: featured ?? false,
      sort_order: sortOrder,
    });
  });

  return { items, errors, fileError: null };
}
