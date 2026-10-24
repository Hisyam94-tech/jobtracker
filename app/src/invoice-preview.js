/* In-page invoice preview. PDF generation and sharing stay on this device. */
window.InvoicePreview = (() => {
    let activeDialog = null;
    const pdfLibrary = new URL('./vendor/html2pdf-0.12.1.bundle.min.js', document.baseURI).href;

    function open(html, filename) {
        if (activeDialog) activeDialog.close();
        const previousFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'invoice-preview';
        dialog.setAttribute('aria-labelledby', 'invoice-preview-title');
        dialog.innerHTML = `<div class="invoice-toolbar">
            <h2 id="invoice-preview-title">Invoice preview</h2>
            <div class="invoice-actions">
                <button type="button" data-action="share" aria-label="Share PDF" title="Share PDF" disabled>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>
                </button>
                <button type="button" data-action="print" aria-label="Print" title="Print" disabled>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6zM18 12h.01"/></svg>
                </button>
                <button type="button" data-action="close" aria-label="Close" title="Close" autofocus>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg>
                </button>
            </div>
        </div><p class="invoice-message" role="status" aria-live="polite"></p>
        <iframe title="Repair invoice" sandbox="allow-same-origin allow-scripts allow-modals"></iframe>`;
        const frame = dialog.querySelector('iframe');
        const share = dialog.querySelector('[data-action="share"]');
        const print = dialog.querySelector('[data-action="print"]');
        const message = dialog.querySelector('.invoice-message');
        let pdfFile = null;
        let disposed = false;
        const canShareFiles = window.isSecureContext && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
        message.textContent = canShareFiles ? 'Preparing PDF…' : 'PDF sharing is unavailable in this browser. Sharing requires HTTPS and a browser that supports file sharing.';
        dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
        dialog.addEventListener('close', () => {
            disposed = true;
            pdfFile = null;
            dialog.remove();
            if (activeDialog === dialog) activeDialog = null;
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        }, { once: true });
        print.onclick = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
        };
        share.onclick = async () => {
            if (!pdfFile) return;
            share.disabled = true;
            try {
                // Invoke directly from the click, preserving user activation on mobile.
                await navigator.share({ files: [pdfFile], title: 'Repair invoice' });
                if (!disposed) message.textContent = 'Invoice passed to the share menu.';
            } catch (error) {
                if (!disposed) message.textContent = error.name === 'AbortError' ? 'Sharing cancelled.' : 'Unable to share this invoice. Please try again.';
            } finally {
                if (!disposed) share.disabled = false;
            }
        };
        frame.addEventListener('load', async () => {
            try {
                const doc = frame.contentDocument;
                await doc.fonts.ready;
                await Promise.all(Array.from(doc.images, image => image.decode()));
                if (disposed) return;
                print.disabled = false;
                if (!canShareFiles) return;
                await new Promise((resolve, reject) => {
                    const script = doc.createElement('script');
                    script.src = pdfLibrary;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('PDF library failed to load'));
                    doc.head.appendChild(script);
                });
                if (disposed) return;
                const blob = await frame.contentWindow.html2pdf().set({
                    margin: 10,
                    image: { type: 'jpeg', quality: 0.95 },
                    html2canvas: { scale: 1.5, windowWidth: 800, useCORS: true },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.info-box', '.grand-total', 'img'] }
                }).from(doc.querySelector('.page')).outputPdf('blob');
                if (disposed) return;
                pdfFile = new File([blob], filename, { type: 'application/pdf' });
                if (navigator.canShare({ files: [pdfFile] })) {
                    share.disabled = false;
                    message.textContent = 'PDF ready to share.';
                } else {
                    pdfFile = null;
                    message.textContent = 'This browser cannot share PDF files.';
                }
            } catch (error) {
                if (!disposed) message.textContent = 'Unable to prepare the invoice for sharing. Close and reopen the preview to try again.';
            }
        }, { once: true });
        frame.srcdoc = html;
        document.body.appendChild(dialog);
        activeDialog = dialog;
        dialog.showModal();
    }
    return { open };
})();
