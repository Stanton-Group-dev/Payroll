/**
 * Build a fully self-contained, interactive HTML copy of the weekly payroll
 * STATEMENT — the same document the printable PDF produces, so the two always
 * agree. Built from the same `useInvoiceBuild` output the PDF uses (NOT the
 * review page), so its headline Total Payroll equals the PDF's by construction.
 * On top of the statement it carries all the detail the review page shows:
 *   • the LLC transfer list (each LLC's own costs) + the Stanton Management
 *     pass-through with its per-LLC unit allocation — matching the PDF's page 1,
 *     with the same Total Payroll; click any LLC to drill into its properties;
 *   • a per-property Property Cost Summary (sortable, filterable, expandable) —
 *     totals to the same Total Payroll;
 *   • a per-employee Pay Summary (hours, wages, reimbursements, tax/WC, fee,
 *     billable) — sortable, filterable, remote tagged;
 *   • Administrative & Supervisory by department;
 *   • the Stanton Management (Office Reno) source costs being allocated.
 * All data is embedded as JSON; the file opens with no login, no network, and
 * no external assets, so it can be emailed alongside the statement PDF.
 */
import { SPREAD_OTHER_DEPT, type EmployeePaySummary } from './calculations'
import type { BuiltInvoice, InvoicePropLine, MgmtAllocation } from '@/hooks/payroll/useInvoiceBuild'

export interface StatementHtmlInput {
  week: { week_start: string; week_end: string; status: string } | null
  /** Ownership-LLC invoices, Stanton Management removed, already in canonical order. */
  llcRows: BuiltInvoice[]
  mgmtAllocation: MgmtAllocation | null
  employeeSummaries: EmployeePaySummary[]
  /** Employee ids paid on the remote run — tagged in the pay summary. */
  remoteEmployeeIds: string[]
}

/** Strip a leading "S0001 - " style code from a property name for display. */
function cleanName(name: string): string {
  return name.replace(/^S\d+\s*[-–]\s*/, '')
}

function propOut(p: InvoicePropLine) {
  return {
    code: p.property_code,
    label: p.address || cleanName(p.property_name),
    llc: p.llc,
    units: p.total_units ?? 0,
    cost_per_unit: p.cost_per_unit ?? 0,
    labor: p.labor_cost,
    spread: p.spread_cost,
    mileage: p.mileage_cost,
    expense: p.expense_cost,
    taxwc: p.tax_cost + p.wc_cost,
    fee: p.mgmt_fee,
    total: p.total_cost,
    breakdown: p.breakdown,
  }
}

