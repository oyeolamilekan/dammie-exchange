"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

export function CursorPagination({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  if (!canGoBack && !canGoForward) return null;
  return (
    <Pagination className="justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={!canGoBack}
            tabIndex={canGoBack ? 0 : -1}
            className={cn(!canGoBack && "pointer-events-none opacity-50")}
            onClick={(event) => {
              event.preventDefault();
              if (canGoBack) onBack();
            }}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={!canGoForward}
            tabIndex={canGoForward ? 0 : -1}
            className={cn(!canGoForward && "pointer-events-none opacity-50")}
            onClick={(event) => {
              event.preventDefault();
              if (canGoForward) onForward();
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

