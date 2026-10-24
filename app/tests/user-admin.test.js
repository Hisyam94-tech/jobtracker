import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddUserHandler} from '../supabase/functions/jobtracker-add-user/handler.js';

globalThis.fetch=()=>{throw new Error('No live network allowed');};
const ACTOR='00000000-0000-4000-8000-000000000001', USER='00000000-0000-4000-8000-000000000002';
const REQUEST='10000000-0000-4000-8000-000000000001', LEASE='20000000-0000-4000-8000-000000000001';
const COMPANY='30000000-0000-4000-8000-000000000001';
const config={url:'https://unit.example.test',publicKey:'public-test',serviceKey:'secret-test',allowedOrigins:['http://localhost:8003'],redirectUrl:'http://localhost:8003/app/'};
const body={request_id:REQUEST,username:' Nadia ',email:'NADIA@example.test',display_name:'Nadia Hamid',company_id:COMPANY,role:'staff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const request=(value=body,overrides={})=>new Request(config.url+'/functions/v1/jobtracker-add-user',{
    method:'POST',headers:{origin:config.allowedOrigins[0],authorization:'Bearer verified-session','content-type':'application/json'},body:JSON.stringify(value),...overrides});
function fixture(overrides={}) {
    const calls=[];
    const fetcher=async(url,options={})=>{
        const path=new URL(url).pathname, data=options.body?JSON.parse(options.body):null;
        calls.push({path,data,options,url});
        if (overrides[path]) return overrides[path](data,options);
        if (path==='/auth/v1/user') return json({id:ACTOR,user_metadata:{username:'admin'},app_metadata:{role:'admin'}});
        assert.equal(options.headers.Authorization,'Bearer '+config.serviceKey);
        if (path.endsWith('/jobtracker_prepare_user_invite')) return json({request_id:REQUEST,lease_token:LEASE,user_id:null,confirmed:false,completed:false});
        if (path==='/auth/v1/admin/users') return json({id:USER});
        if (path.endsWith('/jobtracker_finish_user_invite')) return json(null);
        if (path==='/auth/v1/invite') return json({id:USER});
        if (path.endsWith('/jobtracker_release_user_invite')) return json(null);
        throw new Error('Unexpected route '+path);
    };
    return {calls,handler:createAddUserHandler(config,fetcher)};
}
test('verified admin creates globally named account and commits assignment before emailing',async()=>{
    const {calls,handler}=fixture();const response=await handler(request());
    assert.equal(response.status,200);
    assert.equal(calls[0].options.headers.Authorization,'Bearer verified-session');
    assert.deepEqual(calls[1].data,{actor_id:ACTOR,wanted_request_id:REQUEST,wanted_username:'nadia',wanted_email:'nadia@example.test',wanted_name:'Nadia Hamid',wanted_company:COMPANY,wanted_role:'staff'});
    assert.deepEqual(calls[2].data,{email:'nadia@example.test',email_confirm:false,app_metadata:{jobtracker_request_id:REQUEST}});
    assert.ok(calls[3].path.endsWith('jobtracker_finish_user_invite'));
    assert.equal(calls[4].path,'/auth/v1/invite');
    assert.equal(new URL(calls[4].url).searchParams.get('redirect_to'),config.redirectUrl);
    assert.equal(calls[5].data.email_sent,true);
    const output=await response.text();
    assert.ok(!output.includes(config.serviceKey) && !output.includes(LEASE) && !output.includes(USER));
});
test('company admin roles and editable admin metadata cannot authorize user creation',async()=>{
    const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_prepare_user_invite':()=>json({code:'42501'},403)});
    const response=await handler(request());
    assert.equal(response.status,403);assert.equal(calls.length,2);
    assert.ok(!calls.some(call=>call.path==='/auth/v1/admin/users'));
});
test('unverified sessions cannot reach the private admin check or Auth creation',async()=>{
    const {calls,handler}=fixture({'/auth/v1/user':()=>json({message:'bad token'},401)});
    assert.equal((await handler(request())).status,401);assert.equal(calls.length,1);
});
test('global duplicate username is rejected before any user or invitation is created',async()=>{
    const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_prepare_user_invite':()=>json({code:'23505'},409)});
    assert.equal((await handler(request())).status,409);assert.equal(calls.length,2);
});
test('database assignment failure does not send email or delete an account',async()=>{
    const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_finish_user_invite':()=>json({code:'23505'},409)});
    assert.equal((await handler(request())).status,409);
    assert.ok(!calls.some(call=>call.path==='/auth/v1/invite' || call.options.method==='DELETE'));
    assert.equal(calls.at(-1).data.email_sent,false);
});
test('retry resumes the same Auth account and does not create another',async()=>{
    const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_prepare_user_invite':()=>json({request_id:REQUEST,lease_token:LEASE,user_id:USER,confirmed:false,completed:false})});
    assert.equal((await handler(request())).status,200);
    assert.ok(!calls.some(call=>call.path==='/auth/v1/admin/users'));
    assert.equal(calls.filter(call=>call.path==='/auth/v1/invite').length,1);
});
test('completed retries never resend invitations',async()=>{
    const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_prepare_user_invite':()=>json({request_id:REQUEST,completed:true})});
    assert.equal((await handler(request())).status,200);assert.equal(calls.length,2);
});
test('email failure reports partial completion and releases the retry lease',async()=>{
    const {calls,handler}=fixture({'/auth/v1/invite':()=>json({message:'upstream secret'},429)});
    const response=await handler(request());assert.equal(response.status,429);
    const output=await response.text();assert.match(output,/user was created/);assert.ok(!output.includes('upstream secret'));
    assert.equal(calls.at(-1).data.email_sent,false);
});
test('concurrent reservation, throttling and unavailable setup fail before creating users',async()=>{
    for (const [code,status] of [['55P03',409],['54000',429],['42883',503]]) {
        const {calls,handler}=fixture({'/rest/v1/rpc/jobtracker_prepare_user_invite':()=>json({code},400)});
        assert.equal((await handler(request())).status,status);assert.equal(calls.length,2);
    }
});
test('malformed, oversized, actor-injected, reserved-name and owner-role requests fail closed',async()=>{
    const {handler,calls}=fixture();
    for (const value of [{...body,actor_id:ACTOR},{...body,username:'admin'},{...body,role:'owner'},{...body,display_name:'x'.repeat(9000)},{...body,company_id:'other'},null]) {
        assert.equal((await handler(request(value))).status,400);
    }
    assert.equal(calls.length,0);
});
test('only configured origins and server-side redirects are accepted',async()=>{
    const {handler,calls}=fixture();
    assert.equal((await handler(request(body,{headers:{origin:'https://evil.test'}}))).status,403);
    assert.equal((await handler(request(body,{method:'OPTIONS',body:undefined}))).status,204);
    assert.equal(calls.length,0);
    const broken=createAddUserHandler({...config,redirectUrl:'https://evil.test/app/'},()=>{throw new Error('No calls');});
    assert.equal((await broken(request())).status,503);
});
