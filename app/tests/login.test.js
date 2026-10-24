import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoginHandler} from '../supabase/functions/jobtracker-login/handler.js';
import {Auth} from '../src/auth.js';

// All requests are injected, never sent to Supabase or a live database.
globalThis.fetch = () => { throw new Error('Unexpected real network request'); };
const config = {url: 'https://auth.example.test', publicKey: 'public-test', serviceKey: 'server-secret-test', allowedOrigins: ['http://localhost:8003']};
const account = {user_id: 'user-uuid', email: 'private@example.test'};
const session = {access_token: 'user-access', refresh_token: 'user-refresh', expires_in: 3600, user: {id: account.user_id, email: account.email}};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
const request = (body = {username: ' Test.Owner ', password: ' secret password '}, extra = {}) => new Request('https://auth.example.test/functions/v1/jobtracker-login', {
    method: 'POST', headers: {origin: config.allowedOrigins[0], 'content-type': 'application/json'}, body: JSON.stringify(body), ...extra
});

test('username resolves privately and the original password is verified only by Auth', async () => {
    const calls = [];
    const handler = createLoginHandler(config, async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(url);
        if (calls.length === 1) {
            assert.equal(url, config.url + '/rest/v1/rpc/jobtracker_resolve_login');
            assert.deepEqual(body, {login_username: 'test.owner'});
            assert.equal(options.headers.Authorization, 'Bearer ' + config.serviceKey);
            return json(account);
        }
        assert.equal(url, config.url + '/auth/v1/token?grant_type=password');
        assert.deepEqual(body, {email: account.email, password: ' secret password '});
        assert.equal(options.headers.apikey, config.publicKey);
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers['x-forwarded-for'], undefined);
        return json(session);
    });
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), config.allowedOrigins[0]);
    const value = await response.json();
    assert.equal(value.user.id, account.user_id);
    assert.equal(value.access_token, session.access_token);
    assert.ok(!JSON.stringify(value).includes(config.serviceKey));
    assert.equal(calls.length, 2);
});

test('unknown or throttled username and incorrect password have the same public error', async () => {
    const unknown = await createLoginHandler(config, async () => json(null))(request());
    let calls = 0;
    const incorrect = await createLoginHandler(config, async () => ++calls === 1 ? json(account) : json({message: account.email + ' incorrect password'}, 400))(request());
    assert.equal(unknown.status, 401);
    assert.equal(incorrect.status, 401);
    assert.equal(await unknown.text(), await incorrect.text());
    assert.equal(calls, 2);
});

test('unknown username does not attempt authentication or fabricate an email', async () => {
    let calls = 0;
    const response = await createLoginHandler(config, async url => {
        calls++;
        assert.ok(url.endsWith('/jobtracker_resolve_login'));
        return json(null);
    })(request());
    assert.equal(response.status, 401);
    assert.equal(calls, 1);
});

test('disallowed origin, malformed input and oversized bodies never reach the backend', async () => {
    const handler = createLoginHandler(config, () => { throw new Error('Backend must not be called'); });
    assert.equal((await handler(request({}, {headers: {origin: 'https://evil.example'}}))).status, 403);
    assert.equal((await handler(request({}, {headers: {}}))).status, 403);
    assert.equal((await handler(request({}, {method: 'GET', body: undefined}))).status, 405);
    assert.equal((await handler(request({}, {body: '{broken'}))).status, 400);
    assert.equal((await handler(request({username: 'x'.repeat(9000), password: 'secret'}))).status, 400);
    for (const username of ['a', 'email@example.test', 'a),x.eq.y', '\u0130name', ' spaced name ']) {
        assert.equal((await handler(request({username, password: 'secret'}))).status, 401);
    }
    assert.equal((await handler(request({username: 'owner', password: 'x'.repeat(1025)}))).status, 401);
});

test('preflight needs no session and is restricted to configured origins', async () => {
    const response = await createLoginHandler(config, () => { throw new Error('Unexpected call'); })(request({}, {method: 'OPTIONS', body: undefined}));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-headers'), 'apikey, content-type');
});

test('resolver failures and missing deployment configuration fail closed without leaking secrets', async () => {
    let calls = 0;
    const response = await createLoginHandler(config, async () => { calls++; return json({message: config.serviceKey}, 403); })(request());
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(config.serviceKey));
    assert.equal(calls, 1);
    assert.equal((await createLoginHandler({...config, serviceKey: ''})(request())).status, 503);
    assert.equal((await createLoginHandler(config, async () => { throw new Error('secret upstream error'); })(request())).status, 503);
});

test('Auth rate limits are preserved and email reassignment cannot log in another user', async () => {
    for (const [authResponse, expected] of [
        [json({message: 'limit'}, 429), 429],
        [json({message: 'unavailable'}, 500), 503],
        [json({...session, user: {id: 'different-user'}}), 401],
        [json({user: session.user}), 503]
    ]) {
        let calls = 0;
        const response = await createLoginHandler(config, async () => ++calls === 1 ? json(account) : authResponse)(request());
        assert.equal(response.status, expected);
        assert.ok(!(await response.text()).includes('user-access'));
    }
});

test('browser login sends a normalized username and never an email/password Auth grant', async () => {
    const auth = new Auth('https://browser.example.test', 'sb_publishable_test');
    let saved;
    auth.save = value => { saved = value; return value; };
    auth.request = async (path, options) => {
        assert.equal(path, '/functions/v1/jobtracker-login');
        assert.deepEqual(options.body, {username: 'test.owner', password: ' password '});
        return session;
    };
    await auth.signIn(' Test.Owner ', ' password ');
    assert.equal(saved, session);
    await assert.rejects(auth.signIn('owner@example.test', 'secret'), /Enter a username/);
});

test('a late login response cannot restore a session after sign-out', async () => {
    const auth = new Auth('https://late.example.test', 'sb_publishable_test');
    let complete;
    auth.request = () => new Promise(resolve => { complete = resolve; });
    auth.save = () => { throw new Error('Stale session must not be saved'); };
    const pending = auth.signIn('test.owner', 'secret');
    auth.epoch++;
    complete(session);
    await assert.rejects(pending, /session changed/);
});
