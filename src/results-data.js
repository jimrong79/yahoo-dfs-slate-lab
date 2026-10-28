export const PLATFORMS = {yahoo:'Yahoo',draftkings:'DraftKings'};
export const TYPES = ['Double-up','50/50','Tournament','Small-field group','Other'];
const metrics = ['entries','cashed','feesCents','payoutsCents','ticketCents'];
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const isDay = value => typeof value === 'string' && dayPattern.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
export function shiftDate(day, offset) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0,10);
}
export function monday(day) {
  return shiftDate(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function validateReport(report) {
  if (report?.schemaVersion !== 1 || report.currency !== 'USD' || !isDay(report.through) || !isDay(report.seasonStart) || report.seasonStart > report.through || !Number.isFinite(Date.parse(report.updatedAt)) || !Array.isArray(report.daily) || !Array.isArray(report.coverage)) throw Error('The results report could not be validated.');
  const seen = new Set();
  for (const row of report.daily) {
    const key = `${row.date}:${row.platform}:${row.contestType}`;
    if (!isDay(row.date) || row.date < report.seasonStart || row.date > report.through || !Object.hasOwn(PLATFORMS,row.platform) || !TYPES.includes(row.contestType) || seen.has(key) || metrics.some(k=>!Number.isSafeInteger(row[k]) || row[k]<0) || row.entries<1 || row.cashed>row.entries) throw Error('The results report contains invalid totals.');
    seen.add(key);
  }
  const covered = new Set();
  for (const row of report.coverage) {
    const dates = report.daily.filter(d=>d.platform===row.platform).map(d=>d.date).sort();
    if (!Object.hasOwn(PLATFORMS,row.platform) || covered.has(row.platform) || !dates.length || dates[0]!==row.firstDate || dates.at(-1)!==row.lastDate || !Number.isFinite(Date.parse(row.importedAt))) throw Error('The results coverage could not be validated.');
    covered.add(row.platform);
  }
  if (report.daily.some(r=>!covered.has(r.platform))) throw Error('The results coverage is incomplete.');
  return report;
}
export function totals(rows) {
  const result = Object.fromEntries(metrics.map(k=>[k,0]));
  for (const row of rows) for (const key of metrics) {
    result[key] += row[key];
    if (!Number.isSafeInteger(result[key])) throw Error('Results totals are too large.');
  }
  result.netCents = result.payoutsCents - result.feesCents;
  result.roi = result.feesCents ? result.netCents / result.feesCents : null;
  result.cashRate = result.entries ? result.cashed / result.entries : null;
  return result;
}
export function selectRows(report, {period='last7',platform='all'}={}) {
  let start = report.seasonStart, end = report.through;
  if (period === 'last7') start = shiftDate(end,-6);
  else if (period !== 'season') { start = period; end = shiftDate(start,6); }
  return report.daily.filter(r=>r.date>=start && r.date<=end && (platform==='all' || r.platform===platform));
}
export function dailySeries(rows) {
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.date)) groups.set(row.date,[]); groups.get(row.date).push(row); }
  let cumulativeCents = 0;
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,entries])=>{
    const total = totals(entries); cumulativeCents += total.netCents;
    return {date,...total,cumulativeCents,platforms:[...new Set(entries.map(r=>r.platform))]};
  });
}
export function weeklySeries(report, platform='all') {
  const groups = new Map();
  for (const row of report.daily.filter(r=>platform==='all' || r.platform===platform)) {
    const start = monday(row.date); if (!groups.has(start)) groups.set(start,[]); groups.get(start).push(row);
  }
  return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([start,rows])=>({start,end:shiftDate(start,6),...totals(rows)}));
}
