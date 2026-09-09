"use client"

import { useQuery } from "@tanstack/react-query";
import { getBankCatalog } from "@/endpoints/api";

/** Fetches the database-backed provider bank directory for Mini App forms. */
export const useBankCatalog = () => useQuery({
  queryKey: ["bank-catalog"],
  queryFn: getBankCatalog,
  staleTime: 24 * 60 * 60 * 1000,
});
