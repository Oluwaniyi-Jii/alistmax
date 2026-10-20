export function validateZipCode(value: string): string | null {
  const zip = value.trim();
  return /^\d{5}$/.test(zip) ? zip : null;
}

export function validateSearchDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
