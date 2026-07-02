/**
 * Build a fully self-contained, interactive HTML copy of the weekly payroll
 * STATEMENT — the same document the printable PDF produces, so the two always
 * agree. It is built from the same `useInvoiceBuild` output the PDF uses (NOT
 * the review page), then adds interactivity the PDF can't have:
 *   • the LLC transfer list (each LLC's own costs) + the Stanton Management
 *     pass-through with its per-LLC unit allocation — matching the PDF's page 1,
 *     with the same Total Payroll;
 *   • click any LLC to drill into its properties and cost breakdown;
 *   • the on-site hourly summary and the reimbursements/adjustments tables,
 *     sortable and filterable;
 *   • the Stanton Management (Office Reno) source costs being allocated.
 * All data is embedded as JSON; the file opens with no login, no network, and
 * no external assets, so it can be emailed alongside the statement PDF.
 */
import type { EmployeePaySummary } from './calculations'
import type { BuiltInvoice, MgmtAllocation } from '@/hooks/payroll/useInvoiceBuild'

export interface StatementHtmlInput {
  week: { week_start: string; week_end: string; status: string } | null
  /** Ownership-LLC invoices, Stanton Management removed, already in canonical order. */
  llcRows: BuiltInvoice[]
  mgmtAllocation: MgmtAllocation | null
  employeeSummaries: EmployeePaySummary[]
  /** Employee ids paid on the remote run — excluded from the hourly summary, tagged in reimbursements. */
  remoteEmployeeIds: string[]
}

/** Strip a leading "S0001 - " style code from a property name for display. */
function cleanName(name: string): string {
  return name.replace(/^S\d+\s*[-–]\s*/, '')
}

