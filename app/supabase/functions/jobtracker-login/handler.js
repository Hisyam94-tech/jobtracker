// No dependencies; injected fetch allows offline testing of the actual handler.
const INVALID = 'Unable to sign in. Check your username and password, or wait five minutes before trying again.';
const UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again later.';

async function readBody(request) {
    if (!request.body) throw new Error('Missing body');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 8192) { await reader.cancel(); throw new Error('Body too large'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
}

export function createLoginHandler({url, publicKey, serviceKey, allowedOrigins = []}, fetcher = fetch) {
    const origins = new Set(allowedOrigins);
    return async request => {
        const origin = request.headers.get('origin');
        const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
            'X-Content-Type-Options': 'nosniff'};
        const reply = (status, value) => new Response(value === null ? null : JSON.stringify(value), {status, headers});
        if (!origin || !origins.has(origin)) return reply(403, {message: 'This app origin is not allowed.'});
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'apikey, content-type';
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        if (request.method === 'OPTIONS') return reply(204, null);
        if (request.method !== 'POST') return reply(405, {message: 'Use POST to sign in.'});
        if (!url || !publicKey || !serviceKey || !url.startsWith('https://')) return reply(503, {message: UNAVAILABLE});
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
            return reply(415, {message: 'Send a JSON sign-in request.'});
        }
        let body;
        try { body = await readBody(request); }
        catch { return reply(400, {message: 'Invalid sign-in request.'}); }
        const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = body?.password;
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || typeof password !== 'string' || !password.length || password.length > 1024) {
            return reply(401, {message: INVALID});
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const resolved = await fetcher(url + '/rest/v1/rpc/jobtracker_resolve_login', {
                method: 'POST', signal: controller.signal,
                headers: {apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json'},
                body: JSON.stringify({login_username: username})
            });
            if (!resolved.ok) return reply(503, {message: UNAVAILABLE});
            const account = await resolved.json();
            if (!account) return reply(401, {message: INVALID});
            if (typeof account.email !== 'string' || typeof account.user_id !== 'string') return reply(503, {message: UNAVAILABLE});
            // Only Auth verifies passwords. Never create a user or generate an
            // admin session here. Never forward caller-supplied IP/Auth headers.
            const response = await fetcher(url + '/auth/v1/token?grant_type=password', {
                method: 'POST', signal: controller.signal,
                headers: {apikey: publicKey, 'Content-Type': 'application/json'},
                body: JSON.stringify({email: account.email, password})
            });
            if (response.status === 429) return reply(429, {message: 'Too many sign-in attempts. Please try again later.'});
            if (response.status >= 500) return reply(503, {message: UNAVAILABLE});
            if (!response.ok) return reply(401, {message: INVALID});
            const session = await response.json();
            // Protect against email reassignment between lookup and password check.
            if (session.user?.id !== account.user_id) return reply(401, {message: INVALID});
            if (!session.access_token || !session.refresh_token || !(Number(session.expires_in) > 0)) return reply(503, {message: UNAVAILABLE});
            return reply(200, {access_token: session.access_token, refresh_token: session.refresh_token,
                token_type: session.token_type, expires_in: session.expires_in, expires_at: session.expires_at, user: session.user});
        } catch {
            // Do not return/log upstream errors, identifiers, credentials or keys.
            return reply(503, {message: UNAVAILABLE});
        } finally { clearTimeout(timer); }
    };
}
