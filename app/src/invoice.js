import {escapeHtml as e, money} from './ui.js';
export const TEMPLATES = Object.freeze({circuitcare_v1: 'Classic blue', modern_v1: 'Modern teal'});
export function invoiceHtml(order, company) {
    if (order.company_id !== company.id) throw new Error('The invoice company does not match this order.');
    if (!Object.hasOwn(TEMPLATES, company.invoice_template)) throw new Error('This company has an unsupported invoice style. Ask an administrator to choose a supported style.');
    if (!Array.isArray(order.components_changed)) throw new Error('The order component data is invalid.');
    const modern = company.invoice_template === 'modern_v1';
    let total = 0;
    const rows = order.components_changed.map(component => {
        const cost = Number(component.cost);
        if (!Number.isFinite(cost) || cost < 0) throw new Error('A component has an invalid cost. Update the order first.');
        total += Math.round(cost * 100);
        return `<tr><td>${e(component.name)}</td><td>${e(money(cost))}</td></tr>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice ${e(order.order_number)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#e8edf2;padding:24px;font:13px/1.6 Arial,sans-serif;color:#24343c}.page{max-width:700px;margin:auto;background:#fff;padding:44px;color:#24343c;--accent:${modern ? '#12675e' : '#1e3a5f'}}
.header{border-bottom:3px solid var(--accent);padding-bottom:24px;margin-bottom:24px;text-align:${modern ? 'left' : 'center'}}h1{font-size:28px;color:var(--accent);margin:0 0 8px;overflow-wrap:anywhere}.badge{display:inline-block;padding:6px 16px;background:var(--accent);color:#fff;font-size:11px;letter-spacing:2px;font-weight:bold}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.info-box{border:1px solid #dce4e8;border-radius:${modern ? '12px' : '4px'};padding:16px;break-inside:avoid}h2{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin:0 0 12px}.info-box p{margin:6px 0;overflow-wrap:anywhere}.label{color:#64748b}.repair{margin-bottom:24px}table{width:100%;border-collapse:collapse}th{background:var(--accent);color:#fff;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere}td:last-child,th:last-child{text-align:right;white-space:nowrap}tr{break-inside:avoid}.grand-total{display:flex;justify-content:space-between;gap:20px;background:var(--accent);color:#fff;margin:20px 0 0 auto;max-width:280px;padding:14px;font-weight:bold;break-inside:avoid}.footer{margin-top:36px;border-top:1px solid #e2e8f0;padding-top:16px;color:#64748b;text-align:center;font-size:11px}
@media screen and (max-width:600px){body{padding:10px}.page{padding:24px 16px}.info-grid{grid-template-columns:1fr}h1{font-size:23px}}
@media print{body{background:#fff;padding:0}.page{padding:20px}}
</style></head><body><main class="page"><header class="header"><h1>${e(company.name)}</h1><span class="badge">REPAIR INVOICE</span></header>
<div class="info-grid"><section class="info-box"><h2>Customer</h2><p><strong>${e(order.customer_name)}</strong></p><p>${e(order.phone)}</p>${order.email ? `<p>${e(order.email)}</p>` : ''}</section><section class="info-box"><h2>Order details</h2><p><span class="label">Order:</span> ${e(order.order_number)}</p><p><span class="label">Received:</span> ${e(order.date_received)}</p>${order.end_date ? `<p><span class="label">Completed:</span> ${e(order.end_date)}</p>` : ''}</section></div>
<section class="repair info-box"><h2>Repair details</h2><p><strong>${e(order.device)}</strong></p><p>${e(order.issue).replace(/\n/g, '<br>')}</p></section>
<h2>Components &amp; charges</h2><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="2">No charges recorded</td></tr>'}</tbody></table><div class="grand-total"><span>Total</span><span>${e(money(total / 100))}</span></div>
<footer class="footer">Thank you for choosing ${e(company.name)}.</footer></main></body></html>`;
}
export function openInvoice(order, company) {
    const html = invoiceHtml(order, company);
    window.InvoicePreview.open(html, 'Invoice-' + order.order_number.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf');
}
