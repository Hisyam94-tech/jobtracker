// JobTracker's approved demo layout, using the authenticated application's data.
import {escapeHtml as e, icon, iconButton, money, statusLabel} from './ui.js';

export const logo = '<img src="./src/assets/jobtracker.png" alt="" width="48" height="48">';
export function navigation(view, status = '') {
    const nav = (target, symbol, label, filter = '') => `<button data-action="navigate" data-view="${target}" data-status="${filter}" ${view === target && (target !== 'orders' || status === filter) ? 'aria-current="page"' : ''} title="${label}" aria-label="${label}">${icon(symbol)}<span>${label}</span></button>`;
    return `<aside class="sidebar"><a class="brand" href="./" aria-label="JobTracker home">${logo}<span>JobTracker<small>Repair Management</small></span></a><nav aria-label="Main navigation">${nav('home','home','Dashboard')}${nav('orders','orders','All Orders')}${nav('orders','clock','In Progress','in-progress')}${nav('orders','check','Completed','completed')}${nav('revenue','revenue','Revenue Analytics')}${nav('parts','parts','Spare Parts')}${nav('settings','settings','Company')}</nav><div class="sidebar-bottom"><button class="primary" data-action="new-order">${icon('plus')}New Order</button><span>JobTracker &middot; Repair Management</span></div></aside><nav class="mobile-tab-bar" aria-label="Mobile navigation">${[['home','home','Home'],['orders','orders','Orders'],['new-order','plus','New Order'],['parts','parts','Parts'],['revenue','revenue','Revenue']].map(([target,symbol,label]) => `<button data-action="${target === 'new-order' ? 'new-order' : 'navigate'}" data-view="${target}" class="${target === 'new-order' ? 'new-order-tab' : view === target ? 'active' : ''}" ${view === target ? 'aria-current="page"' : ''}><span class="tab-icon-wrap">${icon(symbol)}</span><span>${label}</span></button>`).join('')}</nav>`;
}
export function homeHtml(profile, role) {
    return `<section class="home-page"><section class="home-profile" aria-label="About me"><div class="profile-eyebrow">ABOUT ME</div><div class="profile-avatar">${icon('user')}</div><h1 class="profile-name">${e(profile?.display_name || 'Your profile')}</h1><p class="profile-bio">${e(role)}</p><button class="profile-edit text-button" data-action="edit-profile">Edit profile</button></section><div class="home-overview-heading"><h2>At a glance</h2><span>Your repair overview</span></div><div class="home-metrics">${[
        ['total','Total Orders','All repair orders','orders','orders',''],
        ['inProgress','In Progress','Repairs underway','clock','orders','in-progress'],
        ['completed','Completed','Ready and resolved','check','orders','completed'],
        ['parts','Spare Parts','Items in inventory','parts','parts',''],
        ['revenue','Revenue this month','Completed repairs by received date','revenue','revenue','']
    ].map(([key,label,sub,symbol,view,status]) => `<button class="home-metric ${key === 'revenue' ? 'home-metric-revenue' : ''}" data-action="navigate" data-view="${view}" data-status="${status}"><span class="home-metric-top"><span class="home-metric-icon">${icon(symbol)}</span><span class="home-metric-arrow" aria-hidden="true">&#8599;</span></span><span class="home-metric-value" data-metric="${key}" aria-live="polite">&mdash;</span><span class="home-metric-label">${label}</span><span class="home-metric-sub">${sub}</span></button>`).join('')}</div><div class="home-footer"><span>JobTracker</span><button class="text-button" data-action="refresh-overview">Refresh overview</button></div></section>`;
}
export function listHtml(state) {
    const orders = state.view === 'orders';
    return `${orders ? `<div class="order-status-filters" role="group" aria-label="Order status">${[['','All'],['in-progress','In Progress'],['completed','Completed']].map(([value,label]) => `<button data-action="filter-status" data-status="${value}" aria-pressed="${state.status === value}">${label}</button>`).join('')}</div>` : ''}<div class="records-heading"><h1>${orders ? 'Repair orders' : 'Spare parts'}</h1><button class="primary" data-action="${orders ? 'new-order' : 'new'}">${icon('plus')}${orders ? 'New order' : 'Add part'}</button></div><form class="list-toolbar" data-form="search"><label class="search-field"><span class="sr-only">Search ${orders ? 'orders' : 'parts'}</span><input name="search" maxlength="60" value="${e(state.search)}" placeholder="${orders ? 'Search by order #, customer or device' : 'Search parts, number or category'}"></label>${orders ? `<label class="status-select"><span class="sr-only">Filter order status</span><select name="status">${[['','All statuses'],['in-progress','In Progress'],['completed','Completed'],['Pending-Payment','Pending Payment'],['cancelled','Cancelled']].map(([value,label])=>`<option value="${value}" ${value===state.status?'selected':''}>${label}</option>`).join('')}</select></label>` : ''}<button class="secondary" type="submit">Search</button>${iconButton('refresh','refresh','Refresh records')}</form><div class="list-panel"><div id="record-list" aria-live="polite"></div></div><div class="pagination"><span id="page-summary"></span><div><button class="secondary" data-action="previous" disabled>Previous</button><button class="secondary" data-action="next" disabled>Next</button></div></div>`;
}
export function rowsHtml(state, admin) {
    const orders = state.view === 'orders';
    if (!state.rows.length) return `<div class="empty">${icon(orders?'orders':'parts')}<h2>${state.search || state.status ? 'No matching records' : orders ? 'Your next repair starts here' : 'Make room for your first part'}</h2><p>${state.search || state.status ? 'Try another search or status.' : orders ? 'Add an order to start tracking your work.' : 'Add the parts you keep on hand.'}</p></div>`;
    const actions = row => `<div class="row-actions">${orders ? iconButton('detail','eye','View order',`data-id="${e(row.id)}"`) + iconButton('invoice','orders','View invoice',`data-id="${e(row.id)}"`) + iconButton('notes','edit','Order notes',`data-id="${e(row.id)}"`) : ''}${iconButton('edit','edit',orders?'Edit order':'Edit part',`data-id="${e(row.id)}"`)}${admin?iconButton('delete','trash',orders?'Delete order':'Delete part',`data-id="${e(row.id)}"`):''}</div>`;
    const mobile = orders ? state.rows.map(row => `<button class="compact-order" data-action="detail" data-id="${e(row.id)}"><span class="compact-row-heading"><strong>${e(row.customer_name)}</strong><span class="compact-status status-${e(row.status)}">${e(statusLabel(row.status))}</span></span><span class="compact-device">${e(row.device)}</span><span class="compact-row-footer"><span>#${e(row.order_number)}</span><strong>${e(money(row.estimated_cost))}<span aria-hidden="true">&#8250;</span></strong></span></button>`).join('') : state.rows.map(row => `<details class="compact-part"><summary><span class="compact-row-heading"><strong>${e(row.part_name)}</strong><span class="part-quantity">${e(row.quantity)}<small>in stock</small></span></span><span class="compact-device">${e(row.part_number)}</span><span class="compact-row-footer"><span class="compact-stock ${row.quantity<=row.min_quantity?'stock-low':'stock-available'}">${row.quantity<=row.min_quantity?'Low stock':'In stock'}</span><strong>${e(money(row.unit_price))} &#8964;</strong></span></summary><div class="compact-part-details"><p>${e(row.category)} &middot; Minimum ${e(row.min_quantity)}</p>${actions(row)}</div></details>`).join('');
    return `<div class="compact-list mobile-only">${mobile}</div><div class="table-scroll desktop-only"><table class="data-table"><thead><tr>${(orders?['Order #','Customer','Device','Status','Received','Estimate','Actions']:['Part #','Name','Category','Stock','Unit price','Actions']).map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${state.rows.map(row=>`<tr>${orders?`<td class="mono">${e(row.order_number)}</td><td><button class="text-button" data-action="detail" data-id="${e(row.id)}">${e(row.customer_name)}</button><small>${e(row.phone)}</small></td><td>${e(row.device)}</td><td><span class="status status-${e(row.status)}">${e(statusLabel(row.status))}</span></td><td>${e(row.date_received)}</td><td>${e(money(row.estimated_cost))}</td>`:`<td class="mono">${e(row.part_number)}</td><td><strong>${e(row.part_name)}</strong></td><td>${e(row.category)}</td><td class="${row.quantity<=row.min_quantity?'low-stock':''}">${e(row.quantity)}</td><td>${e(money(row.unit_price))}</td>`}<td>${actions(row)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function reportHtml(from, to) {
    const formatDate = value => new Date(value + 'T12:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
    return `<section class="revenue-page"><header class="revenue-heading"><div><p class="revenue-eyebrow">BUSINESS OVERVIEW</p><h1 class="revenue-page-title">Revenue</h1></div><button class="revenue-orders" data-action="navigate" data-view="orders" data-status="completed" aria-label="View completed orders" title="View completed orders">${icon('orders')}</button></header><button class="period-selector" data-action="report-range" aria-haspopup="dialog"><span class="period-icon">${icon('calendar')}</span><span class="period-copy"><small>Reporting period</small><strong>${e(formatDate(from))} <span aria-hidden="true">&ndash;</span> ${e(formatDate(to))}</strong></span><span class="period-chevron" aria-hidden="true">&#8964;</span></button><div id="report-result" aria-live="polite"></div><p class="muted report-caption">Invoice charges for completed repairs, grouped by received date.</p></section>`;
}
export function summarizeRevenue(rows) {
    const days = new Map();
    let total = 0;
    const orders = rows.map(row => {
        if (!Array.isArray(row.components_changed)) throw new Error('A repair has invalid invoice charges. Correct it before viewing revenue.');
        const cents = row.components_changed.reduce((sum, part) => {
            const value = Number(part.cost);
            if (!Number.isFinite(value) || value < 0) throw new Error('A repair has an invalid charge. Correct it before viewing revenue.');
            return sum + Math.round(value * 100);
        },0);
        total += cents;
        days.set(row.date_received,(days.get(row.date_received)||0)+cents);
        return {...row,cents};
    });
    return {total, days: [...days].sort(([a],[b])=>a.localeCompare(b)), orders};
}
export function revenueChartHtml(report, range) {
    // Show every date in the selected range, including days with no revenue.
    // At most 31 daily buckets are requested by the repository.
    const from = range?.from || report.days[0]?.[0];
    const to = range?.to || report.days.at(-1)?.[0];
    const values = new Map(report.days);
    const days = [];
    if (from && to) {
        const end = new Date(to + 'T00:00:00Z');
        for (let date = new Date(from + 'T00:00:00Z'); date <= end && days.length < 31; date.setUTCDate(date.getUTCDate()+1)) {
            const key = date.toISOString().slice(0,10);
            days.push([key,values.get(key)||0]);
        }
    }
    const highest = Math.max(1,...days.map(([,cents])=>cents/100));
    const rawStep = highest/4, magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = Math.ceil(rawStep/magnitude)*magnitude, ceiling = step*4;
    const axis = value => new Intl.NumberFormat('en-MY',{notation: value>=10000?'compact':'standard',maximumFractionDigits:value<1?2:1}).format(value);
    const left=42, top=12, width=284, height=150, stride=width/Math.max(1,days.length);
    const ticks = Array.from({length:5},(_,i)=>{
        const y=top+height-i*height/4;
        return `<line x1="${left}" y1="${y}" x2="${left+width}" y2="${y}" class="chart-grid"/><text x="${left-7}" y="${y+3}" text-anchor="end">${e(axis(step*i))}</text>`;
    }).join('');
    const labelEvery = Math.max(1,Math.ceil(days.length/5));
    const bars = days.map(([date,cents],i)=>{
        const barHeight=(cents/100)/ceiling*height, barWidth=Math.min(30,stride*.72), x=left+i*stride+(stride-barWidth)/2;
        const label=new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
        return `${cents>0?`<rect x="${x}" y="${top+height-barHeight}" width="${barWidth}" height="${barHeight}" rx="2" class="chart-bar"><title>${e(label)}: ${e(money(cents/100))}</title></rect>`:''}${i%labelEvery===0?`<text x="${left+(i+.5)*stride}" y="${top+height+20}" text-anchor="middle">${e(label)}</text>`:''}`;
    }).join('');
    return `<svg class="revenue-chart-svg" viewBox="0 0 340 195" role="img" aria-label="Daily revenue in Malaysian ringgit from ${e(from)} to ${e(to)}. Expand daily totals below for exact values.">${ticks}${bars}</svg>`;
}
export function reportResultHtml(report, range) {
    return `<div class="revenue-summary"><div class="revenue-total"><p>Total Revenue</p><strong>${e(money(report.total/100))}</strong></div><div><p>Completed repairs</p><strong>${report.orders.length}</strong></div><div><p>Average per repair</p><strong>${e(money(report.orders.length?report.total/100/report.orders.length:0))}</strong></div></div><section class="revenue-chart"><header class="revenue-chart-heading"><h2>Revenue Trend</h2><span class="revenue-chart-unit">RM</span></header>${report.days.length?`${revenueChartHtml(report,range)}<details class="daily-totals"><summary>View daily totals</summary><table class="daily-revenue"><thead><tr><th>Date received</th><th>Revenue</th></tr></thead><tbody>${report.days.map(([date,value])=>`<tr><td>${e(date)}</td><td>${e(money(value/100))}</td></tr>`).join('')}</tbody></table></details>`:'<p class="revenue-empty">No completed repairs in this period.</p>'}</section><section class="revenue-breakdown"><h2>Revenue Breakdown</h2>${report.orders.length?report.orders.map(row=>`<div class="revenue-line"><span><strong>${e(row.customer_name)}</strong><small>${e(row.order_number)} &middot; ${e(row.date_received)}</small></span><strong>${e(money(row.cents/100))}</strong></div>`).join(''):'<p class="revenue-empty">No completed repairs.</p>'}</section>`;
}