export function buildStatementHtml(input: StatementHtmlInput): string {
  const { week, llcRows, mgmtAllocation, employeeSummaries } = input
  const remote = new Set(input.remoteEmployeeIds)

  const dueOf = (inv: BuiltInvoice) => inv.total + inv.mgmt_allocation
  const grand = llcRows.reduce((s, i) => s + dueOf(i), 0)

  // On-site hourly summary — exclude remote-run employees (same rule as the PDF).
  const hourly = employeeSummaries
    .filter(e => !remote.has(e.employee_id))
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name))

  // Reimbursements & adjustments — every employee with non-wage activity, remote included.
  const reimb = employeeSummaries
    .map(e => ({
      employee_id: e.employee_id,
      employee_name: e.employee_name,
      is_remote: remote.has(e.employee_id),
      phone: e.phone_reimbursement,
      mileage: e.mileage_reimbursement,
      other: e.other_adjustments,
      advances: e.advances,
      net: e.phone_reimbursement + e.mileage_reimbursement + e.other_adjustments - e.advances,
    }))
    .filter(e => e.phone || e.mileage || e.other || e.advances)
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name))

  const data = {
    week: { start: week?.week_start ?? '', end: week?.week_end ?? '', status: week?.status ?? 'draft' },
    generated: new Date().toISOString(),
    grand,
    llcs: llcRows.map(inv => ({
      llc: inv.llc,
      own: inv.total,
      allocation: inv.mgmt_allocation,
      due: dueOf(inv),
      props: inv.props.map(p => ({
        code: p.property_code,
        label: p.address || cleanName(p.property_name),
        labor: p.labor_cost,
        spread: p.spread_cost,
        mileage: p.mileage_cost,
        expense: p.expense_cost,
        taxwc: p.tax_cost + p.wc_cost,
        fee: p.mgmt_fee,
        total: p.total_cost,
        breakdown: p.breakdown,
      })),
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
            props: mgmtAllocation.source.props.map(p => ({
              code: p.property_code,
              label: p.address || cleanName(p.property_name),
              amount: p.labor_cost + p.spread_cost + p.mileage_cost + p.expense_cost + p.tax_cost + p.wc_cost,
              fee: p.mgmt_fee,
              total: p.total_cost,
              breakdown: p.breakdown,
            })),
          },
        }
      : null,
    hourly: hourly.map(e => ({
      employee_name: e.employee_name,
      regular_hours: e.regular_hours,
      ot_hours: e.ot_hours,
      pto_hours: e.pto_hours,
      regular_wages: e.regular_wages,
      ot_wages: e.ot_wages,
      gross_pay: e.gross_pay,
    })),
    reimb,
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
.page{max-width:1100px;margin:0 auto;padding:24px 28px 48px}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--primary);font-weight:400;margin:0}
h1{font-size:28px} h2{font-size:20px} h3{font-size:16px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--divider)}
.sub{color:var(--muted);margin:4px 0 0;font-size:13px}
.badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:rgba(26,39,68,.08);color:var(--primary);white-space:nowrap}
.generated{color:var(--muted);font-size:12px;margin:10px 0 24px}
section{margin-bottom:34px}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.controls{display:flex;gap:8px;align-items:center}
input[type=search]{padding:6px 10px;border:1px solid var(--border);font-size:13px;min-width:200px}
button{padding:6px 10px;border:1px solid var(--primary);background:#fff;color:var(--primary);font-size:12px;cursor:pointer}
button:hover{background:var(--primary);color:#fff}
.hint{color:var(--muted);font-size:12px;margin:0 0 8px}
.tbl{border:1px solid var(--border);overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{background:var(--primary);color:#fff;font-size:11px;font-weight:500;text-align:left;padding:9px 12px;white-space:nowrap}
thead th.sortable{cursor:pointer;user-select:none}
thead th.sortable:hover{background:var(--primary-light)}
th.r,td.r{text-align:right}
tbody td{padding:8px 12px;border-bottom:1px solid var(--divider);white-space:nowrap}
tbody tr.alt{background:var(--bg-section)}
tbody tr.llc{cursor:pointer}
tbody tr.llc:hover td{background:rgba(139,115,85,.08)}
tbody tr.mgmt td{font-weight:600;border-top:1px solid var(--border)}
tbody tr.suballoc td{font-size:12px;color:var(--muted)}
tbody tr.suballoc td.name{padding-left:36px}
tfoot td{background:var(--primary);color:#fff;font-weight:600;font-size:13px;padding:10px 12px;font-family:Georgia,serif}
.strong{font-weight:600} .dim{color:var(--muted)} .neg{color:var(--error)}
.code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted);margin-right:6px}
.caret{display:inline-block;width:14px;color:var(--accent)}
tr.detail td{background:#fdfcfa;border-bottom:1px solid var(--border);padding:0;white-space:normal;cursor:default}
.detail-inner{padding:6px 16px 14px 36px}
.prop{padding:10px 0;border-bottom:1px dashed var(--divider)}
.prop:last-child{border-bottom:0}
.prop-head{display:flex;justify-content:space-between;gap:16px;font-weight:600;margin-bottom:4px}
.bk{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--muted);padding:1px 0}
.bk .h{min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.alloc-line{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:var(--accent);padding:4px 0 0}
.due{display:flex;justify-content:space-between;gap:16px;font-weight:600;border-top:1px solid var(--border);margin-top:8px;padding-top:6px}
.note{color:var(--muted);font-size:12px;font-style:italic;margin:10px 0 0;max-width:760px}
footer{border-top:1px solid var(--divider);padding-top:12px;margin-top:8px;color:var(--muted);font-size:12px}
@media print{.controls,.hint{display:none !important}.tbl{overflow:visible}}
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

  <section>
    <div class="section-head">
      <h2>Amount due by billing LLC</h2>
      <div class="controls">
        <input id="llc-filter" type="search" placeholder="Filter LLCs…">
        <button id="expand-all" type="button">Expand all</button>
        <button id="collapse-all" type="button">Collapse all</button>
      </div>
    </div>
    <p class="hint">Click any LLC to see the properties and costs behind its amount.</p>
    <div class="tbl">
      <table>
        <thead>
          <tr>
            <th>Billing LLC</th>
            <th class="r">Amount</th>
          </tr>
        </thead>
        <tbody id="llc-body"></tbody>
        <tfoot id="llc-foot"></tfoot>
      </table>
    </div>
    <p id="mgmt-note" class="note"></p>
  </section>

  <section id="hourly-section">
    <div class="section-head">
      <h2>Hourly Summary</h2>
      <div class="controls"><input id="emp-filter" type="search" placeholder="Filter employees…"></div>
    </div>
    <p class="hint">On-site employees — hours &amp; preliminary wages. Remote-run staff are excluded. Click a column to sort.</p>
    <div class="tbl">
      <table>
        <thead id="emp-head"></thead>
        <tbody id="emp-body"></tbody>
        <tfoot id="emp-foot"></tfoot>
      </table>
    </div>
  </section>

  <section id="reimb-section">
    <div class="section-head">
      <h2>Reimbursements &amp; Adjustments</h2>
      <div class="controls"><input id="reimb-filter" type="search" placeholder="Filter employees…"></div>
    </div>
    <p class="hint">Non-wage payments authorized this week; advances/deductions shown in parentheses. Remote staff tagged. Click a column to sort.</p>
    <div class="tbl">
      <table>
        <thead id="reimb-head"></thead>
        <tbody id="reimb-body"></tbody>
        <tfoot id="reimb-foot"></tfoot>
      </table>
    </div>
  </section>

  <section id="source-section">
    <h2>Stanton Management LLC — costs allocated this week</h2>
    <p class="hint">These costs are never collected from Stanton Management; they are billed to the ownership LLCs by unit count (shown above).</p>
    <div class="tbl">
      <table>
        <thead>
          <tr><th>Property / Activity</th><th class="r">Amount</th><th class="r">Mgmt Fee</th><th class="r">Total</th></tr>
        </thead>
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

  // ---- statement transfer list (with LLC drill-down) ----
  var open = {};
  function propHtml(p) {
    var bk = (p.breakdown || []).map(function (b) {
      return '<div class="bk"><span>' + esc(b.act) + '</span>' +
        '<span><span class="h">' + (b.hours ? hrs(b.hours) : '') + '</span> ' + money(b.labor) + '</span></div>';
    }).join('');
    return '<div class="prop"><div class="prop-head"><span><span class="code">' + esc(p.code) + '</span>' +
      esc(p.label) + '</span><span>' + money(p.total) + '</span></div>' + bk +
      ((p.taxwc || p.fee) ? '<div class="bk"><span>Employer tax / WC &amp; management fee</span><span>' +
        money(p.taxwc + p.fee) + '</span></div>' : '') + '</div>';
  }
  function detailHtml(inv) {
    var props = inv.props.length
      ? inv.props.map(propHtml).join('')
      : '<div class="dim" style="padding:8px 0">No direct property costs this week.</div>';
    var alloc = inv.allocation
      ? '<div class="alloc-line"><span>Stanton Management \\u2014 allocated by unit count</span><span>' + money(inv.allocation) + '</span></div>'
      : '';
    return '<tr class="detail"><td colspan="2"><div class="detail-inner">' + props + alloc +
      '<div class="due"><span>Amount due</span><span>' + money(inv.due) + '</span></div></div></td></tr>';
  }
  function renderLlc() {
    var q = (el('llc-filter').value || '').trim().toLowerCase();
    var rows = q ? DATA.llcs.filter(function (l) { return l.llc.toLowerCase().indexOf(q) !== -1; }) : DATA.llcs;
    var html = rows.map(function (l, i) {
      var row = '<tr class="llc ' + (i % 2 ? 'alt' : '') + '" data-llc="' + esc(l.llc) + '">' +
        '<td><span class="caret">' + (open[l.llc] ? '\\u25BE' : '\\u25B8') + '</span>' + esc(l.llc) + '</td>' +
        '<td class="r">' + money(l.own) + '</td></tr>';
      return row + (open[l.llc] ? detailHtml(l) : '');
    }).join('');
    // Stanton Management pass-through line + per-LLC sub-allocations (match the PDF).
    if (DATA.mgmt && !q) {
      html += '<tr class="mgmt"><td>Stanton Management LLC</td><td class="r">' + money(DATA.mgmt.total) + '</td></tr>';
      html += DATA.mgmt.rows.map(function (r) {
        return '<tr class="suballoc"><td class="name">' + esc(r.llc) + ' \\u2014 ' + r.units +
          ' of ' + DATA.mgmt.totalUnits + ' units</td><td class="r">' + money(r.amount) + '</td></tr>';
      }).join('');
    }
    if (!rows.length && !(DATA.mgmt && !q)) {
      html = '<tr><td colspan="2" class="dim" style="text-align:center;padding:16px">No matching LLCs</td></tr>';
    }
    el('llc-body').innerHTML = html;
    el('llc-foot').innerHTML = '<tr><td>Total Payroll</td><td class="r">' + money(DATA.grand) + '</td></tr>';
  }
  if (DATA.mgmt) {
    el('mgmt-note').textContent = "Stanton Management's costs are billed to the ownership LLCs by unit count (" +
      DATA.mgmt.totalUnits + ' units across the portfolio) \\u2014 the indented lines are each LLC\\u2019s share. ' +
      'An LLC\\u2019s full transfer is its own line plus its indented share.';
  }

  // ---- generic sortable/filterable table (hourly + reimbursements) ----
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
  function wireTable(cfg) {
    var state = { sort: null, q: '' };
    function render() {
      var rows = cfg.rows;
      if (state.q) {
        var q = state.q.toLowerCase();
        rows = rows.filter(function (r) { return r.employee_name.toLowerCase().indexOf(q) !== -1; });
      }
      rows = sortRows(rows, state.sort, cfg.cols);
      el(cfg.head).innerHTML = headHtml(cfg.cols, state.sort);
      el(cfg.body).innerHTML = rows.length ? rows.map(function (r, i) {
        return '<tr class="' + (i % 2 ? 'alt' : '') + '">' + cfg.cols.map(function (c) {
          return '<td class="' + (c.num ? 'r ' : '') + (c.cls ? c.cls(r) : '') + '">' + c.render(r) + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + cfg.cols.length + '" class="dim" style="text-align:center;padding:16px">No matching employees</td></tr>';
      el(cfg.foot).innerHTML = cfg.foot_html(rows);
    }
    el(cfg.head).addEventListener('click', function (ev) {
      var th = ev.target.closest('th'); if (!th || !th.getAttribute('data-key')) return;
      state.sort = toggleSort(state.sort, th.getAttribute('data-key'), cfg.cols); render();
    });
    el(cfg.filter).addEventListener('input', function (ev) { state.q = ev.target.value.trim(); render(); });
    render();
  }

  // ---- hourly summary ----
  if (DATA.hourly.length) {
    wireTable({
      rows: DATA.hourly, head: 'emp-head', body: 'emp-body', foot: 'emp-foot', filter: 'emp-filter',
      cols: [
        { key: 'employee_name', label: 'Employee', num: false, render: function (e) { return esc(e.employee_name); } },
        { key: 'regular_hours', label: 'Reg Hrs', num: true, render: function (e) { return hrs(e.regular_hours); } },
        { key: 'ot_hours', label: 'OT Hrs', num: true, render: function (e) { return hrs(e.ot_hours); } },
        { key: 'pto_hours', label: 'PTO Hrs', num: true, render: function (e) { return hrs(e.pto_hours); } },
        { key: 'regular_wages', label: 'Reg Wages', num: true, render: function (e) { return money(e.regular_wages); } },
        { key: 'ot_wages', label: 'OT Wages', num: true, render: function (e) { return moneyOr(e.ot_wages); } },
        { key: 'gross_pay', label: 'Gross Pay', num: true, cls: function () { return 'strong'; }, render: function (e) { return money(e.gross_pay); } },
      ],
      foot_html: function (rows) {
        var t = rows.reduce(function (a, e) {
          a.reg += e.regular_hours; a.ot += e.ot_hours; a.pto += e.pto_hours;
          a.rw += e.regular_wages; a.ow += e.ot_wages; a.g += e.gross_pay; return a;
        }, { reg: 0, ot: 0, pto: 0, rw: 0, ow: 0, g: 0 });
        return '<tr><td>Total \\u2014 ' + rows.length + ' employees</td><td class="r">' + t.reg.toFixed(1) +
          '</td><td class="r">' + t.ot.toFixed(1) + '</td><td class="r">' + t.pto.toFixed(1) +
          '</td><td class="r">' + money(t.rw) + '</td><td class="r">' + money(t.ow) + '</td><td class="r">' + money(t.g) + '</td></tr>';
      },
    });
  } else { el('hourly-section').style.display = 'none'; }

  // ---- reimbursements ----
  if (DATA.reimb.length) {
    wireTable({
      rows: DATA.reimb, head: 'reimb-head', body: 'reimb-body', foot: 'reimb-foot', filter: 'reimb-filter',
      cols: [
        { key: 'employee_name', label: 'Employee', num: false, render: function (e) {
          return esc(e.employee_name) + (e.is_remote ? ' <span class="dim">(remote)</span>' : ''); } },
        { key: 'phone', label: 'Phone', num: true, render: function (e) { return moneyOr(e.phone); } },
        { key: 'mileage', label: 'Mileage', num: true, render: function (e) { return moneyOr(e.mileage); } },
        { key: 'other', label: 'Other Adj.', num: true, render: function (e) { return moneyOr(e.other); } },
        { key: 'advances', label: 'Advances / Deductions', num: true, cls: function (e) { return e.advances ? 'neg' : ''; },
          render: function (e) { return e.advances ? '(' + money(e.advances) + ')' : '\\u2014'; } },
        { key: 'net', label: 'Total', num: true, cls: function () { return 'strong'; }, render: function (e) { return money(e.net); } },
      ],
      foot_html: function (rows) {
        var t = rows.reduce(function (a, e) {
          a.p += e.phone; a.m += e.mileage; a.o += e.other; a.adv += e.advances; a.n += e.net; return a;
        }, { p: 0, m: 0, o: 0, adv: 0, n: 0 });
        return '<tr><td>Total \\u2014 ' + rows.length + ' employees</td><td class="r">' + money(t.p) +
          '</td><td class="r">' + money(t.m) + '</td><td class="r">' + money(t.o) +
          '</td><td class="r">' + (t.adv ? '(' + money(t.adv) + ')' : '\\u2014') + '</td><td class="r">' + money(t.n) + '</td></tr>';
      },
    });
  } else { el('reimb-section').style.display = 'none'; }

  // ---- Stanton Management source costs ----
  if (DATA.mgmt) {
    el('source-body').innerHTML = DATA.mgmt.source.props.map(function (p, i) {
      var main = '<tr class="' + (i % 2 ? 'alt' : '') + '"><td><span class="code">' + esc(p.code) + '</span>' +
        esc(p.label) + '</td><td class="r">' + money(p.amount) + '</td><td class="r dim">' + money(p.fee) +
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

  // ---- LLC drill-down events ----
  el('llc-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr.llc'); if (!tr) return;
    var llc = tr.getAttribute('data-llc');
    if (open[llc]) delete open[llc]; else open[llc] = true;
    renderLlc();
  });
  el('llc-filter').addEventListener('input', renderLlc);
  el('expand-all').addEventListener('click', function () { DATA.llcs.forEach(function (l) { open[l.llc] = true; }); renderLlc(); });
  el('collapse-all').addEventListener('click', function () { open = {}; renderLlc(); });

  renderLlc();
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
