export function appointmentsQuery(branchId: string, rangeDays = 30, limit = 200): string {
  const from = new Date();
  from.setSeconds(0, 0);
  const to = new Date(from.getTime() + rangeDays * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: String(limit) });
  if (branchId) query.set('locationId', branchId);
  return `/appointments?${query.toString()}`;
}
