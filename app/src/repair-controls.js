import {escapeHtml as e} from './ui.js';

// Requests begin only after typing; each field owns its timer and cancellation.
export function attachRepairSuggestions(dialog, repository, company) {
    const form = dialog.querySelector('form');
    for (const name of ['customer_name', 'phone', 'device']) {
        const input = form.elements[name], label = input.closest('.field');
        const wrapper = document.createElement('div');
        wrapper.className = 'repair-lookup';
        label.before(wrapper); wrapper.append(label);
        const panel = document.createElement('div');
        panel.className = 'repair-suggestions'; panel.id = 'repair-suggestions-' + name;
        panel.hidden = true; panel.setAttribute('role', 'listbox');
        panel.setAttribute('aria-label', label.textContent.trim() + ' suggestions');
        wrapper.append(panel);
        input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', panel.id); input.setAttribute('aria-expanded', 'false');
        input.autocomplete = 'off';
        input.placeholder = name === 'phone' ? 'Search or enter phone' : name === 'device' ? 'Search or enter device' : 'Search or enter customer';
        let timer, controller, version = 0, rows = [], active = -1;
        function close() { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
        function stop() { clearTimeout(timer); controller?.abort(); version++; }
        function message(text) { panel.innerHTML = `<p role="status">${e(text)}</p>`; }
        function choose(index) {
            const row = rows[index];
            if (!row) return;
            input.value = row[name];
            if (name !== 'device') {
                form.elements.customer_name.value = row.customer_name;
                form.elements.phone.value = row.phone;
                form.elements.email.value = row.email || '';
            }
            stop(); close(); input.focus();
        }
        function search() {
            stop(); rows = []; active = -1; input.removeAttribute('aria-activedescendant');
            const term = input.value.trim(), current = version;
            panel.hidden = false; input.setAttribute('aria-expanded', 'true');
            if (term.length < 2) { message('Type at least 2 characters to search, or enter a new value.'); return; }
            message('Searching...');
            timer = setTimeout(async () => {
                controller = new AbortController();
                try {
                    const found = await repository.repairSuggestions(company, name, term, controller.signal);
                    if (version !== current || !dialog.open) return;
                    const seen = new Set();
                    rows = found.filter(row => {
                        const key = name === 'device' ? row.device : JSON.stringify([row.customer_name, row.phone, row.email]);
                        if (seen.has(key)) return false;
                        seen.add(key); return true;
                    });
                    panel.innerHTML = rows.map((row, index) => `<div role="option" aria-selected="false" id="${panel.id}-${index}" data-option="${index}"><strong>${e(row[name])}</strong>${name !== 'device' ? `<small>${e(name === 'phone' ? row.customer_name : row.phone)}${row.email ? ' · ' + e(row.email) : ''}</small>` : ''}</div>`).join('') + '<p role="status">You can also keep your typed value. Up to 20 matches.</p>';
                    if (!rows.length) message('No matches. Your typed value will be used.');
                } catch (error) {
                    if (version === current && dialog.open) message('Search unavailable: ' + error.message);
                }
            }, 300);
        }
        input.addEventListener('input', search);
        input.addEventListener('focus', () => { if (panel.hidden) search(); });
        // Keep focus on the combobox, including when tapping a result on mobile.
        panel.addEventListener('pointerdown', event => event.preventDefault());
        panel.addEventListener('click', event => { const option = event.target.closest('[data-option]'); if (option) choose(Number(option.dataset.option)); });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); stop(); close(); }
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                if (panel.hidden) { search(); return; }
                if (!rows.length) return;
                active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
                panel.querySelectorAll('[data-option]').forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
                const option = panel.querySelector(`[data-option="${active}"]`);
                input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({block: 'nearest'});
            }
            if (event.key === 'Enter' && !panel.hidden && active >= 0) { event.preventDefault(); choose(active); }
        });
        input.addEventListener('blur', () => { stop(); close(); });
        dialog.addEventListener('close', stop, {once: true});
    }
}
