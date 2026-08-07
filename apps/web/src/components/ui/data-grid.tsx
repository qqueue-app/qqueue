import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/use-media-query";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import { IconButton } from "./icon-button.js";
import { Input } from "./input.js";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";
import { Skeleton } from "./skeleton.js";

/**
 * Extra per-column metadata the grid understands. Set it via a column's `meta`.
 */
export interface DataGridColumnMeta {
  /** Human label used by the column-visibility menu when the header is not a string. */
  title?: string;
  /** Hide this column below the `md` breakpoint. */
  hideBelowMd?: boolean;
  /** Hide this column below the `lg` breakpoint. */
  hideBelowLg?: boolean;
  /** Right-align numeric columns. */
  align?: "left" | "right" | "center";
  /** Exclude from the column-visibility menu (selection/action columns). */
  pinned?: boolean;
  cellClassName?: string;
  headerClassName?: string;
}

declare module "@tanstack/react-table" {
  // The library declares ColumnMeta as an empty interface for exactly this —
  // both parameters must be named to match its signature even though neither
  // is referenced here.
  /* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type */
  interface ColumnMeta<TData, TValue> extends DataGridColumnMeta {}
  /* eslint-enable @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type */
}

/**
 * A column in a DataGrid. The value type is `unknown` rather than a concrete
 * one because a grid's columns each project a different shape out of the row —
 * pinning it to one type would make every heterogeneous column set unassignable.
 */
export type DataGridColumn<TData> = ColumnDef<TData, unknown>;

export interface DataGridProps<TData> {
  data: TData[];
  columns: DataGridColumn<TData>[];
  /** Stable row identity — required for selection to survive refetches. */
  getRowId: (row: TData) => string;
  loading?: boolean;
  /** Rendered in place of the table body when there are no rows at all. */
  empty?: React.ReactNode;
  /** Rendered when a search or filter matched nothing. Falls back to `empty`. */
  noResults?: React.ReactNode;
  searchPlaceholder?: string;
  /** Omit to hide the search field entirely. */
  searchable?: boolean;
  /** Extra controls rendered in the toolbar, left of the column menu. */
  toolbar?: React.ReactNode;
  /** Rendered when at least one row is selected; receives the selected rows. */
  bulkActions?: (rows: TData[], clear: () => void) => React.ReactNode;
  enableSelection?: boolean;
  onRowClick?: (row: TData) => void;
  /**
   * Mobile presentation. The grid drops the table below `md` and renders this
   * per row instead — a table squeezed onto a phone is unreadable, and this app
   * has to work as an installed PWA.
   */
  renderMobileRow?: (row: TData) => React.ReactNode;
  pageSize?: number;
  /** Hide pagination when the caller already pages server-side. */
  paginated?: boolean;
  className?: string;
  /** Accessible name for the table. */
  label: string;
}

function headerTitle<TData>(column: {
  columnDef: DataGridColumn<TData>;
  id: string;
}): string {
  const meta = column.columnDef.meta as DataGridColumnMeta | undefined;
  if (meta?.title) return meta.title;
  const header = column.columnDef.header;
  return typeof header === "string" ? header : column.id;
}

function alignmentClass(meta: DataGridColumnMeta | undefined) {
  if (meta?.align === "right") return "text-right";
  if (meta?.align === "center") return "text-center";
  return "text-left";
}

function responsiveClass(meta: DataGridColumnMeta | undefined) {
  return cn(
    meta?.hideBelowMd && "hidden md:table-cell",
    meta?.hideBelowLg && "hidden lg:table-cell"
  );
}

/**
 * The app's one table surface: sorting, search, column visibility, selection
 * with bulk actions, pagination, and a card layout on phones. Pages describe
 * their columns and hand over the data; everything else is uniform, so a grid
 * behaves the same wherever it appears.
 */
