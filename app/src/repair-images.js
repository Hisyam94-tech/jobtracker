import {escapeHtml as e, icon} from './ui.js';

const BUCKET = 'jobtracker-repair-images';
const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp(`^${UUID}/${UUID}/[0-9a-f]{32}\\.(jpg|png|webp|gif)$`);
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export class RepairImages {
    constructor(auth, company) { this.auth = auth; this.company = company; }
    checkPath(path) {
        if (typeof path !== 'string' || !PATH.test(path) || !path.startsWith(this.company + '/')) throw new Error('Invalid company image reference.');
        return path;
    }
    async request(path, options) {
        const epoch = this.auth.epoch;
        const result = await this.auth.request('/storage/v1/object/' + path, {...options, token: await this.auth.token()});
        if (epoch !== this.auth.epoch) throw new Error('The session changed.');
        return result;
    }
    async upload(file, signal) {
        if (!TYPES[file.type] || file.size > MAX_SIZE || !file.size) throw new Error('Choose a JPG, PNG, WebP or GIF up to 5 MB.');
        const path = `${this.company}/${this.auth.session.user.id}/${randomId()}.${TYPES[file.type]}`;
        this.checkPath(path);
        await this.request(BUCKET + '/' + path, {method: 'POST', body: file, rawBody: true, signal,
            headers: {'Content-Type': file.type, 'x-upsert': 'false', 'cache-control': 'private, max-age=0'}});
        return {path, name: file.name, type: file.type, size: file.size};
    }
    async preview(reference, signal) {
        const blob = await this.request('authenticated/' + BUCKET + '/' + this.checkPath(reference?.path), {responseType: 'blob', signal});
        if (!TYPES[blob.type] || blob.size > MAX_SIZE) throw new Error('This image has an unsupported format or size.');
        return blob;
    }
}

export function mountRepairImages(container, dialog, service, initial = [], editable = true) {
    if (!Array.isArray(initial)) throw new Error('This order has invalid image data.');
    let entries = initial.map(reference => ({reference, preview: '', error: ''})), pending = false;
    const controller = new AbortController(), urls = new Set();
    const urlFor = blob => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
    container.innerHTML = `<div class="repair-image-heading"><h3>Device images</h3><span data-image-count></span></div>${editable ? `<label class="repair-image-upload">${icon('plus')}<strong>Add images</strong><span>JPG, PNG, WebP or GIF · Up to 5 images, 5 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple aria-label="Add device images"></label>` : ''}<p class="image-error" role="alert" hidden></p><div class="repair-image-grid"></div>`;
    const grid = container.querySelector('.repair-image-grid'), input = container.querySelector('input');
    const errorBox = container.querySelector('.image-error');
    function error(text) { errorBox.textContent = text; errorBox.hidden = !text; }
    function render() {
        container.querySelector('[data-image-count]').textContent = `${entries.length} / 5`;
        grid.innerHTML = entries.map((entry, index) => `<figure>${entry.preview ? `<a href="${e(entry.preview)}" target="_blank" rel="noopener" aria-label="Open image ${index + 1}"><img src="${e(entry.preview)}" alt="${e(entry.reference?.name || entry.file?.name || 'Device image ' + (index + 1))}"></a>` : `<p>${e(entry.error || 'Loading image...')}</p>`}${editable ? `<button type="button" data-remove-image="${index}" aria-label="Remove image ${index + 1}">${icon('close')}</button>` : ''}</figure>`).join('');
    }
    grid.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-image]');
        if (!button || pending) return;
        const [entry] = entries.splice(Number(button.dataset.removeImage), 1);
        if (entry.preview) { URL.revokeObjectURL(entry.preview); urls.delete(entry.preview); }
        error(''); render();
    });
    if (input) input.addEventListener('change', async () => {
        const files = Array.from(input.files); input.value = ''; error('');
        if (files.length + entries.length > 5) { error('You can add up to 5 images per repair.'); return; }
        if (files.some(file => !TYPES[file.type] || !file.size || file.size > MAX_SIZE)) { error('Choose JPG, PNG, WebP or GIF images up to 5 MB each.'); return; }
        pending = true; input.disabled = true;
        const additions = [], stagedURLs = [];
        try {
            for (const file of files) {
                if (!dialog.open) return;
                const preview = urlFor(file), image = new Image(); image.src = preview;
                stagedURLs.push(preview);
                await image.decode();
                if (image.naturalWidth * image.naturalHeight > 25000000) throw new Error('Choose images up to 25 megapixels.');
                additions.push({file, preview});
            }
            if (!dialog.open) return;
            entries.push(...additions); render();
        } catch (failure) {
            stagedURLs.forEach(url => { URL.revokeObjectURL(url); urls.delete(url); });
            error(failure.message.startsWith('Choose') ? failure.message : 'One of the files could not be read as an image.');
        }
        finally { pending = false; input.disabled = false; }
    });
    render();
    for (const entry of entries) {
        service.preview(entry.reference, controller.signal).then(blob => {
            if (!dialog.open || !entries.includes(entry)) return;
            entry.preview = urlFor(blob); render();
        }).catch(failure => { if (dialog.open && entries.includes(entry)) { entry.error = 'Image unavailable: ' + failure.message; render(); } });
    }
    dialog.addEventListener('close', () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); }, {once: true});
    return {
        async save() {
            if (pending) throw new Error('Please wait for the images to finish processing.');
            pending = true;
            try {
                for (const entry of entries) {
                    if (!dialog.open) throw new Error('The repair form was closed.');
                    // Keep successful uploads for a retry if saving the repair conflicts.
                    if (!entry.reference) entry.reference = await service.upload(entry.file, controller.signal);
                }
                if (!dialog.open) throw new Error('The repair form was closed.');
                return entries.map(entry => entry.reference);
            } finally { pending = false; }
        }
    };
}
