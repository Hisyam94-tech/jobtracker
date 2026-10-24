// Supabase Auth HTTP API. Credentials never enter application tables.
export class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
export class Auth {
    constructor(url, key) {
        if (!url || !key) throw new Error('Configure the Supabase project URL and public key in gh-pages-config.js.');
        const endpoint = new URL(url);
        if (endpoint.protocol !== 'https:') throw new Error('The Supabase endpoint must use HTTPS.');
        if (key.startsWith('sb_secret_')) throw new Error('Use a public Supabase key, never a secret key.');
        if (key.startsWith('ey')) {
            const claims = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (claims.role !== 'anon') throw new Error('Use the Supabase anon/public key.');
        }
        this.url = endpoint.origin;
        this.key = key;
        this.storageKey = 'jobtracker-session:' + endpoint.hostname;
        this.session = null;
        this.refreshing = null;
        this.epoch = 0;
        this.listeners = new Set();
    }
    async request(path, {method = 'GET', body, token, headers = {}, signal, returnCount = false, rawBody = false, responseType = 'json', timeoutMs = 12000} = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const abort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        signal?.addEventListener('abort', abort, {once: true});
        try {
            const response = await fetch(this.url + path, {
                method, signal: controller.signal, cache: 'no-store',
                headers: {apikey: this.key, ...(token ? {Authorization: 'Bearer ' + token} : {}),
                    ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers},
                ...(body !== undefined ? {body: rawBody ? body : JSON.stringify(body)} : {})
            });
            if (response.ok && responseType === 'blob') return await response.blob();
            const text = await response.text();
            let value = null;
            if (text) {
                try { value = JSON.parse(text); }
                catch { throw new ApiError('The server returned an unexpected response.', response.status); }
            }
            if (!response.ok) throw new ApiError(value?.msg || value?.message || value?.error_description || 'The request could not be completed.', response.status, value?.code || value?.error_code);
            if (returnCount) {
                const count = response.headers.get('Content-Range')?.split('/')[1];
                if (!count || !/^\d+$/.test(count)) throw new ApiError('The server did not return a record count.', response.status);
                return Number(count);
            }
            return value;
        } catch (error) {
            if (error.name === 'AbortError') throw new ApiError(signal?.aborted ? 'Request cancelled.' : 'The request timed out. Please try again.', 0, 'aborted');
            if (error instanceof TypeError) throw new ApiError('Cannot reach the server. Check your connection and project URL.', 0, 'network');
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
    save(value) {
        if (!value?.access_token || !value?.refresh_token || !value?.user?.id) throw new Error('The server returned an incomplete session.');
        const expires = Number(value.expires_at || (Date.now() / 1000 + Number(value.expires_in)));
        if (!Number.isFinite(expires)) throw new Error('The server returned an invalid session expiry.');
        const session = {access_token: value.access_token, refresh_token: value.refresh_token, expires_at: expires, user: value.user, passwordSetup: Boolean(value.passwordSetup)};
        sessionStorage.setItem(this.storageKey, JSON.stringify(session));
        this.session = session;
        return session;
    }
    clear() {
        this.epoch++;
        this.session = null;
        sessionStorage.removeItem(this.storageKey);
        this.listeners.forEach(listener => listener());
    }
    onSignOut(listener) { this.listeners.add(listener); }
    async signIn(username, password) {
        username = String(username).trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new ApiError('Enter a username of 3-32 letters, numbers, dots, underscores or hyphens.', 400);
        const epoch = ++this.epoch;
        const value = await this.request('/functions/v1/jobtracker-login', {method: 'POST', body: {username, password}});
        if (epoch !== this.epoch) throw new ApiError('The session changed. Please sign in again.', 401);
        return this.save(value);
    }
    async restore() {
        const hash = new URLSearchParams(location.hash.slice(1));
        if (hash.has('access_token') || hash.has('error') || hash.has('error_description')) {
            // A link may arrive in this already-open tab. Invalidate any older session.
            history.replaceState(null, '', location.pathname + location.search);
            const epoch = ++this.epoch;
            this.session = null;
            sessionStorage.removeItem(this.storageKey);
            if (hash.has('error') || hash.has('error_description')) throw new Error(hash.get('error_description') || 'The sign-in link is invalid or expired.');
            const token = hash.get('access_token');
            const refresh = hash.get('refresh_token');
            const expires = Number(hash.get('expires_in'));
            if (!token || !refresh || !Number.isFinite(expires) || expires <= 0) throw new Error('The sign-in link is incomplete. Request a new link.');
            const user = await this.request('/auth/v1/user', {token});
            if (epoch !== this.epoch) throw new ApiError('The session changed.', 401);
            return this.save({access_token: token, refresh_token: refresh, expires_in: expires, user,
                passwordSetup: ['recovery', 'invite'].includes(hash.get('type'))});
        }
        const stored = sessionStorage.getItem(this.storageKey);
        if (!stored) return null;
        try { this.session = JSON.parse(stored); }
        catch { this.clear(); throw new Error('The saved session is invalid. Please sign in again.'); }
        if (!this.session?.access_token || !this.session?.refresh_token || !this.session?.user?.id || !Number.isFinite(this.session.expires_at)) {
            this.clear(); throw new Error('The saved session is invalid. Please sign in again.');
        }
        const token = await this.token();
        try {
            const user = await this.request('/auth/v1/user', {token});
            return this.save({...this.session, user});
        } catch (error) {
            if (error.status === 401 || error.status === 403) this.clear();
            throw error;
        }
    }
    async token() {
        if (!this.session) throw new ApiError('Please sign in to continue.', 401);
        if (this.session.expires_at > Date.now() / 1000 + 60) return this.session.access_token;
        if (!this.refreshing) {
            const epoch = this.epoch;
            const current = this.session;
            this.refreshing = this.request('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: current.refresh_token}})
                .then(value => {
                    if (epoch !== this.epoch) throw new ApiError('Session changed. Please sign in again.', 401);
                    return this.save({...value, passwordSetup: current.passwordSetup}).access_token;
                }).catch(error => {
                    if (epoch === this.epoch && [400, 401, 403].includes(error.status)) this.clear();
                    throw error;
                }).finally(() => { this.refreshing = null; });
        }
        return this.refreshing;
    }
    async resetPassword(email) {
        const redirect = new URL('./', location.href).href;
        await this.request('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect), {method: 'POST', body: {email}});
    }
    async setPassword(password) {
        const user = await this.request('/auth/v1/user', {method: 'PUT', token: await this.token(), body: {password}});
        this.save({...this.session, user, passwordSetup: false});
    }
    async signOut() {
        const token = await this.token();
        try { await this.request('/auth/v1/logout?scope=local', {method: 'POST', token}); }
        catch (error) { if (![401, 403, 404].includes(error.status)) throw error; }
        this.clear();
    }
}
