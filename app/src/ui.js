export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const money = value => new Intl.NumberFormat('en-MY', {style: 'currency', currency: 'MYR'}).format(Number(value));
export const statusLabel = value => ({'in-progress': 'In progress', completed: 'Completed', 'Pending-Payment': 'Pending payment', cancelled: 'Cancelled'}[value] || value);
export const icons = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M12 15h2M7 18h2"/>',
    home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/>',
    revenue: '<path d="M3 21h18M5 17v-5h3v5zm6 0V8h3v9zm6 0V3h3v14z"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    orders: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
    parts: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    settings: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    logout: '<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 2M4 17l2 2a8 8 0 0 0 13-2"/>'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || ''}</svg>`;
export const iconButton = (action, name, label, extra = '') => `<button type="button" class="icon-button" data-action="${action}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${extra}>${icon(name)}</button>`;
export function field(label, name, value = '', {type = 'text', required = false, max, min, step, autocomplete, wide = false} = {}) {
    return `<label class="field ${wide ? 'wide' : ''}"><span>${escapeHtml(label)}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${max !== undefined ? (type === 'number' ? 'max' : 'maxlength') + '="' + max + '"' : ''} ${min !== undefined ? (type === 'password' ? 'minlength' : 'min') + '="' + min + '"' : ''} ${step ? 'step="' + step + '"' : ''} ${autocomplete ? 'autocomplete="' + autocomplete + '"' : ''}></label>`;
}
export function showError(container, message) {
    const target = container.querySelector('[data-error]');
    if (target) { target.textContent = message; target.hidden = !message; }
}
export function modal(title, content) {
    const dialog = document.createElement('dialog');
    dialog.className = 'form-dialog';
    dialog.innerHTML = `<header><h2 id="dialog-title">${escapeHtml(title)}</h2>${iconButton('close', 'close', 'Close')}</header><div class="dialog-body">${content}</div>`;
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    const focus = document.activeElement;
    dialog.querySelector('[data-action=close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); if (focus?.isConnected) focus.focus(); }, {once: true});
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
export async function submitForm(form, task) {
    const fieldset = form.querySelector('fieldset');
    const submit = form.querySelector('[type=submit]');
    if (submit?.disabled) return;
    const label = submit?.textContent;
    showError(form, '');
    if (fieldset) fieldset.disabled = true;
    if (submit) { submit.disabled = true; submit.textContent = 'Please wait...'; }
    form.setAttribute('aria-busy', 'true');
    try { await task(); }
    catch (error) { if (form.isConnected) showError(form, error.message); }
    finally {
        if (fieldset) fieldset.disabled = false;
        if (submit) { submit.disabled = false; submit.textContent = label; }
        form.removeAttribute('aria-busy');
    }
}
