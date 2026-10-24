import {mountUserAdmin} from './user-admin.js';
import {customersHtml, mountCustomers} from './customers.js';
import {attachRepairSuggestions} from './repair-controls.js';
import {RepairImages, mountRepairImages} from './repair-images.js';
import {openDateRange} from './date-range.js';
import {Auth} from './auth.js';
import {Repository, PAGE_SIZE} from './data.js';
import {escapeHtml as e, money, icon, iconButton, field, modal, submitForm, showError, statusLabel} from './ui.js';
import {TEMPLATES, openInvoice} from './invoice.js';
import {logo, navigation, homeHtml, listHtml, rowsHtml, reportHtml, summarizeRevenue, reportResultHtml} from './workspace-view.js';

const root = document.querySelector('#app');
const state = {context: null, membership: null, view: 'home', rows: [], search: '', status: '', cursors: [null], page: 0, hasNext: false, generation: 0, controller: null};
let auth, repository, disposeCustomers, disposeUserAdmin;
const errorBox = '<p class="error" data-error role="alert" hidden></p>';
const workspaceLoader = '<div class="workspace-loader" role="status" aria-label="Loading JobTracker"><img src="./src/assets/jobtracker.png" alt="" width="64" height="64"><span class="workspace-loader-spinner" aria-hidden="true"></span></div>';
const brand = `${logo}<span>JobTracker<small>Repair Management</small></span>`;
const templateOptions = selected => Object.entries(TEMPLATES).map(([key, label]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${label}</option>`).join('');
const statusOptions = selected => ['in-progress', 'completed', 'Pending-Payment', 'cancelled'].map(value => `<option value="${value}" ${selected === value ? 'selected' : ''}>${statusLabel(value)}</option>`).join('');
const canAdmin = () => ['owner', 'admin'].includes(state.membership?.role);
const company = () => state.membership.company;
function cancelWork() {
    disposeCustomers?.(); disposeCustomers = null;
    disposeUserAdmin?.(); disposeUserAdmin = null;
    state.generation++;
    state.controller?.abort();
    document.querySelectorAll('dialog').forEach(dialog => dialog.close());
}
function resetData() {
    cancelWork();
    Object.assign(state, {context: null, membership: null, rows: [], search: '', status: '', cursors: [null], page: 0, hasNext: false, view: 'home', reportRange: null});
}
function authLayout(content) {
    root.innerHTML = `<div class="auth-layout"><header class="auth-header"><a class="brand" href="./">${brand}</a></header><section class="auth-content"><div class="auth-card">${content}</div><p class="auth-footer">JobTracker &middot; Repair Order Management</p></section></div>`;
}
function login(message = '') {
    authLayout(`<span class="eyebrow">WELCOME BACK</span><h1>Sign in to your workspace</h1><p class="muted intro">Your orders, your team, your next repair.</p><form data-form="login">${errorBox}<fieldset><label class="field"><span>Username</span><input name="username" type="text" required maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false"></label><label class="field"><span>Password</span><span class="password-input"><input name="password" type="password" required autocomplete="current-password"><button type="button" data-action="password-visibility" aria-label="Show password" title="Show password">${icon('eye')}</button></span></label><div class="form-link-row"><button class="text-button" type="button" data-action="forgot">Forgot password?</button></div><button class="primary full" type="submit">Sign in ${icon('arrow')}</button></fieldset></form><p class="access-note">Need access? Ask your administrator for an account.<br>Your session stays in this browser tab.</p>`);
    showError(root, message);
}
function forgot() {
    authLayout(`<span class="eyebrow">ACCOUNT ACCESS</span><h1>Reset your password</h1><p class="muted intro">Enter your email address to request a reset link.</p><form data-form="forgot">${errorBox}<fieldset>${field('Email address', 'email', '', {type: 'email', required: true, autocomplete: 'email', max: 254})}<button class="primary full" type="submit">Send reset link</button></fieldset><p class="notice" data-notice role="status" hidden></p></form><button class="text-button back-link" data-action="login">Back to sign in</button>`);
}
function passwordSetup() {
    authLayout(`<span class="eyebrow">SECURE YOUR ACCOUNT</span><h1>Set your password</h1><p class="muted intro">Choose a password with at least 12 characters.</p><form data-form="set-password">${errorBox}<fieldset>${field('New password', 'password', '', {type: 'password', required: true, autocomplete: 'new-password', min: 12})}${field('Confirm password', 'confirmation', '', {type: 'password', required: true, autocomplete: 'new-password'})}<button class="primary full" type="submit">Save password</button></fieldset></form><button class="text-button back-link" data-action="logout">Sign out</button>`);
}
function setup() {
    authLayout(`<span class="eyebrow">MAKE IT YOURS</span><h1>Set up your company</h1><p class="muted intro">Create your repair workspace and choose how your invoices look. You will be its owner.</p><form data-form="setup">${errorBox}<fieldset>${field('Your name', 'name', state.context.profile?.display_name || '', {required: true, max: 100, autocomplete: 'name'})}${field('Company name', 'company', '', {required: true, max: 150, autocomplete: 'organization'})}<label class="field"><span>Invoice style</span><select name="template" required><option value="">Choose an invoice style</option>${templateOptions('')}</select></label><button class="primary full" type="submit">Create company ${icon('arrow')}</button></fieldset></form><p class="access-note">Joining an existing team? Ask its administrator to assign your account before continuing.</p><button class="text-button" data-action="logout">Sign out</button>`);
}
function blocked() {
    authLayout(`<span class="eyebrow">COMPANY ACCESS</span><h1>Your workspace is unavailable</h1><p class="muted intro">Your company or membership may be suspended. Ask your administrator to check your access.</p>${errorBox}<button class="primary full" data-action="retry-context">Check access again</button><button class="text-button back-link" data-action="logout">Sign out</button>`);
}
function chooseCompany(memberships) {
    authLayout(`<span class="eyebrow">YOUR COMPANIES</span><h1>Choose a workspace</h1><p class="muted intro">Keep each company's jobs and parts in its own workspace.</p>${errorBox}<div class="company-choices">${memberships.map(membership => `<button class="company-choice" data-action="select-company" data-company="${e(membership.company_id)}"><span><strong>${e(membership.company.name)}</strong><small>${e(membership.role)}</small></span>${icon('arrow')}</button>`).join('')}</div><button class="text-button back-link" data-action="logout">Sign out</button>`);
}
async function loadContext(desiredCompany) {
    cancelWork();
    state.rows = [];
    state.context = null;
    state.membership = null;
    const generation = state.generation;
    state.controller = new AbortController();
    root.innerHTML = workspaceLoader;
    try {
        const context = await repository.context(state.controller.signal);
        if (generation !== state.generation) return;
        state.context = context;
        if (!context.memberships.length) return setup();
        const active = context.memberships.filter(m => m.status === 'active' && m.company?.status === 'active');
        if (!active.length) return blocked();
        const selected = active.find(m => m.company_id === desiredCompany) || (active.length === 1 ? active[0] : null);
        if (!selected) return chooseCompany(active);
        selectCompany(selected.company_id);
    } catch (error) {
        if (generation !== state.generation) return;
        authLayout(`<h1>Unable to open your workspace</h1>${errorBox}<button class="primary full" data-action="retry-context">Try again</button><button class="text-button back-link" data-action="logout">Sign out</button>`);
        showError(root, error.message);
    }
}
function selectCompany(id) {
    const membership = state.context.memberships.find(m => m.company_id === id && m.status === 'active' && m.company?.status === 'active');
    if (!membership) throw new Error('Company access is unavailable.');
    cancelWork();
    Object.assign(state, {membership, view: 'home', search: '', status: '', page: 0, cursors: [null], rows: [], reportRange: null});
    renderWorkspace();
    loadView();
}
function monthRange() {
    const today = localDate();
    return {from: today.slice(0, 8) + '01', to: today};
}
function renderWorkspace() {
    disposeCustomers?.(); disposeCustomers = null;
    disposeUserAdmin?.(); disposeUserAdmin = null;
    const memberships = state.context.memberships.filter(m => m.status === 'active' && m.company?.status === 'active');
    const report = state.reportRange || monthRange();
    const content = state.view === 'settings' ? settingsHtml() : state.view === 'home' ? homeHtml(state.context.profile,state.membership.role) : state.view === 'revenue' ? reportHtml(report.from,report.to) : listHtml(state);
    root.innerHTML = `<div class="workspace">${navigation(state.view,state.status)}<section class="main-panel main-content"><header class="topbar"><button class="header-home" data-action="navigate" data-view="home" aria-label="Go to Home">${logo}</button><strong>JOBTRACKER</strong><button class="header-settings" data-action="navigate" data-view="settings" aria-label="Company settings">${icon('settings')}</button></header><div class="company-strip"><label class="sr-only" for="company-select">Company</label><select id="company-select">${memberships.map(m=>`<option value="${e(m.company_id)}" ${m.company_id===company().id?'selected':''}>${e(m.company.name)}</option>`).join('')}</select>${iconButton('logout','logout','Sign out')}</div><div class="page-content">${errorBox}<div id="workspace-content" class="view-${state.view}">${content}</div></div></section></div>`;
    if (state.view === 'settings') {
        disposeCustomers = mountCustomers(root.querySelector('.customer-settings'), repository, company().id);
        disposeUserAdmin = mountUserAdmin(root.querySelector('[data-user-management]'), repository);
    }
    root.querySelector('#company-select').onchange = event => selectCompany(event.target.value);
}
function loadView() {
    if (state.view === 'home') return loadOverview();
    if (state.view === 'revenue') return loadReport();
    if (state.view === 'orders' || state.view === 'parts') return loadList();
}
async function loadOverview() {
    state.controller?.abort(); state.controller = new AbortController();
    const signal = state.controller.signal, generation = ++state.generation, id = company().id;
    showError(root,'');
    const range = monthRange();
    await Promise.all([
        repository.overview(id,signal).then(values => {
            if (generation !== state.generation) return;
            for (const [key,value] of Object.entries(values)) root.querySelector(`[data-metric="${key}"]`).textContent = value.toLocaleString();
        }).catch(error => { if (generation === state.generation) showError(root,error.message); }),
        repository.revenue(id,range.from,range.to,signal).then(rows => {
            if (generation !== state.generation) return;
            root.querySelector('[data-metric="revenue"]').textContent = money(summarizeRevenue(rows).total/100);
        }).catch(error => {
            if (generation !== state.generation) return;
            root.querySelector('[data-metric="revenue"]').textContent = 'Unavailable';
            showError(root,error.message);
        })
    ]);
}
async function loadReport() {
    state.controller?.abort(); state.controller = new AbortController();
    const generation = ++state.generation, range = state.reportRange || monthRange();
    const target = root.querySelector('#report-result');
    target.innerHTML = '<p class="empty" role="status">Loading revenue...</p>'; showError(root,'');
    try {
        const rows = await repository.revenue(company().id,range.from,range.to,state.controller.signal);
        if (generation === state.generation) target.innerHTML = reportResultHtml(summarizeRevenue(rows),range);
    } catch (error) {
        if (generation !== state.generation) return;
        target.innerHTML = ''; showError(root,error.message);
    }
}
function reportRangeDialog() {
    const generation = state.generation;
    openDateRange(state.reportRange || monthRange(), range => {
        if (generation !== state.generation) return;
        state.reportRange = range; renderWorkspace(); loadReport();
    });
}

function editProfile() {
    const generation = state.generation;
    const profile = state.context.profile;
    const dialog = modal('Edit profile',`<form>${errorBox}<fieldset>${field('Your name','display_name',profile?.display_name,{required:true,max:100,autocomplete:'name'})}<button class="primary" type="submit">Save profile</button></fieldset></form>`);
    const form = dialog.querySelector('form');
    form.onsubmit = event => { event.preventDefault(); submitForm(form, async () => {
        const name = form.elements.display_name.value.trim();
        if (!name) throw new Error('Enter your name.');
        const updated = await repository.updateProfile(auth.session.user.id,name,profile.updated_at);
        if (generation !== state.generation) return;
        state.context.profile = updated; dialog.close(); renderWorkspace(); loadView();
    }); };
}
function orderDetail(record) {
    if (!Array.isArray(record.components_changed)) throw new Error('This order has invalid component data.');
    const generation = state.generation;
    const dialog = modal('Order details - ' + record.order_number,`<div class="order-detail"><span class="status status-${e(record.status)}">${e(statusLabel(record.status))}</span><div class="detail-grid"><section><h3>Customer Information</h3><strong>${e(record.customer_name)}</strong><p>${e(record.phone)}</p><p>${e(record.email)}</p></section><section><h3>Device Information</h3><strong>${e(record.device)}</strong><p>Received: ${e(record.date_received)}</p><p>Estimate: ${e(money(record.estimated_cost))}</p></section></div><section><h3>Issue Description</h3><p>${e(record.issue)}</p></section><section><h3>Components &amp; charges</h3>${record.components_changed.map(c=>`<div class="charge-line"><span>${e(c.name)}</span><strong>${e(money(c.cost))}</strong></div>`).join('') || '<p>No charges added.</p>'}</section><section data-repair-images></section><div class="detail-actions"><button class="primary" data-detail="invoice">${icon('orders')}View invoice</button><button class="secondary" data-detail="edit">${icon('edit')}Edit order</button><button class="secondary" data-detail="notes">${icon('eye')}Order notes</button>${canAdmin()?'<button class="danger" data-detail="delete">Delete order</button>':''}</div>${errorBox}</div>`);
    mountRepairImages(dialog.querySelector('[data-repair-images]'), dialog, new RepairImages(auth, record.company_id), record.images, false);
    dialog.addEventListener('click', async event => {
        const button = event.target.closest('[data-detail]');
        if (!button || generation !== state.generation) return;
        button.disabled = true;
        try {
            if (button.dataset.detail === 'invoice') {
                const current = await repository.company(company().id);
                if (generation !== state.generation) return;
                dialog.close(); openInvoice(record,current);
            } else {
                dialog.close();
                if (button.dataset.detail === 'edit') editor(record);
                if (button.dataset.detail === 'notes') notesDialog(record);
                if (button.dataset.detail === 'delete') deleteDialog(record);
            }
        } catch (error) { showError(dialog,error.message); }
        finally { if (button.isConnected) button.disabled = false; }
    });
}
function settingsHtml() {
    const current = company();
    return `<section class="settings-panel"><div class="settings-title"><span class="settings-icon">${icon('settings')}</span><div><h2>Company profile</h2><p class="muted">Changes apply to this company only.</p></div></div><form data-form="company">${errorBox}<fieldset ${canAdmin() ? '' : 'disabled'}>${field('Company name', 'name', current.name, {required: true, max: 150})}<label class="field"><span>Invoice style</span><select name="template" required><option value="">Choose an invoice style</option>${templateOptions(current.invoice_template)}</select></label>${canAdmin() ? '<button class="primary" type="submit">Save company details</button>' : ''}</fieldset><p class="notice" data-notice role="status" hidden></p></form>${canAdmin() ? '' : '<p class="access-note">An owner or administrator can edit company details.</p>'}<div class="settings-divider"></div>${customersHtml()}<div data-user-management></div><div class="settings-divider"></div><h3>Your account</h3><p class="muted">${e(auth.session.user.email)}</p><button class="secondary" data-action="change-password">Change password</button></section>`;
}
async function loadList() {
    state.controller?.abort();
    state.controller = new AbortController();
    const generation = ++state.generation;
    const target = root.querySelector('#record-list');
    if (!target || !state.membership) return;
    state.rows = [];
    target.innerHTML = '<div class="empty" role="status">Loading records...</div>';
    root.querySelector('[data-action=previous]').disabled = true;
    root.querySelector('[data-action=next]').disabled = true;
    root.querySelector('#page-summary').textContent = '';
    showError(root, '');
    try {
        const result = await repository.list(state.view, company().id, {search: state.search, status: state.status, cursor: state.cursors[state.page], signal: state.controller.signal});
        if (generation !== state.generation) return;
        state.rows = result.rows;
        state.hasNext = result.hasNext;
        renderRows();
    } catch (error) {
        if (generation !== state.generation) return;
        target.innerHTML = '<div class="empty">Records could not be loaded. Refresh to try again.</div>';
        showError(root, error.message);
        root.querySelector('[data-action=previous]').disabled = state.page === 0;
    }
}
function renderRows() {
    const target = root.querySelector('#record-list');
    target.innerHTML = rowsHtml(state,canAdmin());
    root.querySelector('#page-summary').textContent = `Page ${state.page + 1} - ${state.rows.length} record${state.rows.length === 1 ? '' : 's'} - up to ${PAGE_SIZE} per page`;
    root.querySelector('[data-action=previous]').disabled = state.page === 0;
    root.querySelector('[data-action=next]').disabled = !state.hasNext;
}
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function componentRow(component = {name: '', cost: 0}) {
    return `<div class="component-row">${field('Description', 'component_name', component.name, {required: true, max: 200})}${field('Cost (RM)', 'component_cost', component.cost, {type: 'number', required: true, min: 0, max: 99999999.99, step: '0.01'})}${iconButton('remove-component', 'close', 'Remove charge')}</div>`;
}
function editor(record = null) {
    const kind = state.view;
    const companyId = company().id;
    const generation = state.generation;
    const isOrder = kind === 'orders';
    const item = record || {};
    if (isOrder && record && !Array.isArray(item.components_changed)) throw new Error('This order has invalid component data.');
    const content = isOrder ? `<div class="form-grid">${field('Order number', 'order_number', item.order_number, {required: true, max: 20})}${field('Customer name', 'customer_name', item.customer_name, {required: true, max: 100})}${field('Phone', 'phone', item.phone, {required: true, type: 'tel', max: 40})}${field('Email (optional)', 'email', item.email, {type: 'email', max: 254})}${field('Device', 'device', item.device, {required: true, max: 100})}<label class="field"><span>Status</span><select name="status">${statusOptions(item.status || 'in-progress')}</select></label>${field('Date received', 'date_received', item.date_received || localDate(), {type: 'date', required: true})}${field('Date completed (optional)', 'end_date', item.end_date, {type: 'date'})}${field('Estimate (RM)', 'estimated_cost', item.estimated_cost ?? 0, {type: 'number', min: 0, max: 99999999.99, step: '0.01', required: true})}<label class="field wide"><span>Issue description</span><textarea name="issue" required rows="3">${e(item.issue)}</textarea></label></div><section class="repair-images" data-repair-images></section><div class="section-heading"><h3>Components &amp; charges</h3><button type="button" class="text-button" data-action="add-component">+ Add charge</button></div><p class="muted small">Invoice totals use these charges. The estimate is stored separately.</p><div data-components>${(item.components_changed || []).map(componentRow).join('')}</div>` : `<div class="form-grid">${field('Part number', 'part_number', item.part_number, {required: true, max: 50})}${field('Part name', 'part_name', item.part_name, {required: true, max: 100})}${field('Quantity', 'quantity', item.quantity ?? 0, {type: 'number', required: true, min: 0, max: 2147483647, step: '1'})}${field('Unit price (RM)', 'unit_price', item.unit_price ?? 0, {type: 'number', required: true, min: 0, max: 99999999.99, step: '0.01'})}${field('Minimum quantity', 'min_quantity', item.min_quantity ?? 5, {type: 'number', required: true, min: 0, max: 2147483647, step: '1'})}${field('Category', 'category', item.category ?? 'Other', {required: true, max: 50})}${field('Supplier (optional)', 'supplier', item.supplier, {max: 100})}${field('Location (optional)', 'location', item.location, {max: 50})}<label class="field wide"><span>Description</span><textarea name="description" rows="3">${e(item.description)}</textarea></label></div>`;
    const dialog = modal(`${record ? 'Edit' : 'New'} ${isOrder ? 'repair order' : 'spare part'}`, `<form>${errorBox}<fieldset>${content}<div class="dialog-footer"><button class="secondary" type="button" data-action="cancel">Cancel</button><button class="primary" type="submit">${record ? 'Save changes' : isOrder ? 'Create order' : 'Add part'}</button></div></fieldset></form>`);
    const form = dialog.querySelector('form');
    let images;
    if (isOrder) {
        dialog.classList.add('repair-dialog');
        attachRepairSuggestions(dialog, repository, companyId);
        images = mountRepairImages(dialog.querySelector('[data-repair-images]'), dialog, new RepairImages(auth, companyId), item.images || []);
        const received = form.elements.date_received, completed = form.elements.end_date;
        const updateMinimum = () => { completed.min = received.value; };
        received.addEventListener('change', updateMinimum); updateMinimum();
    }
    dialog.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'cancel') dialog.close();
        if (action === 'add-component') dialog.querySelector('[data-components]').insertAdjacentHTML('beforeend', componentRow());
        if (action === 'remove-component') event.target.closest('.component-row').remove();
    });
    form.onsubmit = event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        submitForm(form, async () => {
            if (generation !== state.generation) throw new Error('The workspace changed. Reopen this form.');
            let payload;
            if (isOrder) {
                payload = Object.fromEntries(['order_number','customer_name','phone','email','device','issue','status','date_received'].map(key => [key, values[key].trim()]));
                payload.end_date = values.end_date || null;
                if (payload.end_date && payload.end_date < payload.date_received) throw new Error('Completion date cannot be before the received date.');
                payload.estimated_cost = Number(values.estimated_cost);
                payload.components_changed = Array.from(form.querySelectorAll('.component-row'), row => ({name: row.querySelector('[name=component_name]').value.trim(), cost: Number(row.querySelector('[name=component_cost]').value)}));
                if (payload.components_changed.some(c => !c.name || !Number.isFinite(c.cost) || c.cost < 0)) throw new Error('Each charge needs a description and a nonnegative amount.');
            } else {
                payload = Object.fromEntries(['part_number','part_name','description','supplier','location','category'].map(key => [key, values[key].trim()]));
                for (const key of ['quantity','unit_price','min_quantity']) payload[key] = Number(values[key]);
                if (!Number.isInteger(payload.quantity) || !Number.isInteger(payload.min_quantity)) throw new Error('Stock quantities must be whole numbers.');
            }
            if (isOrder) payload.images = await images.save();
            if (!dialog.open || generation !== state.generation) throw new Error('The workspace changed. Reopen this form.');
            await repository.save(kind, companyId, payload, record);
            if (generation !== state.generation) return;
            dialog.close();
            state.page = 0; state.cursors = [null];
            await loadList();
        });
    };
}
function notesDialog(record) {
    if (!Array.isArray(record.updates)) throw new Error('This order has invalid notes data.');
    const companyId = company().id;
    const generation = state.generation;
    const dialog = modal('Order notes - ' + record.order_number, `<div class="notes-list">${record.updates.length ? record.updates.map(note => `<article><p>${e(note.text)}</p><small>${e(note.user)} - ${e(note.date)}</small></article>`).join('') : '<p class="muted">No notes yet.</p>'}</div><form>${errorBox}<fieldset><label class="field"><span>Add a progress note</span><textarea name="note" rows="3" maxlength="4000" required></textarea></label><button class="primary" type="submit">Save note</button></fieldset></form>`);
    const form = dialog.querySelector('form');
    form.onsubmit = event => {
        event.preventDefault();
        const text = form.elements.note.value.trim();
        submitForm(form, async () => {
            if (!text) throw new Error('Enter a progress note.');
            if (generation !== state.generation) throw new Error('The workspace changed. Reopen this order.');
            const updates = [...record.updates, {text, date: new Date().toISOString(), user: state.context.profile?.display_name || auth.session.user.email}];
            await repository.save('orders', companyId, {updates}, record);
            if (generation !== state.generation) return;
            dialog.close(); await loadList();
        });
    };
}
function deleteDialog(record) {
    const kind = state.view, companyId = company().id, generation = state.generation;
    const dialog = modal('Delete ' + (kind === 'orders' ? 'order' : 'part'), `<p>Delete <strong>${e(record.order_number || record.part_number)}</strong>? This permanently removes the record.</p><form>${errorBox}<fieldset><div class="dialog-footer"><button class="secondary" type="button" data-cancel>Cancel</button><button class="danger" type="submit">Delete record</button></div></fieldset></form>`);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    const form = dialog.querySelector('form');
    form.onsubmit = event => {
        event.preventDefault();
        submitForm(form, async () => {
            if (!canAdmin() || generation !== state.generation) throw new Error('Administrator access is required.');
            await repository.remove(kind, companyId, record);
            if (generation !== state.generation) return;
            dialog.close(); await loadList();
        });
    };
}
root.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches('form[data-form]')) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'report') {
        state.reportRange = {from: values.from, to: values.to}; renderWorkspace(); loadReport(); return;
    }
    if (form.dataset.form === 'search') {
        state.search = values.search.trim(); state.status = values.status || ''; state.page = 0; state.cursors = [null];
        renderWorkspace(); loadList(); return;
    }
    submitForm(form, async () => {
        switch (form.dataset.form) {
            case 'login': {
                await auth.signIn(values.username, values.password);
                form.reset();
                await loadContext(); break;
            }
            case 'forgot': {
                await auth.resetPassword(values.email.trim());
                const notice = form.querySelector('[data-notice]');
                notice.hidden = false; notice.textContent = 'If an account exists for this email, a reset link will arrive shortly.';
                break;
            }
            case 'set-password': {
                if (values.password.length < 12) throw new Error('Use at least 12 characters.');
                if (values.password !== values.confirmation) throw new Error('The passwords do not match.');
                await auth.setPassword(values.password); form.reset(); await loadContext(); break;
            }
            case 'setup': {
                const id = await repository.createCompany(values.company.trim(), values.name.trim(), values.template);
                await loadContext(id); break;
            }
            case 'company': {
                const id = company().id;
                const generation = state.generation;
                await repository.updateCompany(company(), values.name.trim(), values.template);
                const updated = await repository.company(id);
                if (generation !== state.generation) return;
                state.membership.company = updated;
                renderWorkspace();
                const notice = root.querySelector('[data-notice]'); notice.hidden = false; notice.textContent = 'Company details saved.';
                break;
            }
        }
    });
});
root.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    try {
        switch (action) {
            case 'password-visibility': {
                const input = button.previousElementSibling;
                const show = input.type === 'password'; input.type = show ? 'text' : 'password';
                button.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); button.title = show ? 'Hide password' : 'Show password'; break;
            }
            case 'forgot': forgot(); break;
            case 'login': login(); break;
            case 'logout': button.disabled = true; await auth.signOut(); break;
            case 'retry-context': await loadContext(state.membership?.company_id); break;
            case 'select-company': selectCompany(button.dataset.company); break;
            case 'change-password': cancelWork(); state.rows = []; passwordSetup(); break;
            case 'navigate': {
                cancelWork(); state.view = button.dataset.view; state.search = ''; state.status = button.dataset.status || '';  state.page = 0; state.cursors = [null]; state.rows = [];
                renderWorkspace(); loadView(); break;
            }
            case 'filter-status': {
                cancelWork(); state.status = button.dataset.status; state.page = 0; state.cursors = [null];
                renderWorkspace(); loadList(); break;
            }
            case 'new-order': {
                if (state.view !== 'orders') {
                    cancelWork(); state.view = 'orders'; state.search = ''; state.status = ''; state.page = 0; state.cursors = [null];
                    renderWorkspace();
                    const loading = loadList(), generation = state.generation;
                    await loading;
                    if (generation !== state.generation) return;
                }
                if (state.membership && state.view === 'orders') editor(); break;
            }
            case 'refresh-overview': await loadOverview(); break;
            case 'report-range': reportRangeDialog(); break;
            case 'edit-profile': editProfile(); break;
            case 'refresh': await loadList(); break;
            case 'new': editor(); break;
            case 'previous': state.page--; await loadList(); break;
            case 'next': {
                const last = state.rows.at(-1); if (!last || !state.hasNext) break;
                state.cursors[++state.page] = {created_at: last.created_at, id: last.id}; await loadList(); break;
            }
            case 'detail': case 'edit': case 'notes': case 'delete': case 'invoice': {
                const generation = state.generation, id = company().id, kind = state.view;
                button.disabled = true;
                const record = await repository.detail(kind, id, button.dataset.id);
                if (generation !== state.generation) return;
                if (action === 'detail') orderDetail(record);
                if (action === 'edit') editor(record);
                if (action === 'notes') notesDialog(record);
                if (action === 'delete') deleteDialog(record);
                if (action === 'invoice') {
                    const current = await repository.company(id);
                    if (generation === state.generation) openInvoice(record, current);
                }
                break;
            }
        }
    } catch (error) { showError(root, error.message); }
    finally { if (button.isConnected) button.disabled = false; }
});
async function resumeSession() {
    resetData();
    const generation = state.generation;
    root.innerHTML = workspaceLoader;
    try {
        const session = await auth.restore();
        if (generation !== state.generation) return;
        if (!session) login();
        else if (session.passwordSetup) passwordSetup();
        else await loadContext();
    } catch (error) {
        if (generation === state.generation) login(error.message);
    }
}
async function start() {
    try {
        auth = new Auth(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        repository = new Repository(auth);
        auth.onSignOut(() => { resetData(); login(); });
        await resumeSession();
    } catch (error) {
        authLayout(`<h1>Configuration required</h1>${errorBox}`);
        showError(root, error.message);
    }
}
// Email recovery/invite links can navigate an existing tab without a full reload.
window.addEventListener('hashchange', () => {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (auth && (hash.has('access_token') || hash.has('error') || hash.has('error_description'))) resumeSession();
});
// Renew active sessions without polling business tables. Revoked sessions clear the UI.
setInterval(() => {
    if (auth?.session && document.visibilityState === 'visible') auth.token().catch(error => showError(root, error.message));
}, 30000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth?.session) auth.token().catch(error => showError(root, error.message));
});
start();
