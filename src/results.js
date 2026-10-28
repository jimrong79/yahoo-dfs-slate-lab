import './style.css';
import './results.css';
import {createIcons,LayoutDashboard,ChartNoAxesCombined,CalendarDays,ChevronRight,ArrowUpRight} from 'lucide';
import {PLATFORMS,TYPES,validateReport,selectRows,totals,dailySeries,weeklySeries,shiftDate} from './results-data.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const signed = value => `${value>0?'+':value<0?'−':''}${usd(Math.abs(value))}`;
const percent = value => value===null?'—':`${(value*100).toFixed(1)}%`;
const dateLabel = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
const dateRange = (start,end) => `${dateLabel(start)}–${dateLabel(end)}`;
const tone = n => n>0?'positive':n<0?'negative':'';
let report, series=[];

function chartDetail(index) {
  const day=series[index]; if(!day)return;
  $('chart-detail').textContent=`${dateLabel(day.date)} · ${day.entries} ${day.entries===1?'entry':'entries'} · Daily ${signed(day.netCents)} · Cumulative ${signed(day.cumulativeCents)} · Records: ${day.platforms.map(p=>PLATFORMS[p]).join(' + ')}`;
}
function renderChart() {
  const container=$('profit-chart');
  if(!series.length){container.innerHTML='<div class="chart-empty">No recorded results in this selection.</div>';$('chart-detail').textContent='Choose another period or platform.';return;}
  const width=Math.max(280,container.clientWidth-32),height=270,left=52,right=20,top=20,bottom=40;
  const values=[0,...series.map(d=>d.cumulativeCents)],low=Math.min(...values),high=Math.max(...values);
  const pad=Math.max(100,(high-low)*0.12),min=low-pad,max=high+pad;
  const y=value=>top+(max-value)/(max-min)*(height-top-bottom);
  // The first point is the start-of-period zero; dates retain their actual spacing.
  const first=Date.parse(`${shiftDate(series[0].date,-1)}T00:00:00Z`),last=Date.parse(`${series.at(-1).date}T00:00:00Z`);
  const x=day=>left+(Date.parse(`${day}T00:00:00Z`)-first)/(last-first)*(width-left-right);
  const path=`M ${left},${y(0)} `+series.map(d=>`L ${x(d.date)},${y(d.cumulativeCents)}`).join(' ');
  const area=`${path} L ${x(series.at(-1).date)},${y(0)} Z`;
  const ticks=[...new Set([low,Math.round((low+high)/2),high])];
  const labels=new Set([series.length-1]);
  let previousLabel=-Infinity;
  for(let i=0;i<series.length-1;i++){
    const at=x(series[i].date);
    if(at-previousLabel>=65 && x(series.at(-1).date)-at>=65){labels.add(i);previousLabel=at;}
  }
  container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Cumulative profit chart; focus a point for its daily result"><title>Cumulative profit in the selected period</title><desc>Starts at zero. Daily totals are also available in the table below.</desc><defs><linearGradient id="profit-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#a7cb82" stop-opacity=".23"/><stop offset="100%" stop-color="#a7cb82" stop-opacity=".04"/></linearGradient></defs>
    ${ticks.map(v=>`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${left-9}" y="${y(v)+4}" text-anchor="end">${v<0?'−':''}$${(Math.abs(v)/100).toFixed(0)}</text>`).join('')}
    <line class="chart-zero" x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}"/>
    <path d="${area}" fill="url(#profit-fill)"/><path class="profit-line" d="${path}"/>
    ${series.map((d,i)=>`<circle class="chart-dot" data-day="${i}" tabindex="0" role="button" aria-label="${dateLabel(d.date)}: daily ${signed(d.netCents)}, cumulative ${signed(d.cumulativeCents)}" cx="${x(d.date)}" cy="${y(d.cumulativeCents)}" r="4.5"><title>${dateLabel(d.date)}: ${signed(d.cumulativeCents)}</title></circle>${labels.has(i)?`<text class="chart-axis" text-anchor="${i===series.length-1?'end':'middle'}" x="${x(d.date)}" y="${height-13}">${dateLabel(d.date)}</text>`:''}`).join('')}</svg>`;
  container.querySelectorAll('[data-day]').forEach(dot=>{
    for(const event of ['mouseenter','focus','click'])dot.addEventListener(event,()=>chartDetail(+dot.dataset.day));
    dot.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();chartDetail(+dot.dataset.day);}});
  });
  chartDetail(series.length-1);
}
function render() {
  if(!report)return;
  const platform=$('results-platform').value,period=$('results-period').value;
  const rows=selectRows(report,{platform,period}),summary=totals(rows);
  const selectedStart=period==='last7'?shiftDate(report.through,-6):period==='season'?report.seasonStart:period;
  const selectedEnd=['last7','season'].includes(period)?report.through:[shiftDate(period,6),report.through].sort()[0];
  $('selected-period-range').textContent=`${dateRange(selectedStart,selectedEnd)} · ${platform==='all'?'Yahoo + DraftKings':PLATFORMS[platform]}`;
  $('result-profit').textContent=signed(summary.netCents);
  $('result-profit').closest('.metric-card').classList.toggle('negative',summary.netCents<0);
  $('result-roi').textContent=`${percent(summary.roi)} ROI`;
  $('result-fees').textContent=usd(summary.feesCents);
  $('result-payouts').textContent=usd(summary.payoutsCents);
  $('result-entries').textContent=`${summary.entries} recorded entries`;
  $('result-cash-rate').textContent=percent(summary.cashRate);
  $('result-cashes').textContent=`${summary.cashed} of ${summary.entries} entries paid`;
  $('results-empty').hidden=rows.length>0;
  const coverage=report.coverage.filter(c=>platform==='all'||c.platform===platform);
  $('results-coverage').textContent=`${coverage.map(c=>`${PLATFORMS[c.platform]} records through ${dateLabel(c.lastDate)}`).join(' · ') || 'No imported records for this platform'}. Missing dates are not verified zero activity.`;
  const types=TYPES.map(type=>({type,...totals(rows.filter(r=>r.contestType===type))})).filter(r=>r.entries);
  $('results-types').innerHTML=types.length?types.map(r=>`<tr><td>${escape(r.type)}</td><td>${r.cashed} / ${r.entries}</td><td class="${tone(r.netCents)}">${signed(r.netCents)}</td><td>${percent(r.roi)}</td></tr>`).join(''):'<tr><td colspan="4">No entries in this selection.</td></tr>';
  $('results-weeks').innerHTML=weeklySeries(report,platform).map(r=>`<tr><td><button class="week-link" data-week="${r.start}" aria-label="View week ${dateRange(r.start,r.end)}">${dateRange(r.start,r.end)}</button>${r.end>report.through?'<small>Partial week</small>':r.start<report.seasonStart?'<small>Tracking began '+dateLabel(report.seasonStart)+'</small>':''}</td><td>${r.entries}</td><td class="${tone(r.netCents)}">${signed(r.netCents)}</td><td>${percent(r.roi)}</td></tr>`).join('') || '<tr><td colspan="4">No imported weeks.</td></tr>';
  $('results-weeks').querySelectorAll('[data-week]').forEach(button=>button.onclick=()=>{$('results-period').value=button.dataset.week;render();});
  series=dailySeries(rows);
  $('results-daily').innerHTML=series.map(d=>`<tr><td>${dateLabel(d.date)}<small>${d.platforms.map(p=>PLATFORMS[p]).join(' + ')}</small></td><td>${d.entries}</td><td>${usd(d.feesCents)}</td><td>${usd(d.payoutsCents)}</td><td class="${tone(d.netCents)}">${signed(d.netCents)}</td></tr>`).join('') || '<tr><td colspan="5">No imported dates.</td></tr>';
  $('ticket-note').textContent=summary.ticketCents?`DraftKings ticket prizes in this selection: ${usd(summary.ticketCents)} face value, excluded from payouts and ROI.`:'';
  renderChart();
}
async function load() {
  $('results-retry').hidden=true;$('results-state').hidden=false;$('results-content').hidden=true;
  $('results-state').classList.remove('error');$('results-state').textContent='Loading the latest results…';
  try {
    const url=new URL('./data/results.json',document.baseURI);url.searchParams.set('v',Date.now());
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('The weekly report is not available yet. Please try again later.');
    report=validateReport(await response.json());
    $('results-period').innerHTML=`<option value="last7">Last 7 reported days</option><option value="season">Season to date</option>`+weeklySeries(report).map(w=>`<option value="${w.start}">Week of ${dateLabel(w.start)}</option>`).join('');
    $('results-through').textContent=`Results through ${dateLabel(report.through)}, ${report.through.slice(0,4)}`;
    $('results-updated').textContent=`Updated ${new Date(report.updatedAt).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric'})}`;
    $('results-state').hidden=true;$('results-content').hidden=false;render();
  } catch(error) {
    report=null;$('results-state').classList.add('error');$('results-state').textContent=error.name==='TimeoutError'?'Loading timed out. Please try again.':error.message;$('results-retry').hidden=false;
  }
}
$('results-platform').onchange=render;$('results-period').onchange=render;$('results-retry').onclick=load;
let resize;
new ResizeObserver(()=>{clearTimeout(resize);resize=setTimeout(()=>{if(report)renderChart();},100);}).observe($('profit-chart'));
createIcons({icons:{LayoutDashboard,ChartNoAxesCombined,CalendarDays,ChevronRight,ArrowUpRight}});
load();
