/**
 * Build a fully self-contained, interactive HTML snapshot of a payroll week
 * review — sortable tables, filter boxes, expandable per-property cost
 * breakdowns — so the review can be emailed alongside the statement PDF and
 * opened without logging in. All data is embedded as JSON; the file needs no
 * network, no auth, and no external assets.
 */
import {
  SPREAD_OTHER_DEPT,
  type PayrollCalculationResult,
  type PropertyCostSummary,
} from './calculations'

export interface ReviewHtmlInput {
  week: { week_start: string; week_end: string; status: string } | null
  result: PayrollCalculationResult
  /** Billable property costs after invoicing exclusions — exactly what the review page shows. */
  includedCosts: PropertyCostSummary[]
  excludedCostCount: number
  prefundIncludesMgmtFee: boolean
}

export function buildReviewHtml(input: ReviewHtmlInput): string {
  const { week, result, includedCosts, excludedCostCount, prefundIncludesMgmtFee } = input

  // Week-wide Administrative (spread) pool by department — same math as the review page.
  const spreadTotals: Record<string, number> = {}
  for (const pc of includedCosts) {
    for (const d of pc.spread_by_dept) spreadTotals[d.department] = (spreadTotals[d.department] ?? 0) + d.amount
  }
  const spreadByDept = Object.entries(spreadTotals)
    .map(([department, amount]) => ({ department, amount: Math.round(amount * 100) / 100 }))
    .filter(d => Math.abs(d.amount) > 0.005)
    .sort((a, b) => b.amount - a.amount)

  const data = {
    week: { start: week?.week_start ?? '', end: week?.week_end ?? '', status: week?.status ?? 'draft' },
    generated: new Date().toISOString(),
    prefund: result.required_prefund,
    prefundIncludesMgmtFee,
    totals: {
      gross: result.total_gross_pay,
      tax: result.total_payroll_tax,
      wc: result.total_workers_comp,
      fee: result.total_mgmt_fee,
      billable: result.total_gross_pay + result.total_payroll_tax + result.total_workers_comp + result.total_mgmt_fee,
    },
    employees: result.employee_summaries.filter(e => e.gross_pay !== 0 || e.regular_hours > 0),
    properties: includedCosts,
    spreadByDept,
    excludedCostCount,
    otherDept: SPREAD_OTHER_DEPT,
  }
  // <-escape so names containing "<" (or a literal "</script>") can't break out of the data tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payroll Review</title>
<style>
:root{
  --primary:#1a2744; --primary-light:#2d3f5f; --accent:#8b7355; --ink:#1a1a1a;
  --muted:#6b7280; --border:#d1d5db; --divider:#e5e7eb;
  --error:#991b1b; --warning:#92400e; --success:#166534; --bg-section:#f8f7f5;
}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.page{max-width:1280px;margin:0 auto;padding:24px 28px 48px}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--primary);font-weight:400;margin:0}
h1{font-size:26px} h2{font-size:17px} h3{font-size:16px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--divider)}
.sub{color:var(--muted);margin:4px 0 0;font-size:13px}
.badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:rgba(26,39,68,.08);color:var(--primary);white-space:nowrap}
.generated{color:var(--muted);font-size:12px;margin:10px 0 22px}
section{margin-bottom:30px}
.prefund-card{border:2px solid var(--accent);padding:18px 20px}
.prefund{font-family:Georgia,serif;font-size:34px;color:var(--primary);margin:6px 0 4px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{border:1px solid var(--border);background:var(--bg-section);padding:10px 12px}
.card-label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.card-value{font-size:17px;font-weight:600;color:var(--primary);margin-top:2px}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.controls{display:flex;gap:8px;align-items:center}
input[type=search]{padding:6px 10px;border:1px solid var(--border);font-size:13px;min-width:220px}
button{padding:6px 10px;border:1px solid var(--primary);background:#fff;color:var(--primary);font-size:12px;cursor:pointer}
button:hover{background:var(--primary);color:#fff}
.hint{color:var(--muted);font-size:12px;margin:0 0 8px}
.tbl{border:1px solid var(--border);overflow:auto;max-height:75vh}
.tbl.narrow{max-width:460px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{position:sticky;top:0;background:var(--primary);color:#fff;font-size:11px;font-weight:500;text-align:left;padding:9px 10px;cursor:pointer;user-select:none;white-space:nowrap}
thead th:hover{background:var(--primary-light)}
th.r,td.r{text-align:right}
tbody td{padding:7px 10px;border-bottom:1px solid var(--divider);white-space:nowrap}
tbody tr.alt{background:var(--bg-section)}
tbody tr.prow{cursor:pointer}
tbody tr.prow:hover td{background:rgba(139,115,85,.08)}
tfoot td{position:sticky;bottom:0;background:var(--primary);color:#fff;font-weight:600;font-size:12px;padding:9px 10px}
#spread-section thead th{cursor:default}
#spread-section tfoot td{position:static;background:var(--bg-section);color:var(--ink);border-top:1px solid var(--border)}
.strong{font-weight:600} .dim{color:var(--muted)} .neg{color:var(--error)}
.code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted);margin-right:4px}
.caret{display:inline-block;width:14px;color:var(--accent)}
tr.detail td{background:#fdfcfa;border-bottom:1px solid var(--border);padding:12px 16px 14px;white-space:normal;cursor:default}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;max-width:900px}
.detail-title{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px}
.kv{display:flex;justify-content:space-between;gap:16px;padding:2px 0;font-size:13px}
.kv.total{border-top:1px solid var(--border);margin-top:4px;padding-top:5px;font-weight:600}
.small{font-size:12px}
footer{border-top:1px solid var(--divider);padding-top:12px;margin-top:8px;color:var(--muted);font-size:12px}
@media print{.controls,.hint{display:none !important}.tbl{max-height:none;overflow:visible}thead th,tfoot td{position:static}}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Payroll Review</h1>
      <p id="sub" class="sub"></p>
    </div>
    <span id="status" class="badge"></span>
  </header>
  <p id="generated" class="generated"></p>

  <section class="prefund-card">
    <h2>Required Pre-Fund Amount</h2>
    <p id="prefund" class="prefund"></p>
    <p id="prefund-line" class="dim small"></p>
  </section>

  <section id="cards" class="cards"></section>

  <section>
    <div class="section-head">
      <h3>Employee Pay Summary</h3>
      <div class="controls"><input id="emp-filter" type="search" placeholder="Filter employees…"></div>
    </div>
    <p class="hint">Click a column header to sort.</p>
    <div class="tbl">
      <table>
        <thead id="emp-head"></thead>
        <tbody id="emp-body"></tbody>
        <tfoot id="emp-foot"></tfoot>
      </table>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h3>Property Cost Summary</h3>
      <div class="controls">
        <input id="prop-filter" type="search" placeholder="Filter properties…">
        <button id="expand-all" type="button">Expand all</button>
        <button id="collapse-all" type="button">Collapse all</button>
      </div>
    </div>
    <p class="hint">Click a row to see its cost breakdown; click a column header to sort.</p>
    <div class="tbl">
      <table>
        <thead id="prop-head"></thead>
        <tbody id="prop-body"></tbody>
        <tfoot id="prop-foot"></tfoot>
      </table>
    </div>
    <p id="excluded-note" class="dim small"></p>
  </section>

  <section id="spread-section">
    <h3>Administrative &amp; Supervisory — by Department</h3>
    <p class="dim small">Week-wide pool — every billed property bears its unit-weighted share of this same mix.</p>
    <div class="tbl narrow">
      <table>
        <thead><tr><th>Department</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
        <tbody id="spread-body"></tbody>
        <tfoot id="spread-foot"></tfoot>
      </table>
    </div>
  </section>

  <footer>Confidential — internal payroll snapshot. Figures are frozen at export and do not update.</footer>
</div>
<script type="application/json" id="payroll-data">${json}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('payroll-data').textContent);
  var USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(n) { return USD.format(n || 0); }
  function moneyOr(n) { return n ? USD.format(n) : '\\u2014'; }
  function hrs(n) { return n ? String(Math.round(n * 100) / 100) : '\\u2014'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  // ---- header & summary cards ----
  if (DATA.week.start) {
    document.title = 'Payroll Review \\u2014 Week of ' + DATA.week.start;
    el('sub').textContent = 'Week of ' + DATA.week.start + ' \\u2014 ' + DATA.week.end;
  }
  el('status').textContent = DATA.week.status.replace(/_/g, ' ');
  el('generated').textContent = 'Snapshot generated ' + new Date(DATA.generated).toLocaleString() +
    ' \\u2014 figures are frozen as of this moment, not live.';
  el('prefund').textContent = money(DATA.prefund);
  var line = 'Gross Pay ' + money(DATA.totals.gross) +
    ' + Payroll Tax ' + money(DATA.totals.tax) +
    ' + Workers\\u2019 Comp ' + money(DATA.totals.wc);
  if (DATA.prefundIncludesMgmtFee) line += ' + Mgmt Fee ' + money(DATA.totals.fee);
  el('prefund-line').textContent = line;
  var cards = [
    ['Gross Pay', DATA.totals.gross],
    ['Payroll Tax', DATA.totals.tax],
    ["Workers' Comp", DATA.totals.wc],
    ['Mgmt Fee', DATA.totals.fee],
    ['Total Billable', DATA.totals.billable],
  ];
  el('cards').innerHTML = cards.map(function (c) {
    return '<div class="card"><div class="card-label">' + esc(c[0]) + '</div><div class="card-value">' + money(c[1]) + '</div></div>';
  }).join('');

  // ---- shared table helpers ----
  function sortRows(rows, sort, cols) {
    if (!sort) return rows;
    var col = null;
    for (var i = 0; i < cols.length; i++) if (cols[i].key === sort.key) col = cols[i];
    var dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = a[sort.key], bv = b[sort.key];
      return col && !col.num
        ? dir * String(av).localeCompare(String(bv))
        : dir * (Number(av) - Number(bv));
    });
  }
  function headHtml(cols, sort) {
    return '<tr>' + cols.map(function (c) {
      var arrow = sort && sort.key === c.key ? (sort.dir === 'asc' ? ' \\u25B2' : ' \\u25BC') : '';
      return '<th class="' + (c.num ? 'r' : '') + '" data-key="' + c.key + '" title="Click to sort">' + esc(c.label) + arrow + '</th>';
    }).join('') + '</tr>';
  }
  function toggleSort(sort, key, cols) {
    if (sort && sort.key === key) return { key: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    var col = null;
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) col = cols[i];
    return { key: key, dir: col && col.num ? 'desc' : 'asc' };
  }

  // ---- employee pay summary ----
  var EMP_COLS = [
    { key: 'employee_name', label: 'Employee', num: false, cls: 'strong', render: function (e) { return esc(e.employee_name); } },
    { key: 'regular_hours', label: 'Reg Hrs', num: true, render: function (e) { return hrs(e.regular_hours); } },
    { key: 'ot_hours', label: 'OT Hrs', num: true, render: function (e) { return hrs(e.ot_hours); } },
    { key: 'regular_wages', label: 'Reg Wages', num: true, render: function (e) { return money(e.regular_wages); } },
    { key: 'ot_wages', label: 'OT Wages', num: true, render: function (e) { return moneyOr(e.ot_wages); } },
    { key: 'phone_reimbursement', label: 'Phone', num: true, render: function (e) { return moneyOr(e.phone_reimbursement); } },
    { key: 'mileage_reimbursement', label: 'Mileage', num: true, render: function (e) { return moneyOr(e.mileage_reimbursement); } },
    { key: 'advances', label: 'Advances', num: true, cls: 'neg', render: function (e) { return e.advances ? '\\u2212' + money(e.advances) : '\\u2014'; } },
    { key: 'gross_pay', label: 'Gross Pay', num: true, cls: 'strong', render: function (e) { return money(e.gross_pay); } },
    { key: 'payroll_tax', label: 'Payroll Tax', num: true, cls: 'dim', render: function (e) { return moneyOr(e.payroll_tax); } },
    { key: 'workers_comp', label: "Workers' Comp", num: true, cls: 'dim', render: function (e) { return moneyOr(e.workers_comp); } },
    { key: 'management_fee', label: 'Mgmt Fee', num: true, cls: 'dim', render: function (e) { return money(e.management_fee); } },
    { key: 'total_billable', label: 'Total Billable', num: true, cls: 'strong', render: function (e) { return money(e.total_billable); } },
  ];
  var empSort = null, empQuery = '';

  function renderEmp() {
    var rows = DATA.employees;
    if (empQuery) {
      var q = empQuery.toLowerCase();
      rows = rows.filter(function (e) { return e.employee_name.toLowerCase().indexOf(q) !== -1; });
    }
    rows = sortRows(rows, empSort, EMP_COLS);
    el('emp-head').innerHTML = headHtml(EMP_COLS, empSort);
    el('emp-body').innerHTML = rows.length ? rows.map(function (e, i) {
      return '<tr class="' + (i % 2 ? 'alt' : '') + '">' + EMP_COLS.map(function (c) {
        return '<td class="' + (c.num ? 'r ' : '') + (c.cls || '') + '">' + c.render(e) + '</td>';
      }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="13" class="dim" style="text-align:center;padding:14px">No matching employees</td></tr>';
    // Unfiltered, show the engine's week totals verbatim; filtered, sum the visible rows.
    var t;
    if (empQuery) {
      t = { gross: 0, tax: 0, wc: 0, fee: 0, billable: 0 };
      rows.forEach(function (e) {
        t.gross += e.gross_pay; t.tax += e.payroll_tax; t.wc += e.workers_comp;
        t.fee += e.management_fee; t.billable += e.total_billable;
      });
    } else {
      t = DATA.totals;
    }
    var label = 'Totals' + (empQuery ? ' (filtered \\u2014 ' + rows.length + ' shown)' : '');
    el('emp-foot').innerHTML = '<tr><td colspan="8">' + esc(label) + '</td>' +
      '<td class="r">' + money(t.gross) + '</td><td class="r">' + money(t.tax) + '</td>' +
      '<td class="r">' + money(t.wc) + '</td><td class="r">' + money(t.fee) + '</td>' +
      '<td class="r">' + money(t.billable) + '</td></tr>';
  }

  // ---- property cost summary ----
  DATA.properties.forEach(function (p) { p.taxwc = p.tax_cost + p.wc_cost; });
  var PROP_COLS = [
    { key: 'property_name', label: 'Property', num: false, render: function (p) {
      return '<span class="caret">' + (openIds[p.property_id] ? '\\u25BE' : '\\u25B8') + '</span>' +
        '<span class="code">' + esc(p.property_code || '') + '</span>' + esc(p.property_name);
    } },
    { key: 'total_units', label: 'Units', num: true, render: function (p) { return String(p.total_units); } },
    { key: 'labor_cost', label: 'Labor', num: true, render: function (p) { return money(p.labor_cost); } },
    { key: 'spread_cost', label: 'Spread', num: true, render: function (p) { return moneyOr(p.spread_cost); } },
    { key: 'mileage_cost', label: 'Mileage', num: true, render: function (p) { return moneyOr(p.mileage_cost); } },
    { key: 'expense_cost', label: 'Expenses', num: true, render: function (p) { return moneyOr(p.expense_cost); } },
    { key: 'taxwc', label: 'Tax/WC', num: true, render: function (p) { return moneyOr(p.taxwc); } },
    { key: 'mgmt_fee', label: 'Mgmt Fee', num: true, render: function (p) { return money(p.mgmt_fee); } },
    { key: 'total_cost', label: 'Total Cost', num: true, cls: 'strong', render: function (p) { return money(p.total_cost); } },
    { key: 'cost_per_unit', label: '$/Unit', num: true, cls: 'dim', render: function (p) { return p.cost_per_unit ? money(p.cost_per_unit) : '\\u2014'; } },
  ];
  var propSort = { key: 'total_cost', dir: 'desc' }, propQuery = '', openIds = {};
  var weekTotalCost = DATA.properties.reduce(function (s, p) { return s + p.total_cost; }, 0);

  function detailRow(p) {
    var parts = [
      ['Direct labor', p.labor_cost],
      ['Administrative share (spread)', p.spread_cost],
      ['Mileage', p.mileage_cost],
      ['Expenses (pass-through)', p.expense_cost],
      ['Employer payroll tax', p.tax_cost],
      ["Workers' comp", p.wc_cost],
      ['Management fee', p.mgmt_fee],
    ];
    var list = parts.filter(function (x) { return x[1]; }).map(function (x) {
      return '<div class="kv"><span>' + esc(x[0]) + '</span><span>' + money(x[1]) + '</span></div>';
    }).join('');
    var dept = '';
    if (p.spread_by_dept && p.spread_by_dept.length) {
      dept = '<div><div class="detail-title">Administrative share by department</div>' +
        p.spread_by_dept.slice().sort(function (a, b) { return b.amount - a.amount; }).map(function (d) {
          var name = d.department === DATA.otherDept ? 'Other (overhead, phone/tools)' : d.department;
          return '<div class="kv dim"><span>' + esc(name) + '</span><span>' + money(d.amount) + '</span></div>';
        }).join('') + '</div>';
    }
    var share = weekTotalCost > 0 ? Math.round(p.total_cost / weekTotalCost * 1000) / 10 : 0;
    return '<tr class="detail"><td colspan="10"><div class="detail-grid">' +
      '<div><div class="detail-title">Cost components</div>' + list +
      '<div class="kv total"><span>Total cost</span><span>' + money(p.total_cost) + '</span></div></div>' +
      dept +
      '<div><div class="detail-title">Context</div>' +
      '<div class="kv"><span>Units</span><span>' + p.total_units + '</span></div>' +
      '<div class="kv"><span>Cost per unit</span><span>' + (p.cost_per_unit ? money(p.cost_per_unit) : '\\u2014') + '</span></div>' +
      '<div class="kv"><span>Share of week</span><span>' + share + '%</span></div></div>' +
      '</div></td></tr>';
  }

  function renderProps() {
    var rows = DATA.properties;
    if (propQuery) {
      var q = propQuery.toLowerCase();
      rows = rows.filter(function (p) {
        return (p.property_name + ' ' + (p.property_code || '')).toLowerCase().indexOf(q) !== -1;
      });
    }
    rows = sortRows(rows, propSort, PROP_COLS);
    el('prop-head').innerHTML = headHtml(PROP_COLS, propSort);
    el('prop-body').innerHTML = rows.length ? rows.map(function (p, i) {
      return '<tr class="prow ' + (i % 2 ? 'alt' : '') + '" data-id="' + p.property_id + '">' +
        PROP_COLS.map(function (c) {
          return '<td class="' + (c.num ? 'r ' : '') + (c.cls || '') + '">' + c.render(p) + '</td>';
        }).join('') + '</tr>' + (openIds[p.property_id] ? detailRow(p) : '');
    }).join('') : '<tr><td colspan="10" class="dim" style="text-align:center;padding:14px">No matching properties</td></tr>';
    var t = { labor: 0, spread: 0, mileage: 0, expense: 0, taxwc: 0, fee: 0, total: 0 };
    rows.forEach(function (p) {
      t.labor += p.labor_cost; t.spread += p.spread_cost; t.mileage += p.mileage_cost;
      t.expense += p.expense_cost; t.taxwc += p.taxwc; t.fee += p.mgmt_fee; t.total += p.total_cost;
    });
    var label = 'Totals' + (propQuery ? ' (filtered \\u2014 ' + rows.length + ' shown)' : '');
    el('prop-foot').innerHTML = '<tr><td colspan="2">' + esc(label) + '</td>' +
      '<td class="r">' + money(t.labor) + '</td><td class="r">' + money(t.spread) + '</td>' +
      '<td class="r">' + money(t.mileage) + '</td><td class="r">' + money(t.expense) + '</td>' +
      '<td class="r">' + money(t.taxwc) + '</td><td class="r">' + money(t.fee) + '</td>' +
      '<td class="r">' + money(t.total) + '</td><td></td></tr>';
  }

  // ---- administrative pool by department ----
  function renderSpread() {
    var rows = DATA.spreadByDept;
    var hasSplit = rows.some(function (d) { return d.department !== DATA.otherDept; });
    if (!hasSplit) { el('spread-section').style.display = 'none'; return; }
    var total = rows.reduce(function (s, d) { return s + d.amount; }, 0);
    el('spread-body').innerHTML = rows.map(function (d, i) {
      var name = d.department === DATA.otherDept ? 'Other (overhead, phone/tools)' : d.department;
      return '<tr class="' + (i % 2 ? 'alt' : '') + '"><td>' + esc(name) +
        '</td><td class="r">' + money(d.amount) + '</td><td class="r dim">' +
        (total > 0 ? Math.round(d.amount / total * 100) + '%' : '\\u2014') + '</td></tr>';
    }).join('');
    el('spread-foot').innerHTML = '<tr><td>Total Administrative</td><td class="r">' + money(total) + '</td><td></td></tr>';
  }

  // ---- footnotes ----
  if (DATA.excludedCostCount > 0) {
    el('excluded-note').textContent = DATA.excludedCostCount +
      (DATA.excludedCostCount === 1 ? ' property with cost is' : ' properties with cost are') +
      ' excluded from invoicing (\\u22641 unit or turned off in Invoicing settings) and not shown above.';
  }

  // ---- events ----
  el('emp-head').addEventListener('click', function (ev) {
    var th = ev.target.closest('th');
    if (!th || !th.getAttribute('data-key')) return;
    empSort = toggleSort(empSort, th.getAttribute('data-key'), EMP_COLS);
    renderEmp();
  });
  el('prop-head').addEventListener('click', function (ev) {
    var th = ev.target.closest('th');
    if (!th || !th.getAttribute('data-key')) return;
    propSort = toggleSort(propSort, th.getAttribute('data-key'), PROP_COLS);
    renderProps();
  });
  el('prop-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr.prow');
    if (!tr) return;
    var id = tr.getAttribute('data-id');
    if (openIds[id]) delete openIds[id]; else openIds[id] = true;
    renderProps();
  });
  el('emp-filter').addEventListener('input', function (ev) { empQuery = ev.target.value.trim(); renderEmp(); });
  el('prop-filter').addEventListener('input', function (ev) { propQuery = ev.target.value.trim(); renderProps(); });
  el('expand-all').addEventListener('click', function () {
    DATA.properties.forEach(function (p) { openIds[p.property_id] = true; });
    renderProps();
  });
  el('collapse-all').addEventListener('click', function () { openIds = {}; renderProps(); });

  renderEmp();
  renderProps();
  renderSpread();
})();
</script>
</body>
</html>
`
}

/** Build the snapshot and save it as a .html download (mirrors downloadPdf's blob idiom). */
export function downloadReviewHtml(input: ReviewHtmlInput): void {
  const html = buildReviewHtml(input)
  const name = input.week?.week_start ? `payroll-review-${input.week.week_start}` : 'payroll-review'
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
