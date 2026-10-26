export function appointmentsQuery(branchId: string, rangeDays = 30, limit = 200, historyDays = 0): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const from = new Date(now);
  from.setDate(from.getDate() - historyDays);
  const to = new Date(now);
  to.setDate(to.getDate() + rangeDays);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: String(limit) });
  if (branchId) query.set('locationId', branchId);
  return `/appointments?${query.toString()}`;
}