export function buildStatementHtml(input: StatementHtmlInput): string {
  const { week, llcRows, mgmtAllocation, employeeSummaries } = input
  const remote = new Set(input.remoteEmployeeIds)

  const dueOf = (inv: BuiltInvoice) => inv.total + inv.mgmt_allocation
  const grand = llcRows.reduce((s, i) => s + dueOf(i), 0)

  // Flat per-property list — every billable property including Stanton Management's
  // (Office Reno). Σ total === grand === the PDF's Total Payroll.
  const allProps: InvoicePropLine[] = [
    ...llcRows.flatMap(l => l.props),
    ...(mgmtAllocation ? mgmtAllocation.source.props : []),
  ]

  // Administrative (spread) pool by department, summed across every property — the
  // same table the review page shows.
  const spreadTotals: Record<string, number> = {}
  for (const p of allProps) {
    for (const d of p.spread_by_dept ?? []) spreadTotals[d.department] = (spreadTotals[d.department] ?? 0) + d.amount
  }
  const adminByDept = Object.entries(spreadTotals)
    .map(([department, amount]) => ({ department, amount: Math.round(amount * 100) / 100 }))
    .filter(d => Math.abs(d.amount) > 0.005)
    .sort((a, b) => b.amount - a.amount)

  // Per-employee pay detail — everyone with hours or pay this week.
  const employees = employeeSummaries
    .filter(e => e.gross_pay !== 0 || e.regular_hours > 0)
    .map(e => ({
      employee_name: e.employee_name,
      is_remote: remote.has(e.employee_id),
      regular_hours: e.regular_hours,
      ot_hours: e.ot_hours,
      regular_wages: e.regular_wages,
      ot_wages: e.ot_wages,
      phone: e.phone_reimbursement,
      mileage: e.mileage_reimbursement,
      advances: e.advances,
      gross_pay: e.gross_pay,
      payroll_tax: e.payroll_tax,
      workers_comp: e.workers_comp,
      management_fee: e.management_fee,
      total_billable: e.total_billable,
    }))

  const data = {
    week: { start: week?.week_start ?? '', end: week?.week_end ?? '', status: week?.status ?? 'draft' },
    generated: new Date().toISOString(),
    grand,
    llcs: llcRows.map(inv => ({
      llc: inv.llc,
      own: inv.total,
      allocation: inv.mgmt_allocation,
      due: dueOf(inv),
      props: inv.props.map(propOut),
    })),
    mgmt: mgmtAllocation
      ? {
          total: mgmtAllocation.total,
          totalUnits: mgmtAllocation.totalUnits,
          rows: mgmtAllocation.rows,
          source: {
            amount: mgmtAllocation.source.amount,
            mgmt: mgmtAllocation.source.mgmt,
            total: mgmtAllocation.source.total,
            props: mgmtAllocation.source.props.map(propOut),
          },
        }
      : null,
    properties: allProps.map(propOut),
    employees,
    adminByDept,
    otherDept: SPREAD_OTHER_DEPT,
  }
  // <-escape so a name containing "<" (or a literal "</script>") can't break out of the data tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Payroll Statement</title>
<style>
:root{
  --primary:#1a2744; --primary-light:#2d3f5f; --accent:#8b7355; --ink:#1a1a1a;
  --muted:#6b7280; --border:#d1d5db; --divider:#e5e7eb;
  --error:#991b1b; --warning:#92400e; --success:#166534; --bg-section:#f8f7f5;
}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.page{max-width:1180px;margin:0 auto;padding:24px 28px 48px}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--primary);font-weight:400;margin:0}
h1{font-size:28px} h2{font-size:20px} h3{font-size:16px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--divider)}
.sub{color:var(--muted);margin:4px 0 0;font-size:13px}
.badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:rgba(26,39,68,.08);color:var(--primary);white-space:nowrap}
.generated{color:var(--muted);font-size:12px;margin:10px 0 18px}
.headline{border:2px solid var(--accent);padding:14px 18px;margin-bottom:26px;display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
.headline .lbl{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.headline .val{font-family:Georgia,serif;font-size:32px;color:var(--primary)}
section{margin-bottom:34px}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.controls{display:flex;gap:8px;align-items:center}
input[type=search]{padding:6px 10px;border:1px solid var(--border);font-size:13px;min-width:200px}
button{padding:6px 10px;border:1px solid var(--primary);background:#fff;color:var(--primary);font-size:12px;cursor:pointer}
button:hover{background:var(--primary);color:#fff}
.hint{color:var(--muted);font-size:12px;margin:0 0 8px}
.tbl{border:1px solid var(--border);overflow:auto;max-height:78vh}
.tbl.narrow{max-width:460px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{position:sticky;top:0;background:var(--primary);color:#fff;font-size:11px;font-weight:500;text-align:left;padding:9px 12px;white-space:nowrap;z-index:1}
thead th.sortable{cursor:pointer;user-select:none}
thead th.sortable:hover{background:var(--primary-light)}
th.r,td.r{text-align:right}
tbody td{padding:8px 12px;border-bottom:1px solid var(--divider);white-space:nowrap}
tbody tr.alt{background:var(--bg-section)}
tbody tr.click{cursor:pointer}
tbody tr.click:hover td{background:rgba(139,115,85,.08)}
tbody tr.mgmt td{font-weight:600;border-top:1px solid var(--border)}
tbody tr.suballoc td{font-size:12px;color:var(--muted)}
tbody tr.suballoc td.name{padding-left:36px}
tfoot td{position:sticky;bottom:0;background:var(--primary);color:#fff;font-weight:600;font-size:12px;padding:9px 12px}
#admin-section thead th{cursor:default;position:static}
#admin-section tfoot td{position:static;background:var(--bg-section);color:var(--ink);border-top:1px solid var(--border)}
#source-section thead th{position:static}
#source-section tfoot td{position:static;background:var(--bg-section);color:var(--ink);border-top:1px solid var(--border)}
.strong{font-weight:600} .dim{color:var(--muted)} .neg{color:var(--error)}
.code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted);margin-right:6px}
.caret{display:inline-block;width:14px;color:var(--accent)}
tr.detail td{background:#fdfcfa;border-bottom:1px solid var(--border);padding:0;white-space:normal;cursor:default}
.detail-inner{padding:8px 16px 14px 36px}
.bk{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--muted);padding:2px 0;max-width:640px}
.bk .h{min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.alloc-line{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--accent);padding:4px 0 0;max-width:640px}
.due{display:flex;justify-content:space-between;gap:16px;font-weight:600;border-top:1px solid var(--border);margin-top:8px;padding-top:6px;max-width:640px}
.note{color:var(--muted);font-size:12px;font-style:italic;margin:10px 0 0;max-width:820px}
footer{border-top:1px solid var(--divider);padding-top:12px;margin-top:8px;color:var(--muted);font-size:12px}
@media print{.controls,.hint{display:none !important}.tbl{max-height:none;overflow:visible}thead th,tfoot td{position:static}}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Weekly Payroll Statement</h1>
      <p id="sub" class="sub"></p>
    </div>
    <span id="status" class="badge"></span>
  </header>
  <p id="generated" class="generated"></p>

  <div class="headline">
    <span class="lbl">Total Payroll — amount to transfer this week</span>
    <span id="headline-total" class="val"></span>
  </div>

  <section>
    <div class="section-head">
      <h2>Amount due by billing LLC</h2>
      <div class="controls">
        <input id="llc-filter" type="search" placeholder="Filter LLCs…">
        <button id="llc-expand" type="button">Expand all</button>
        <button id="llc-collapse" type="button">Collapse all</button>
      </div>
    </div>
    <p class="hint">The transfer list — matches the statement PDF. Click any LLC to see the properties behind its amount.</p>
    <div class="tbl">
      <table>
        <thead><tr><th>Billing LLC</th><th class="r">Amount</th></tr></thead>
        <tbody id="llc-body"></tbody>
        <tfoot id="llc-foot"></tfoot>
      </table>
    </div>
    <p id="mgmt-note" class="note"></p>
  </section>

  <section>
    <div class="section-head">
      <h2>Property Cost Summary</h2>
      <div class="controls">
        <input id="prop-filter" type="search" placeholder="Filter properties…">
        <button id="prop-expand" type="button">Expand all</button>
        <button id="prop-collapse" type="button">Collapse all</button>
      </div>
    </div>
    <p class="hint">Every billable property — totals to the same Total Payroll. Click a row for its cost breakdown; click a column to sort.</p>
    <div class="tbl">
      <table>
        <thead id="prop-head"></thead>
        <tbody id="prop-body"></tbody>
        <tfoot id="prop-foot"></tfoot>
      </table>
    </div>
  </section>

  <section id="emp-section">
    <div class="section-head">
      <h2>Employee Pay Summary</h2>
      <div class="controls"><input id="emp-filter" type="search" placeholder="Filter employees…"></div>
    </div>
    <p class="hint">Per-employee hours, wages, reimbursements and burden. Remote-run staff are tagged. Click a column to sort.</p>
    <div class="tbl">
      <table>
        <thead id="emp-head"></thead>
        <tbody id="emp-body"></tbody>
      </table>
    </div>
  </section>

  <section id="admin-section">
    <h2>Administrative &amp; Supervisory — by Department</h2>
    <p class="hint">Week-wide pool — every billed property bears its unit-weighted share of this same mix.</p>
    <div class="tbl narrow">
      <table>
        <thead><tr><th>Department</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
        <tbody id="admin-body"></tbody>
        <tfoot id="admin-foot"></tfoot>
      </table>
    </div>
  </section>

  <section id="source-section">
    <h2>Stanton Management LLC — costs allocated this week</h2>
    <p class="hint">Never collected from Stanton Management; billed to the ownership LLCs by unit count (shown in the transfer list).</p>
    <div class="tbl">
      <table>
        <thead><tr><th>Property / Activity</th><th class="r">Amount</th><th class="r">Mgmt Fee</th><th class="r">Total</th></tr></thead>
        <tbody id="source-body"></tbody>
        <tfoot id="source-foot"></tfoot>
      </table>
    </div>
  </section>

  <footer>Confidential — internal payroll statement. Figures are frozen at export and do not update.</footer>
</div>
<script type="application/json" id="statement-data">${json}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('statement-data').textContent);
  var USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(n) { return USD.format(n || 0); }
  function moneyOr(n) { return n ? USD.format(n) : '\\u2014'; }
  function hrs(n) { return n ? (Math.round(n * 10) / 10).toFixed(1) : '\\u2014'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  // ---- header ----
  if (DATA.week.start) {
    document.title = 'Weekly Payroll Statement \\u2014 ' + DATA.week.start;
    el('sub').textContent = 'Week ' + DATA.week.start + ' \\u2013 ' + DATA.week.end;
  }
  el('status').textContent = DATA.week.status.replace(/_/g, ' ');
  el('generated').textContent = 'Snapshot generated ' + new Date(DATA.generated).toLocaleString() +
    ' \\u2014 figures are frozen as of this moment, not live.';
  el('headline-total').textContent = money(DATA.grand);

  // ---- generic sort helpers ----
  function sortRows(rows, sort, cols) {
    if (!sort) return rows;
    var col = null, i;
    for (i = 0; i < cols.length; i++) if (cols[i].key === sort.key) col = cols[i];
    var dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = a[sort.key], bv = b[sort.key];
      return col && !col.num ? dir * String(av).localeCompare(String(bv)) : dir * (Number(av) - Number(bv));
    });
  }
  function headHtml(cols, sort) {
    return '<tr>' + cols.map(function (c) {
      var arrow = sort && sort.key === c.key ? (sort.dir === 'asc' ? ' \\u25B2' : ' \\u25BC') : '';
      return '<th class="sortable ' + (c.num ? 'r' : '') + '" data-key="' + c.key + '" title="Click to sort">' + esc(c.label) + arrow + '</th>';
    }).join('') + '</tr>';
  }
  function toggleSort(sort, key, cols) {
    if (sort && sort.key === key) return { key: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    var col = null, i;
    for (i = 0; i < cols.length; i++) if (cols[i].key === key) col = cols[i];
    return { key: key, dir: col && col.num ? 'desc' : 'asc' };
  }

  // ================= 1. LLC transfer list =================
  var openLlc = {};
  function propBreakdownHtml(p) {
    var bk = (p.breakdown || []).map(function (b) {
      return '<div class="bk"><span>' + esc(b.act) + '</span><span><span class="h">' +
        (b.hours ? hrs(b.hours) : '') + '</span> ' + money(b.labor) + '</span></div>';
    }).join('');
    if (p.taxwc || p.fee) bk += '<div class="bk"><span>Employer tax / WC &amp; management fee</span><span>' + money(p.taxwc + p.fee) + '</span></div>';
    return bk;
  }
  function llcDetail(inv) {
    var props = inv.props.length ? inv.props.map(function (p) {
      return '<div style="margin-bottom:8px"><div class="bk" style="color:var(--ink);font-weight:600"><span><span class="code">' +
        esc(p.code) + '</span>' + esc(p.label) + '</span><span>' + money(p.total) + '</span></div>' + propBreakdownHtml(p) + '</div>';
    }).join('') : '<div class="dim" style="padding:6px 0">No direct property costs this week.</div>';
    var alloc = inv.allocation ? '<div class="alloc-line"><span>Stanton Management \\u2014 allocated by unit count</span><span>' + money(inv.allocation) + '</span></div>' : '';
    return '<tr class="detail"><td colspan="2"><div class="detail-inner">' + props + alloc +
      '<div class="due"><span>Amount due</span><span>' + money(inv.due) + '</span></div></div></td></tr>';
  }
  function renderLlc() {
    var q = (el('llc-filter').value || '').trim().toLowerCase();
    var rows = q ? DATA.llcs.filter(function (l) { return l.llc.toLowerCase().indexOf(q) !== -1; }) : DATA.llcs;
    var html = rows.map(function (l, i) {
      return '<tr class="click ' + (i % 2 ? 'alt' : '') + '" data-llc="' + esc(l.llc) + '">' +
        '<td><span class="caret">' + (openLlc[l.llc] ? '\\u25BE' : '\\u25B8') + '</span>' + esc(l.llc) + '</td>' +
        '<td class="r">' + money(l.own) + '</td></tr>' + (openLlc[l.llc] ? llcDetail(l) : '');
    }).join('');
    if (DATA.mgmt && !q) {
      html += '<tr class="mgmt"><td>Stanton Management LLC</td><td class="r">' + money(DATA.mgmt.total) + '</td></tr>';
      html += DATA.mgmt.rows.map(function (r) {
        return '<tr class="suballoc"><td class="name">' + esc(r.llc) + ' \\u2014 ' + r.units + ' of ' +
          DATA.mgmt.totalUnits + ' units</td><td class="r">' + money(r.amount) + '</td></tr>';
      }).join('');
    }
    if (!rows.length && !(DATA.mgmt && !q)) html = '<tr><td colspan="2" class="dim" style="text-align:center;padding:16px">No matching LLCs</td></tr>';
    el('llc-body').innerHTML = html;
    el('llc-foot').innerHTML = '<tr><td>Total Payroll</td><td class="r">' + money(DATA.grand) + '</td></tr>';
  }
  if (DATA.mgmt) {
    el('mgmt-note').textContent = "Stanton Management's costs are billed to the ownership LLCs by unit count (" +
      DATA.mgmt.totalUnits + ' units across the portfolio) \\u2014 the indented lines are each LLC\\u2019s share. ' +
      'An LLC\\u2019s full transfer is its own line plus its indented share.';
  }
  el('llc-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr.click'); if (!tr) return;
    var llc = tr.getAttribute('data-llc');
    if (openLlc[llc]) delete openLlc[llc]; else openLlc[llc] = true; renderLlc();
  });
  el('llc-filter').addEventListener('input', renderLlc);
  el('llc-expand').addEventListener('click', function () { DATA.llcs.forEach(function (l) { openLlc[l.llc] = true; }); renderLlc(); });
  el('llc-collapse').addEventListener('click', function () { openLlc = {}; renderLlc(); });
  renderLlc();

  // ================= 2. Property Cost Summary =================
  var PROP_COLS = [
    { key: 'label', label: 'Property', num: false, render: function (p) {
      return '<span class="caret">' + (openProp[p._i] ? '\\u25BE' : '\\u25B8') + '</span><span class="code">' + esc(p.code) + '</span>' + esc(p.label); } },
    { key: 'llc', label: 'Billing LLC', num: false, cls: 'dim', render: function (p) { return esc(p.llc); } },
    { key: 'units', label: 'Units', num: true, render: function (p) { return String(p.units); } },
    { key: 'labor', label: 'Labor', num: true, render: function (p) { return money(p.labor); } },
    { key: 'spread', label: 'Spread', num: true, render: function (p) { return moneyOr(p.spread); } },
    { key: 'mileage', label: 'Mileage', num: true, render: function (p) { return moneyOr(p.mileage); } },
    { key: 'expense', label: 'Expenses', num: true, render: function (p) { return moneyOr(p.expense); } },
    { key: 'taxwc', label: 'Tax/WC', num: true, render: function (p) { return moneyOr(p.taxwc); } },
    { key: 'fee', label: 'Mgmt Fee', num: true, render: function (p) { return money(p.fee); } },
    { key: 'total', label: 'Total Cost', num: true, cls: 'strong', render: function (p) { return money(p.total); } },
    { key: 'cost_per_unit', label: '$/Unit', num: true, cls: 'dim', render: function (p) { return p.cost_per_unit ? money(p.cost_per_unit) : '\\u2014'; } },
  ];
  DATA.properties.forEach(function (p, i) { p._i = i; });
  var propSort = { key: 'total', dir: 'desc' }, openProp = {};
  function propDetail(p) {
    return '<tr class="detail"><td colspan="' + PROP_COLS.length + '"><div class="detail-inner">' +
      propBreakdownHtml(p) + '<div class="due"><span>Total cost</span><span>' + money(p.total) + '</span></div></div></td></tr>';
  }
  function renderProps() {
    var q = (el('prop-filter').value || '').trim().toLowerCase();
    var rows = q ? DATA.properties.filter(function (p) { return (p.label + ' ' + p.code + ' ' + p.llc).toLowerCase().indexOf(q) !== -1; }) : DATA.properties;
    rows = sortRows(rows, propSort, PROP_COLS);
    el('prop-head').innerHTML = headHtml(PROP_COLS, propSort);
    el('prop-body').innerHTML = rows.length ? rows.map(function (p, i) {
      return '<tr class="click ' + (i % 2 ? 'alt' : '') + '" data-i="' + p._i + '">' + PROP_COLS.map(function (c) {
        return '<td class="' + (c.num ? 'r ' : '') + (c.cls || '') + '">' + c.render(p) + '</td>';
      }).join('') + '</tr>' + (openProp[p._i] ? propDetail(p) : '');
    }).join('') : '<tr><td colspan="' + PROP_COLS.length + '" class="dim" style="text-align:center;padding:16px">No matching properties</td></tr>';
    var t = rows.reduce(function (a, p) {
      a.labor += p.labor; a.spread += p.spread; a.mileage += p.mileage; a.expense += p.expense;
      a.taxwc += p.taxwc; a.fee += p.fee; a.total += p.total; return a;
    }, { labor: 0, spread: 0, mileage: 0, expense: 0, taxwc: 0, fee: 0, total: 0 });
    el('prop-foot').innerHTML = '<tr><td colspan="3">Total \\u2014 ' + rows.length + ' properties</td>' +
      '<td class="r">' + money(t.labor) + '</td><td class="r">' + money(t.spread) + '</td><td class="r">' + money(t.mileage) +
      '</td><td class="r">' + money(t.expense) + '</td><td class="r">' + money(t.taxwc) + '</td><td class="r">' + money(t.fee) +
      '</td><td class="r">' + money(t.total) + '</td><td></td></tr>';
  }
  el('prop-head').addEventListener('click', function (ev) {
    var th = ev.target.closest('th'); if (!th || !th.getAttribute('data-key')) return;
    propSort = toggleSort(propSort, th.getAttribute('data-key'), PROP_COLS); renderProps();
  });
  el('prop-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr.click'); if (!tr) return;
    var i = tr.getAttribute('data-i');
    if (openProp[i]) delete openProp[i]; else openProp[i] = true; renderProps();
  });
  el('prop-filter').addEventListener('input', renderProps);
  el('prop-expand').addEventListener('click', function () { DATA.properties.forEach(function (p) { openProp[p._i] = true; }); renderProps(); });
  el('prop-collapse').addEventListener('click', function () { openProp = {}; renderProps(); });
  renderProps();

  // ================= 3. Employee Pay Summary =================
  if (DATA.employees.length) {
    var EMP_COLS = [
      { key: 'employee_name', label: 'Employee', num: false, render: function (e) {
        return esc(e.employee_name) + (e.is_remote ? ' <span class="dim">(remote)</span>' : ''); } },
      { key: 'regular_hours', label: 'Reg Hrs', num: true, render: function (e) { return hrs(e.regular_hours); } },
      { key: 'ot_hours', label: 'OT Hrs', num: true, render: function (e) { return hrs(e.ot_hours); } },
      { key: 'regular_wages', label: 'Reg Wages', num: true, render: function (e) { return money(e.regular_wages); } },
      { key: 'ot_wages', label: 'OT Wages', num: true, render: function (e) { return moneyOr(e.ot_wages); } },
      { key: 'phone', label: 'Phone', num: true, render: function (e) { return moneyOr(e.phone); } },
      { key: 'mileage', label: 'Mileage', num: true, render: function (e) { return moneyOr(e.mileage); } },
      { key: 'advances', label: 'Advances', num: true, cls: 'neg', render: function (e) { return e.advances ? '\\u2212' + money(e.advances) : '\\u2014'; } },
      { key: 'gross_pay', label: 'Gross Pay', num: true, cls: 'strong', render: function (e) { return money(e.gross_pay); } },
      { key: 'payroll_tax', label: 'Payroll Tax', num: true, cls: 'dim', render: function (e) { return moneyOr(e.payroll_tax); } },
      { key: 'workers_comp', label: "Workers' Comp", num: true, cls: 'dim', render: function (e) { return moneyOr(e.workers_comp); } },
      { key: 'management_fee', label: 'Mgmt Fee', num: true, cls: 'dim', render: function (e) { return money(e.management_fee); } },
      { key: 'total_billable', label: 'Total Billable', num: true, cls: 'strong', render: function (e) { return money(e.total_billable); } },
    ];
    var empSort = { key: 'gross_pay', dir: 'desc' };
    function renderEmp() {
      var q = (el('emp-filter').value || '').trim().toLowerCase();
      var rows = q ? DATA.employees.filter(function (e) { return e.employee_name.toLowerCase().indexOf(q) !== -1; }) : DATA.employees;
      rows = sortRows(rows, empSort, EMP_COLS);
      el('emp-head').innerHTML = headHtml(EMP_COLS, empSort);
      el('emp-body').innerHTML = rows.length ? rows.map(function (e, i) {
        return '<tr class="' + (i % 2 ? 'alt' : '') + '">' + EMP_COLS.map(function (c) {
          return '<td class="' + (c.num ? 'r ' : '') + (c.cls || '') + '">' + c.render(e) + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="13" class="dim" style="text-align:center;padding:16px">No matching employees</td></tr>';
    }
    el('emp-head').addEventListener('click', function (ev) {
      var th = ev.target.closest('th'); if (!th || !th.getAttribute('data-key')) return;
      empSort = toggleSort(empSort, th.getAttribute('data-key'), EMP_COLS); renderEmp();
    });
    el('emp-filter').addEventListener('input', renderEmp);
    renderEmp();
  } else { el('emp-section').style.display = 'none'; }

  // ================= 4. Administrative by department =================
  (function () {
    var rows = DATA.adminByDept;
    var hasSplit = rows.some(function (d) { return d.department !== DATA.otherDept; });
    if (!hasSplit) { el('admin-section').style.display = 'none'; return; }
    var total = rows.reduce(function (s, d) { return s + d.amount; }, 0);
    el('admin-body').innerHTML = rows.map(function (d, i) {
      var name = d.department === DATA.otherDept ? 'Other (overhead, phone/tools)' : d.department;
      return '<tr class="' + (i % 2 ? 'alt' : '') + '"><td>' + esc(name) + '</td><td class="r">' + money(d.amount) +
        '</td><td class="r dim">' + (total > 0 ? Math.round(d.amount / total * 100) + '%' : '\\u2014') + '</td></tr>';
    }).join('');
    el('admin-foot').innerHTML = '<tr><td>Total Administrative</td><td class="r">' + money(total) + '</td><td></td></tr>';
  })();

  // ================= 5. Stanton Management source =================
  if (DATA.mgmt) {
    el('source-body').innerHTML = DATA.mgmt.source.props.map(function (p, i) {
      var main = '<tr class="' + (i % 2 ? 'alt' : '') + '"><td><span class="code">' + esc(p.code) + '</span>' + esc(p.label) +
        '</td><td class="r">' + money(p.labor + p.spread + p.mileage + p.expense + p.taxwc) + '</td><td class="r dim">' + money(p.fee) +
        '</td><td class="r strong">' + money(p.total) + '</td></tr>';
      var bk = (p.breakdown || []).map(function (b) {
        return '<tr class="suballoc"><td class="name">' + esc(b.act) + (b.hours ? ' \\u00b7 ' + hrs(b.hours) + ' h' : '') +
          '</td><td class="r">' + money(b.labor) + '</td><td></td><td></td></tr>';
      }).join('');
      return main + bk;
    }).join('');
    el('source-foot').innerHTML = '<tr><td>Total to allocate</td><td class="r">' + money(DATA.mgmt.source.amount) +
      '</td><td class="r">' + money(DATA.mgmt.source.mgmt) + '</td><td class="r">' + money(DATA.mgmt.source.total) + '</td></tr>';
  } else { el('source-section').style.display = 'none'; }
})();
</script>
</body>
</html>
`
}

/** Build the statement snapshot and save it as a .html download. */
export function downloadStatementHtml(input: StatementHtmlInput): void {
  const html = buildStatementHtml(input)
  const name = input.week?.week_start ? `statement-${input.week.week_start}` : 'statement'
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
