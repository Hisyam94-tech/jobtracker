const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY = 'The invitation could not be completed. Retry with the same details; the username remains reserved.';
async function readBody(request) {
    if (!request.body) throw new Error('Missing body');
    const reader = request.body.getReader(), chunks = []; let size = 0;
    try {
        while (true) {
            const {done,value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 8192) { await reader.cancel(); throw new Error('Too large'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
}
export function createAddUserHandler({url,publicKey,serviceKey,allowedOrigins=[],redirectUrl}, fetcher=fetch) {
    return async request => {
        const origin = request.headers.get('origin');
        const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
        const reply = (status,body) => new Response(body === null ? null : JSON.stringify(body), {status,headers});
        if (!origin || !allowedOrigins.includes(origin)) return reply(403,{message:'This app origin is not allowed.'});
        Object.assign(headers, {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'apikey, authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'});
        if (request.method === 'OPTIONS') return reply(204,null);
        if (request.method !== 'POST') return reply(405,{message:'Use POST.'});
        try {
            const redirect = new URL(redirectUrl);
            if (!url?.startsWith('https://') || !publicKey || !serviceKey || !allowedOrigins.includes(redirect.origin) ||
                !['http:','https:'].includes(redirect.protocol) || redirect.username || redirect.password || redirect.search || redirect.hash || !redirect.pathname.endsWith('/app/')) throw new Error();
        } catch { return reply(503,{message:'User invitations are not configured.'}); }
        const authorization = request.headers.get('authorization');
        if (!/^Bearer \S+$/i.test(authorization || '')) return reply(401,{message:'Sign in to continue.'});
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415,{message:'Send JSON.'});
        let body;
        try { body = await readBody(request); } catch { return reply(400,{message:'Invalid request.'}); }
        if (!body || Object.keys(body).sort().join(',') !== 'company_id,display_name,email,request_id,role,username') return reply(400,{message:'Invalid request fields.'});
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
        if (!UUID.test(body.request_id) || !UUID.test(body.company_id) || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || username === 'admin' ||
            !name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['staff','admin'].includes(body.role)) return reply(400,{message:'Check the username, name, email, company and role.'});
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(),22000);
        const abort = () => controller.abort(); request.signal.addEventListener('abort',abort,{once:true});
        if (request.signal.aborted) controller.abort();
        let reservation, actor, released = false;
        const serviceHeaders = {apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'};
        const rpc = async (name,values,signal=controller.signal) => {
            const response = await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:serviceHeaders,body:JSON.stringify(values),signal});
            const value = await response.json();
            if (!response.ok) { const error = new Error('Request failed'); error.code=value?.code; throw error; }
            return value;
        };
        try {
            // Validate the actual bearer session with Auth. Never use caller IDs,
            // company roles, decoded JWT claims or editable user_metadata as proof.
            const verified = await fetcher(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:authorization},signal:controller.signal});
            if (!verified.ok) return reply(verified.status >= 500 ? 503 : 401,{message:'Unable to verify your session.'});
            actor = (await verified.json())?.id;
            if (!UUID.test(actor || '')) return reply(401,{message:'Unable to verify your session.'});
            reservation = await rpc('jobtracker_prepare_user_invite',{actor_id:actor,wanted_request_id:body.request_id,wanted_username:username,
                wanted_email:email,wanted_name:name,wanted_company:body.company_id,wanted_role:body.role});
            if (!UUID.test(reservation?.request_id || '')) throw new Error('Invalid reservation');
            if (reservation.completed === true) return reply(200,{message:'This user was already added. No new invitation was sent.',username});
            if (!UUID.test(reservation.lease_token || '')) throw new Error('Invalid lease');
            let id = reservation.user_id;
            if (!id) {
                const created = await fetcher(url+'/auth/v1/admin/users',{method:'POST',headers:serviceHeaders,signal:controller.signal,
                    body:JSON.stringify({email,email_confirm:false,app_metadata:{jobtracker_request_id:reservation.request_id}})});
                if (!created.ok) return reply(created.status === 429 ? 429 : 503,{message:RETRY});
                id = (await created.json())?.id;
            }
            if (!UUID.test(id || '')) throw new Error('Invalid account');
            await rpc('jobtracker_finish_user_invite',{actor_id:actor,target_request:reservation.request_id,token:reservation.lease_token,account_id:id});
            // The app transaction has committed before any invitation email call.
            if (!reservation.confirmed) {
                const invited = await fetcher(url+'/auth/v1/invite?redirect_to='+encodeURIComponent(redirectUrl),{method:'POST',headers:serviceHeaders,
                    signal:controller.signal,body:JSON.stringify({email})});
                if (!invited.ok) return reply(invited.status === 429 ? 429 : 503,{message:'The user was created, but invitation delivery was not confirmed. Retry with the same details.'});
                const result = await invited.json();
                if (result?.id !== id) throw new Error('Invitation account mismatch');
            }
            await rpc('jobtracker_release_user_invite',{actor_id:actor,target_request:reservation.request_id,token:reservation.lease_token,email_sent:true});
            released = true;
            return reply(200,{username,message:reservation.confirmed ? 'The user is created and their account is already active.' : 'User created. Invitation sent so they can set their password.'});
        } catch (error) {
            if (error.code === '42501') return reply(403,{message:'Only the admin account can add users.'});
            if (error.code === '23505') return reply(409,{message:'Username or email is already used or reserved. To retry an invitation, keep its original details.'});
            if (error.code === '55P03') return reply(409,{message:'This invitation is processing. Wait 45 seconds before retrying with the same details.'});
            if (error.code === '54000') return reply(429,{message:'Wait one minute before adding more users.'});
            if (error.code === '22023') return reply(400,{message:'Account details or company are no longer valid. Check the setup.'});
            return reply(503,{message:reservation ? RETRY : 'User management is unavailable. Check the server setup.'});
        } finally {
            clearTimeout(timer); request.signal.removeEventListener('abort',abort);
            if (actor && UUID.test(reservation?.lease_token || '') && !released) {
                // Best-effort lease release; an interrupted cleanup expires after
                // 45 seconds. Never delete an account or release its username.
                const cleanup = new AbortController(), cleanupTimer=setTimeout(()=>cleanup.abort(),2000);
                try { await rpc('jobtracker_release_user_invite',{actor_id:actor,target_request:reservation.request_id,token:reservation.lease_token,email_sent:false},cleanup.signal); }
                catch { /* The recorded lease expiry is the recovery mechanism. */ }
                finally { clearTimeout(cleanupTimer); }
            }
        }
    };
}
