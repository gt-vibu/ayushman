'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function usePaginatedItems<T>(items: T[], resetKey = '') {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = useMemo(() => items.slice((currentPage - 1) * pageSize, currentPage * pageSize), [items, currentPage, pageSize]);
  useEffect(() => { setPage(1); }, [resetKey]);
  return { pageItems, page: currentPage, pageSize, pageCount, setPage, setPageSize };
}

export function Pagination({ total, page, pageSize, pageCount, onPageChange, onPageSizeChange }: {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (total <= 10) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return <nav className="ui-pagination" aria-label="List pagination">
    <span>Showing <strong>{start}–{end}</strong> of <strong>{total}</strong></span>
    <label>Rows <DropdownSelect value={pageSize} onChange={(event) => { onPageSizeChange(Number(event.target.value)); onPageChange(1); }} aria-label="Rows per page"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></DropdownSelect></label>
    <span className="ui-pagination-page">Page {page} of {pageCount}</span>
    <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16}/></button>
    <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}><ChevronRight size={16}/></button>
  </nav>;
}
