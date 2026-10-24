import test from 'node:test';
import assert from 'node:assert/strict';
import {Auth, ApiError} from '../src/auth.js';
import {Repository} from '../src/data.js';
import {invoiceHtml} from '../src/invoice.js';
import {summarizeRevenue, reportResultHtml} from '../src/workspace-view.js';

// No real network or database access is permitted in these tests.
globalThis.fetch = () => { throw new Error('Unexpected network call in unit test'); };
const store = new Map();
globalThis.sessionStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
};
const user = {id: '00000000-0000-4000-8000-000000000001', email: 'test@example.test'};
const company = {id: '10000000-0000-4000-8000-000000000001', name: 'Repair <script>alert(1)</script>', invoice_template: 'modern_v1'};
const order = {company_id: company.id, order_number: 'JT0001', customer_name: '<img src=x onerror=alert(1)>', phone: '123', device: 'Phone', issue: 'A & B', date_received: '2026-10-24', components_changed: [{name: '<b>Repair</b>', cost: 0.1}, {name: 'Part', cost: 0.2}]};

test('invoice uses exact cents and escapes company, customer and charges', () => {
    const html = invoiceHtml(order, company);
    assert.match(html, /RM\s*0\.30/);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;img'));
    assert.ok(html.includes('&lt;b&gt;Repair&lt;/b&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
});
test('invoice rejects wrong company and unsupported templates without a fallback', () => {
    assert.throws(() => invoiceHtml({...order, company_id: 'other'}, company), /does not match/);
    assert.throws(() => invoiceHtml(order, {...company, invoice_template: 'unknown'}), /unsupported/);
    assert.throws(() => invoiceHtml({...order, components_changed: [{name: 'Bad', cost: -1}]}, company), /invalid cost/);
});
test('expired session refresh is serialized across simultaneous requests', async () => {
    store.clear();
    const auth = new Auth('https://unit.example.test', 'sb_publishable_test');
    auth.save({access_token: 'old', refresh_token: 'refresh', user, expires_at: 1});
    let requests = 0;
    auth.request = async path => {
        assert.equal(path, '/auth/v1/token?grant_type=refresh_token');
        requests++;
        await new Promise(resolve => setTimeout(resolve, 5));
        return {access_token: 'new', refresh_token: 'new-refresh', user, expires_in: 3600};
    };
    assert.deepEqual(await Promise.all([auth.token(), auth.token(), auth.token()]), ['new', 'new', 'new']);
    assert.equal(requests, 1);
});
test('revoked refresh clears stored session and informs the UI', async () => {
    const auth = new Auth('https://revoked.example.test', 'sb_publishable_test');
    auth.save({access_token: 'old', refresh_token: 'refresh', user, expires_at: 1});
    let cleared = false;
    auth.onSignOut(() => { cleared = true; });
    auth.request = async () => { throw new ApiError('Revoked', 400); };
    await assert.rejects(auth.token(), /Revoked/);
    assert.equal(auth.session, null);
    assert.equal(sessionStorage.getItem(auth.storageKey), null);
    assert.ok(cleared);
});
test('company-scoped list uses a bound and refuses filter syntax injection', async () => {
    const auth = {epoch: 0, token: async () => 'token', request: async path => {
        const url = new URL('https://test.invalid' + path);
        assert.equal(url.pathname, '/rest/v1/jobtracker_repair_orders');
        assert.equal(url.searchParams.get('company_id'), 'eq.' + company.id);
        assert.equal(url.searchParams.get('limit'), '51');
        return [];
    }};
    const repo = new Repository(auth);
    assert.deepEqual(await repo.list('orders', company.id), {rows: [], hasNext: false});
    await assert.rejects(repo.list('orders', company.id, {search: 'x),company_id.neq.y'}), /Search accepts/);
});
test('conflicting edit has no success result and keeps expected timestamp filter', async () => {
    const repo = new Repository({epoch: 0, token: async () => 'token', request: async (path, options) => {
        const url = new URL('https://test.invalid' + path);
        assert.equal(options.method, 'PATCH');
        assert.equal(url.searchParams.get('updated_at'), 'eq.2026-10-24T00:00:00Z');
        assert.equal(url.searchParams.get('company_id'), 'eq.' + company.id);
        return [];
    }});
    await assert.rejects(repo.save('orders', company.id, {issue: 'Changed'}, {id: 'record', updated_at: '2026-10-24T00:00:00Z'}), /record changed/);
});

test('dashboard counts are company-scoped and request no more than one ID each', async () => {
    const calls = [];
    const repo = new Repository({epoch: 0, token: async () => 'token', request: async (path, options) => {
        const url = new URL('https://test.invalid' + path);
        assert.equal(url.searchParams.get('company_id'), 'eq.' + company.id);
        assert.equal(url.searchParams.get('select'), 'id');
        assert.equal(url.searchParams.get('limit'), '1');
        assert.equal(options.headers.Prefer, 'count=exact');
        assert.equal(options.returnCount, true);
        calls.push(url.searchParams.get('status'));
        return 12;
    }});
    assert.deepEqual(await repo.overview(company.id), {total: 12, inProgress: 12, completed: 12, parts: 12});
    assert.deepEqual(calls, [null, 'eq.in-progress', 'eq.completed', null]);
});

test('revenue is bounded by company, dates and row limit; over-limit totals are rejected', async () => {
    let calls = 0;
    const repo = new Repository({epoch: 0, token: async () => 'token', request: async path => {
        calls++;
        const url = new URL('https://test.invalid' + path);
        assert.equal(url.searchParams.get('company_id'), 'eq.' + company.id);
        assert.equal(url.searchParams.get('status'), 'eq.completed');
        assert.equal(url.searchParams.get('limit'), '501');
        assert.equal(url.searchParams.get('and'), '(date_received.gte.2026-10-01,date_received.lte.2026-10-31)');
        return Array(501).fill({});
    }});
    await assert.rejects(repo.revenue(company.id, '2026-10-01', '2026-10-31'), /Choose fewer days/);
    await assert.rejects(repo.revenue(company.id, '2026-01-01', '2026-10-31'), /up to 31 days/);
    await assert.rejects(repo.revenue(company.id, '2026-10-31', '2026-10-01'), /up to 31 days/);
    await assert.rejects(repo.revenue(company.id, '2026-10-01),x.eq.y', '2026-10-31'), /up to 31 days/);
    assert.equal(calls, 1);
});

test('revenue uses exact component cents, escapes labels, and rejects malformed charges', () => {
    const report = summarizeRevenue([{...order, date_received: '2026-10-23'}, {...order, date_received: '2026-10-24', components_changed: [{name: 'Repair', cost: 4.7}]}]);
    assert.equal(report.total, 500);
    assert.deepEqual(report.days, [['2026-10-23', 30], ['2026-10-24', 470]]);
    assert.ok(!reportResultHtml(report).includes('<img'));
    assert.throws(() => summarizeRevenue([{...order, components_changed: null}]), /invalid invoice charges/);
    assert.throws(() => summarizeRevenue([{...order, components_changed: [{cost: -1}]}]), /invalid charge/);
});

test('profile edits target the signed-in user and reject stale versions', async () => {
    const repo = new Repository({epoch: 0, token: async () => 'token', request: async (path, options) => {
        const url = new URL('https://test.invalid' + path);
        assert.equal(url.searchParams.get('user_id'), 'eq.' + user.id);
        assert.equal(url.searchParams.get('updated_at'), 'eq.old');
        assert.deepEqual(options.body, {display_name: 'Updated Name'});
        return [];
    }});
    await assert.rejects(repo.updateProfile(user.id, 'Updated Name', 'old'), /profile changed/);
});

test('repair suggestions are company scoped, bounded by RPC, and skip short input', async () => {
    const calls = [];
    const repository = new Repository({epoch:0, token:async ()=>'token', request:async (path,options)=>{calls.push({path,options});return [];}});
    assert.deepEqual(await repository.repairSuggestions(company.id,'customer_name','A'),[]);
    assert.equal(calls.length,0);
    await repository.repairSuggestions(company.id,'customer_name','Alex');
    assert.equal(calls[0].path,'/rest/v1/rpc/jobtracker_customer_suggestions');
    assert.deepEqual(calls[0].options.body,{target_company_id:company.id,search_field:'customer_name',search_text:'Alex'});
    await assert.rejects(repository.repairSuggestions(company.id,'company_id','xx'),/Unknown suggestion field/);
});

test('private repair image download refuses other-company paths before network', async () => {
    const {RepairImages} = await import('../src/repair-images.js');
    const images = new RepairImages({request:async ()=>{throw new Error('Unexpected network call');}},company.id);
    await assert.rejects(images.preview({path:'20000000-0000-4000-8000-000000000001/'+user.id+'/'+'a'.repeat(32)+'.png'}),/Invalid company image reference/);
    await assert.rejects(images.preview({path:company.id+'/../../secret'}),/Invalid company image reference/);
});

test('customer directory requests one bounded page and carries its company and cursor', async () => {
    const calls=[];
    const repository=new Repository({epoch:0,token:async ()=>'token',request:async (path,options)=>{calls.push({path,options});return Array.from({length:26},(_,i)=>({id:String(i)}));}});
    const cursor={created_at:'2026-10-24T00:00:00Z',id:'50000000-0000-4000-8000-000000000001'};
    const result=await repository.customers(company.id,{search:'Nadia',field:'customer_name',cursor});
    assert.equal(result.rows.length,25);assert.equal(result.hasNext,true);
    assert.equal(calls[0].path,'/rest/v1/rpc/jobtracker_list_customers');
    assert.deepEqual(calls[0].options.body,{target_company_id:company.id,search_field:'customer_name',search_text:'Nadia',before_created:cursor.created_at,before_id:cursor.id});
    await assert.rejects(repository.customers(company.id,{field:'company_id'}),/Invalid customer search/);
});

test('customer edits are company scoped, optimistic, and do not overwrite ownership', async () => {
    const calls=[];
    const repository=new Repository({epoch:0,token:async ()=>'token',request:async (path,options)=>{calls.push({path,options});return [];}});
    const record={id:'50000000-0000-4000-8000-000000000001',updated_at:'2026-10-24T00:00:00Z'};
    const payload={customer_name:'Nadia',phone:'+60123',email:null,address:null};
    await assert.rejects(repository.saveCustomer(company.id,payload,record),/customer changed/);
    const url=new URL('https://test.invalid'+calls[0].path);
    assert.equal(url.searchParams.get('company_id'),'eq.'+company.id);
    assert.equal(url.searchParams.get('id'),'eq.'+record.id);
    assert.equal(url.searchParams.get('updated_at'),'eq.'+record.updated_at);
    assert.equal(calls[0].options.method,'PATCH');
    assert.deepEqual(calls[0].options.body,payload);
});
