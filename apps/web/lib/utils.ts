import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { isAxiosError } from "axios"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const renderErrorMessage = (error: unknown) => {
  if (typeof error === 'string') {
    return error;
  }
  return null;
};

const messageFromResponse = (data: unknown): string | undefined => {
  if (typeof data === "string" && data.trim()) return data;
  if (!data || typeof data !== "object") return undefined;

  const payload = data as { message?: unknown; error?: unknown };
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return undefined;
};

export const getErrorMessage = (error: unknown): string => {
  if (isAxiosError(error)) {
    return messageFromResponse(error.response?.data)
      ?? error.message
      ?? "Unknown request error";
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown error";
};
