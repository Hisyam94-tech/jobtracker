import {escapeHtml as e, field, icon, modal, showError, submitForm} from './ui.js';

export const customersHtml = () => `<section class="customer-settings" aria-labelledby="customers-heading"><div class="customer-heading"><div><h3 id="customers-heading">Customers</h3><p>Save contact details for your next repair.</p></div><button type="button" class="primary" data-customer-action="add">${icon('plus')}Add customer</button></div><form class="customer-search"><label class="field"><span>Search by</span><select name="search_field" aria-label="Search by"><option value="customer_name">Name</option><option value="phone">Phone</option><option value="email">Email</option></select></label><label class="field"><span>Search customers</span><input name="search_text" maxlength="100" placeholder="Starts with..." type="search"></label><button class="secondary" type="submit">Search</button></form><p class="error" data-error role="alert" hidden></p><p class="notice" data-customer-notice role="status" hidden></p><div class="customer-list" aria-live="polite"></div><div class="customer-pagination"><span data-customer-page></span><div><button type="button" class="secondary" data-customer-action="previous" disabled>Previous</button><button type="button" class="secondary" data-customer-action="next" disabled>Next</button></div></div></section>`;

export function mountCustomers(container, repository, company) {
    let disposed = false, version = 0, controller, editDialog;
    let page = 0, cursors = [null], rows = [], hasNext = false, search = '', searchField = 'customer_name';
    const list = container.querySelector('.customer-list');
    const previous = container.querySelector('[data-customer-action=previous]');
    const next = container.querySelector('[data-customer-action=next]');
    const notice = container.querySelector('[data-customer-notice]');
    async function load() {
        controller?.abort(); controller = new AbortController();
        const current = ++version;
        previous.disabled = true; next.disabled = true; rows = [];
        list.innerHTML = '<p class="customer-empty" role="status">Loading customers...</p>';
        container.querySelector('[data-customer-page]').textContent = '';
        showError(container, '');
        try {
            const result = await repository.customers(company, {search, field: searchField, cursor: cursors[page], signal: controller.signal});
            if (disposed || current !== version) return;
            rows = result.rows; hasNext = result.hasNext;
            list.innerHTML = rows.length ? rows.map((row, index) => `<article class="customer-card"><div class="customer-avatar" aria-hidden="true">${icon('user')}</div><div class="customer-copy"><h4>${e(row.customer_name)}</h4><p>${e(row.phone)}</p>${row.email ? `<p>${e(row.email)}</p>` : ''}${row.address ? `<p class="customer-address">${e(row.address)}</p>` : ''}</div><button class="icon-button" type="button" data-customer-action="edit" data-index="${index}" aria-label="Edit ${e(row.customer_name)}">${icon('edit')}</button></article>`).join('') : `<p class="customer-empty">${search ? 'No matching customers. Try a different search.' : 'No customers yet. Add your first customer above.'}</p>`;
            previous.disabled = page === 0; next.disabled = !hasNext;
            container.querySelector('[data-customer-page]').textContent = `Page ${page + 1} · ${rows.length} customers`;
        } catch (error) {
            if (disposed || current !== version) return;
            list.innerHTML = ''; showError(container, error.message);
            previous.disabled = page === 0;
        }
    }
    function edit(record = null) {
        if (disposed || editDialog?.open) return;
        const row = record || {};
        const dialog = modal(record ? 'Edit customer' : 'Add customer', `<form><p class="error" data-error role="alert" hidden></p><fieldset><div class="form-grid">${field('Customer name', 'customer_name', row.customer_name, {required:true,max:100,autocomplete:'name'})}${field('Phone number', 'phone', row.phone, {required:true,max:40,type:'tel',autocomplete:'tel'})}${field('Email (optional)', 'email', row.email, {max:254,type:'email',autocomplete:'email',wide:true})}<label class="field wide"><span>Address (optional)</span><textarea aria-label="Address (optional)" name="address" rows="3" maxlength="1000" autocomplete="street-address">${e(row.address)}</textarea></label></div><div class="dialog-footer"><button class="secondary" type="button" data-customer-cancel>Cancel</button><button class="primary" type="submit">${record ? 'Save customer' : 'Add customer'}</button></div></fieldset></form>`);
        editDialog = dialog; dialog.classList.add('customer-dialog');
        const saving = new AbortController();
        dialog.addEventListener('close', () => { saving.abort(); if (editDialog === dialog) editDialog = null; }, {once:true});
        dialog.querySelector('[data-customer-cancel]').onclick = () => dialog.close();
        const form = dialog.querySelector('form');
        form.onsubmit = event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            submitForm(form, async () => {
                if (disposed) throw new Error('The workspace changed. Reopen this form.');
                const payload = {customer_name:values.customer_name.trim(), phone:values.phone.trim(), email:values.email.trim() || null, address:values.address.trim() || null};
                if (!payload.customer_name || !payload.phone) throw new Error('Enter a customer name and phone number.');
                await repository.saveCustomer(company, payload, record, saving.signal);
                if (disposed || !dialog.open) return;
                dialog.close(); page = 0; cursors = [null];
                search = ''; container.querySelector('[name=search_text]').value = '';
                notice.textContent = record ? 'Customer updated.' : 'Customer added.'; notice.hidden = false;
                await load();
            });
        };
    }
    container.querySelector('.customer-search').onsubmit = event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        search = String(values.get('search_text')).trim(); searchField = String(values.get('search_field'));
        page = 0; cursors = [null]; notice.hidden = true; load();
    };
    container.addEventListener('click', event => {
        const button = event.target.closest('[data-customer-action]');
        if (!button || button.disabled || disposed) return;
        switch (button.dataset.customerAction) {
            case 'add': edit(); break;
            case 'edit': if (rows[Number(button.dataset.index)]) edit(rows[Number(button.dataset.index)]); break;
            case 'previous': if (page) { page--; load(); } break;
            case 'next': {
                const last = rows.at(-1);
                if (hasNext && last) { cursors[++page] = {created_at:last.created_at, id:last.id}; load(); }
                break;
            }
        }
    });
    load();
    return () => { disposed = true; version++; controller?.abort(); editDialog?.close(); };
}
