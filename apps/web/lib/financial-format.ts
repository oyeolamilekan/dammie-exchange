const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Formats an API decimal string for display without floating-point conversion. */
export const formatFinancialAmount = (value: string): string => {
  const match = value.match(DECIMAL_PATTERN);
  if (!match) return value;

  const [, sign, rawInteger, rawFraction = ""] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  const isZero = integer === "0" && fraction === "";
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign === "-" && !isZero ? "-" : ""}${groupedInteger}${fraction ? `.${fraction}` : ""}`;
};