export function DataGrid<TData>({
  data,
  columns,
  getRowId,
  loading = false,
  empty,
  noResults,
  searchPlaceholder = "Search…",
  searchable = true,
  toolbar,
  bulkActions,
  enableSelection = false,
  onRowClick,
  renderMobileRow,
  pageSize = 25,
  paginated = true,
  className,
  label,
}: DataGridProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const isMobile = useIsMobile();

  const selectionColumn = React.useMemo<DataGridColumn<TData> | null>(() => {
    if (!enableSelection) return null;
    return {
      id: "__select",
      meta: { pinned: true },
      size: 40,
      header: ({ table }: { table: TanstackTable<TData> }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(Boolean(value))
          }
          aria-label="Select all rows on this page"
        />
      ),
      cell: ({ row }: { row: Row<TData> }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
          aria-label="Select row"
          onClick={(event) => event.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };
  }, [enableSelection]);

  const resolvedColumns = React.useMemo(
    () => (selectionColumn ? [selectionColumn, ...columns] : columns),
    [selectionColumn, columns]
  );

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getRowId: (row) => getRowId(row),
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: paginated ? getPaginationRowModel() : undefined,
    initialState: { pagination: { pageSize } },
    enableRowSelection: enableSelection,
  });

  const rows = table.getRowModel().rows;
  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original);
  const isFiltered = globalFilter.trim().length > 0 || columnFilters.length > 0;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter(
      (column) =>
        column.getCanHide() &&
        !(column.columnDef.meta as DataGridColumnMeta | undefined)?.pinned
    );

  function clearSelection() {
    setRowSelection({});
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {searchable || toolbar || hideableColumns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative w-full xs:w-field-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-9 pr-9"
              />
              {globalFilter ? (
                <IconButton
                  label="Clear search"
                  size="sm"
                  onClick={() => setGlobalFilter("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  <X />
                </IconButton>
              ) : null}
            </div>
          ) : null}

          {toolbar}

          {hideableColumns.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  label="Choose columns"
                  variant="outline"
                  className="ml-auto hidden md:inline-flex"
                >
                  <Settings2 />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56">
                <p className="px-1 pb-2 text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
                  Columns
                </p>
                <div className="flex flex-col gap-1">
                  {hideableColumns.map((column) => (
                    <label
                      key={column.id}
                      className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1.5 text-body hover:bg-accent"
                    >
                      <Checkbox
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(Boolean(value))
                        }
                      />
                      {headerTitle(column)}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}

      {enableSelection && selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-accent px-3 py-2">
          <span className="text-ui font-medium text-accent-foreground">
            {selectedRows.length} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions?.(selectedRows, clearSelection)}
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2 rounded-card border border-border p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div>{isFiltered ? (noResults ?? empty) : empty}</div>
      ) : (
        <>
          {/*
            Phones get cards; a horizontally-scrolling table is not usable
            there. This is a real branch rather than two CSS-hidden trees so
            only one copy of the data is ever in the DOM — otherwise screen
            readers announce every row twice.
          */}
          {renderMobileRow && isMobile ? (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id}>
                  {onRowClick ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(row.original)}
                      className="w-full rounded-card border border-border bg-surface p-3 text-left transition-colors duration-fast ease-out hover:bg-surface-sunken"
                    >
                      {renderMobileRow(row.original)}
                    </button>
                  ) : (
                    <div className="rounded-card border border-border bg-surface p-3">
                      {renderMobileRow(row.original)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {renderMobileRow && isMobile ? null : (
          <div className="relative overflow-x-auto rounded-card border border-border">
            <table className="w-full caption-bottom text-ui" aria-label={label}>
              {/* Sticky against the *document* now that main no longer
                  scrolls, so it has to clear whatever the shell has parked at
                  the top of the viewport at this width. */}
              <thead className="sticky top-sticky-top z-10 bg-surface-sunken">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-border">
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta as
                        | DataGridColumnMeta
                        | undefined;
                      const sortable = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : sortable
                                  ? "none"
                                  : undefined
                          }
                          className={cn(
                            "h-10 whitespace-nowrap px-3 align-middle text-meta font-medium uppercase tracking-eyebrow text-text-tertiary",
                            alignmentClass(meta),
                            responsiveClass(meta),
                            meta?.headerClassName
                          )}
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 rounded-control transition-colors duration-fast ease-out hover:text-text"
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                              {sorted === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ChevronsUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={
                      onRowClick ? () => onRowClick(row.original) : undefined
                    }
                    className={cn(
                      "border-b border-border transition-colors duration-fast ease-out last:border-0 hover:bg-surface-sunken data-[state=selected]:bg-accent",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as
                        | DataGridColumnMeta
                        | undefined;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3 py-3 align-middle",
                            meta?.align === "right" && "tabular-nums",
                            alignmentClass(meta),
                            responsiveClass(meta),
                            meta?.cellClassName
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {paginated && !loading && table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between gap-2 text-ui text-text-secondary">
          <span data-numeric>
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()} · {table.getFilteredRowModel().rows.length}{" "}
            {table.getFilteredRowModel().rows.length === 1 ? "row" : "rows"}
          </span>
          <div className="flex items-center gap-1">
            <IconButton
              label="Previous page"
              variant="outline"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label="Next page"
              variant="outline"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { ColumnDef } from "@tanstack/react-table";
