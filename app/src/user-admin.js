import {escapeHtml as e, field, icon, submitForm} from './ui.js';

function requestId() {
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function mountUserAdmin(container, repository) {
    const lifecycle=new AbortController();
    let disposed=false, companyRequest, version=0, page=0, cursors=[null], companies=[], hasNext=false;
    let submittedPayload='', id;
    async function start() {
        try {
            const allowed=await repository.isUserAdmin(lifecycle.signal);
            if (disposed || allowed !== true) return;
            container.innerHTML=`<section class="user-admin" aria-labelledby="user-admin-heading"><div class="settings-divider"></div><div class="user-admin-heading"><span class="settings-icon">${icon('shield')}</span><div><h3 id="user-admin-heading">Add users</h3><p>Available only to the admin account. Add a user to any active company.</p></div></div><form><p class="error" data-error role="alert" hidden></p><p class="notice" data-notice role="status" hidden></p><fieldset><div class="form-grid">${field('Full name','display_name','',{required:true,max:100,autocomplete:'off'})}<label class="field"><span>Username</span><input name="username" aria-label="Username" aria-describedby="user-admin-username-help" required minlength="3" maxlength="32" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. nadia.hamid"><small id="user-admin-username-help">Unique across all companies. 3–32 letters, numbers, dots, hyphens or underscores.</small></label>${field('Email address','email','',{type:'email',required:true,max:254,autocomplete:'off'})}<label class="field"><span>Company role</span><select name="role" aria-label="Company role"><option value="staff">Staff</option><option value="admin">Company admin</option></select></label><div class="field wide"><label for="invite-company">Company</label><select id="invite-company" name="company_id" required disabled><option value="">Loading companies...</option></select><p class="user-admin-company-error" role="alert" hidden></p><div class="user-admin-paging"><button type="button" class="text-button" data-company-page="previous" disabled>Previous companies</button><span data-company-count></span><button type="button" class="text-button" data-company-page="next" disabled>Next companies</button></div></div></div><p class="user-admin-note">An invitation email lets the user set their password. Company admins cannot add users.</p><button class="primary" type="submit" disabled>${icon('plus')}Create user &amp; send invitation</button></fieldset></form></section>`;
            const form=container.querySelector('form');
            container.querySelector('[data-company-page=previous]').onclick=()=>{ if (page) {page--;loadCompanies();} };
            container.querySelector('[data-company-page=next]').onclick=()=>{
                if (hasNext && companies.length) { cursors[++page]=companies.at(-1).id; loadCompanies(); }
            };
            form.onsubmit=event=>{
                event.preventDefault();
                const values=Object.fromEntries(new FormData(form));
                const payload={username:values.username.trim().toLowerCase(),display_name:values.display_name.trim(),email:values.email.trim().toLowerCase(),company_id:values.company_id,role:values.role};
                const key=JSON.stringify(payload);
                if (!id || key!==submittedPayload) { id=requestId(); submittedPayload=key; }
                container.querySelector('[data-notice]').hidden=true;
                submitForm(form,async()=>{
                    if (!payload.display_name || payload.username==='admin' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(payload.username)) throw new Error('Enter a name and a unique username other than admin.');
                    const result=await repository.addUser({...payload,request_id:id},lifecycle.signal);
                    if (disposed) return;
                    const notice=container.querySelector('[data-notice]');
                    notice.textContent=`${result.username}: ${result.message}`; notice.hidden=false;
                    form.reset(); id=null; submittedPayload='';
                });
            };
            await loadCompanies();
        } catch (error) {
            if (!disposed) container.innerHTML=`<p class="access-note" role="status">User management unavailable: ${e(error.message)}</p>`;
        }
    }
    async function loadCompanies() {
        companyRequest?.abort(); companyRequest=new AbortController();
        const current=++version;
        const select=container.querySelector('[name=company_id]'), submit=container.querySelector('[type=submit]');
        const previous=container.querySelector('[data-company-page=previous]'), next=container.querySelector('[data-company-page=next]');
        const errorBox=container.querySelector('.user-admin-company-error');
        select.disabled=true; submit.disabled=true; previous.disabled=true; next.disabled=true; errorBox.hidden=true;
        select.innerHTML='<option value="">Loading companies...</option>';
        try {
            const result=await repository.adminCompanies(cursors[page],companyRequest.signal);
            if (disposed || current!==version) return;
            companies=result.rows; hasNext=result.hasNext;
            select.innerHTML=`<option value="">${companies.length?'Choose a company':'No active companies'}</option>`+companies.map(row=>`<option value="${e(row.id)}">${e(row.name)}</option>`).join('');
            select.disabled=!companies.length; submit.disabled=!companies.length;
            previous.disabled=page===0; next.disabled=!hasNext;
            container.querySelector('[data-company-count]').textContent=`Page ${page+1}`;
        } catch (error) {
            if (disposed || current!==version) return;
            select.innerHTML='<option value="">Companies unavailable</option>';
            errorBox.textContent=error.message; errorBox.hidden=false;
            previous.disabled=page===0;
        }
    }
    start();
    return ()=>{disposed=true;version++;lifecycle.abort();companyRequest?.abort();};
}
