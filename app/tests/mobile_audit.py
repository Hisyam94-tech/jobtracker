"""Expanded offline audit. Saves survive page reload in a stateful mock server.
No requests reach live Auth, database, Storage, email or native sharing services.
Writes audit-results.json and continues after individual failures.
"""
import copy
import argparse
import functools
import http.server
import json
import re
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
from browser_test import MockSupabase, QuietHandler, APP_ROOT, COMPANY, STAMP, USER

OUT=Path(__file__).parent

class SaveMock(MockSupabase):
    def __init__(self):
        super().__init__()
        self.tables={'jobtracker_repair_orders':[copy.deepcopy(self.order)],'jobtracker_spare_parts':[copy.deepcopy(self.part)]}
        self.writes=[]; self.reject=None; self.serial=0
        self.profile={'user_id':USER,'display_name':'Test Owner','phone':'','updated_at':STAMP}
    def route(self,route):
        req=route.request;url=urlparse(req.url);table=url.path.rsplit('/',1)[-1]
        if url.hostname=='test-project.supabase.co' and table=='jobtracker_profiles' and req.method!='OPTIONS':
            if req.method=='PATCH':
                query=parse_qs(url.query)
                assert query['user_id']==['eq.'+USER] and query['updated_at']==['eq.'+self.profile['updated_at']]
                self.profile.update(req.post_data_json)
                self.profile['updated_at']='2026-10-24T13:00:00+00:00'
            route.fulfill(content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps([self.profile]));return
        if url.hostname!='test-project.supabase.co' or table not in self.tables or req.method=='OPTIONS':
            return super().route(route)
        query={key:values[0] for key,values in parse_qs(url.query).items()}
        body=req.post_data_json if req.post_data else None
        self.calls.append((req.method,url.path,query,body))
        def reply(value,status=200,headers=None):
            route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})},body=json.dumps(value))
        if self.reject and (req.method,table)==self.reject[:2]:
            status=self.reject[2];self.reject=None
            reply({'message':'Simulated save failure' if req.method!='GET' else 'Simulated read failure'},status);return
        records=self.tables[table]
        if req.method=='POST':
            assert body['company_id']==COMPANY
            key='order_number' if table.endswith('orders') else 'part_number'
            if any(row[key]==body[key] and row['company_id']==body['company_id'] for row in records):
                reply({'message':'Duplicate record number'},409);return
            self.serial+=1
            row={**copy.deepcopy(self.order if table.endswith('orders') else self.part),**body,
                 'id':f'60000000-0000-4000-8000-{self.serial:012d}',
                 'created_at':f'2026-10-24T12:00:{self.serial:02d}+00:00','updated_at':f'2026-10-24T12:00:{self.serial:02d}+00:00'}
            records.append(row);self.writes.append((req.method,table,copy.deepcopy(body)));reply([row],201);return
        assert query['company_id']=='eq.'+COMPANY
        matches=[row for row in records if 'id' not in query or query['id']=='eq.'+row['id']]
        if req.method in ['PATCH','DELETE']:
            matches=[row for row in matches if query['updated_at']=='eq.'+row['updated_at']]
            if not matches:reply([]);return
            row=matches[0];self.writes.append((req.method,table,copy.deepcopy(body)))
            if req.method=='PATCH':row.update(body);row['updated_at']='2026-10-24T13:00:00+00:00'
            else:records.remove(row)
            reply([row]);return
        if query.get('status'):matches=[row for row in matches if query['status']=='eq.'+row['status']]
        if req.headers.get('prefer')=='count=exact':reply([],headers={'Content-Range':f'*/{len(matches)}'});return
        if query.get('limit')=='501':
            start=re.search(r'date_received.gte.([0-9-]+)',query['and']).group(1)
            end=re.search(r'date_received.lte.([0-9-]+)',query['and']).group(1)
            matches=[row for row in matches if start<=row['date_received']<=end]
        if '.ilike.' in query.get('and',''):
            term=re.search(r'\.ilike\.([^*]+)\*',query['and']).group(1).lower()
            fields=['order_number','customer_name','device'] if table.endswith('orders') else ['part_number','part_name','category']
            matches=[row for row in matches if any(str(row.get(key,'')).lower().startswith(term) for key in fields)]
        matches.sort(key=lambda row:(row['created_at'],row['id']),reverse=True)
        reply(matches[:int(query.get('limit',51))])

def navigate(page,view):
    if page.viewport_size['width']<768:
        if view=='settings':page.get_by_role('button',name='Company settings',exact=True).click();return
        page.locator(f'.mobile-tab-bar [data-view={view}]').click()
    else:
        selector=f'.sidebar [data-view={view}]'
        if view=='orders':selector+='[data-status=""]'
        page.locator(selector).first.click()

def new_order(page,number='AUDIT-001'):
    page.locator('.mobile-tab-bar [data-action=new-order]').click()
    dialog=page.locator('.repair-dialog')
    for key,value in {'order_number':number,'customer_name':'Audit Customer','phone':'0123456789','email':'audit@example.test','device':'Audit Phone','issue':'Audit issue','date_received':'2026-10-24','estimated_cost':'99.99'}.items():
        dialog.locator(f'[name={key}]').fill(value)
    return dialog

def run(only='',output='audit-results.json'):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(APP_ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/app/'
    results=[]
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            def case(name,task,share=False):
                if only and not any(part.lower() in name.lower() for part in only.split(',')):return
                context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,timezone_id='Asia/Kuala_Lumpur')
                mock=SaveMock();context.route('**/*',mock.route)
                if share:
                    context.add_init_script("""Object.defineProperty(navigator,'canShare',{value:()=>true});
                    Object.defineProperty(navigator,'share',{value:async value=>{
                        if(window.__cancelShare) throw new DOMException('cancel','AbortError');
                        const file=value.files[0];window.__shared={name:file.name,type:file.type,size:file.size,
                          magic:new TextDecoder().decode((await file.arrayBuffer()).slice(0,5))};
                    }});""")
                page=context.new_page();page.set_default_timeout(10000);errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.clock.set_fixed_time(datetime(2026,10,24,4,0,tzinfo=timezone.utc))
                try:
                    page.goto(base)
                    page.get_by_label('Username',exact=True).fill('test.owner');page.get_by_label('Password',exact=True).fill('correct-password')
                    page.get_by_role('button',name='Sign in',exact=True).click()
                    expect(page.get_by_role('heading',name='At a glance',exact=True)).to_be_visible()
                    task(page,mock)
                    assert not errors,errors
                    results.append({'name':name,'status':'PASS'})
                    print('PASS:',name,flush=True)
                except Exception as error:
                    page.screenshot(path=str(OUT/('audit-failure-'+str(len(results))+'.png')))
                    results.append({'name':name,'status':'FAIL','error':str(error),'trace':traceback.format_exc()})
                    print('FAIL:',name,str(error)[:250],flush=True)
                finally:context.close()

            def save_reload(page,mock):
                dialog=new_order(page)
                for cost in ['0.10','0.20']:
                    dialog.locator('[data-action=add-component]').click()
                    row=dialog.locator('.component-row').last
                    row.locator('[name=component_name]').fill('Charge '+cost);row.locator('[name=component_cost]').fill(cost)
                dialog.locator('[name=status]').select_option('completed');dialog.locator('[name=end_date]').fill('2026-10-24')
                dialog.locator('form').evaluate('(form)=>{form.requestSubmit();form.requestSubmit();}')
                expect(dialog).to_have_count(0)
                assert len(mock.writes)==1,'Double submit created duplicate writes'
                saved=mock.tables['jobtracker_repair_orders'][-1]
                assert saved['estimated_cost']==99.99 and len(saved['components_changed'])==2
                page.reload();navigate(page,'orders')
                page.locator('.compact-order').filter(has_text='AUDIT-001').click()
                expect(page.locator('.order-detail')).to_contain_text('Audit issue')
                page.get_by_role('button',name='Edit order',exact=True).click()
                dialog.locator('[name=issue]').fill('Saved after reload')
                dialog.get_by_role('button',name='Save changes',exact=True).click();expect(dialog).to_have_count(0)
                page.reload();navigate(page,'orders');page.locator('.compact-order').filter(has_text='AUDIT-001').click()
                expect(page.locator('.order-detail')).to_contain_text('Saved after reload')
                page.get_by_role('button',name='Order notes',exact=True).click()
                page.get_by_label('Add a progress note',exact=True).fill('Note survives reload')
                page.get_by_role('button',name='Save note',exact=True).click();expect(page.locator('dialog')).to_have_count(0)
                page.reload();navigate(page,'orders');page.locator('.compact-order').filter(has_text='AUDIT-001').click()
                page.get_by_role('button',name='Order notes',exact=True).click()
                expect(page.locator('.notes-list')).to_contain_text('Note survives reload')
                page.locator('dialog [data-action=close]').click();navigate(page,'revenue')
                expect(page.locator('.revenue-total')).to_contain_text('0.30')
            case('Repair create/edit/notes survive reload; duplicate-submit guard; exact revenue cents',save_reload)

            def reject_retry(page,mock):
                dialog=new_order(page)
                mock.reject=('POST','jobtracker_repair_orders',500)
                dialog.get_by_role('button',name='Create order',exact=True).click()
                expect(dialog.locator('[data-error]')).to_contain_text('Simulated save failure')
                expect(dialog.locator('[name=customer_name]')).to_have_value('Audit Customer')
                assert len(mock.tables['jobtracker_repair_orders'])==1
                dialog.get_by_role('button',name='Create order',exact=True).click();expect(dialog).to_have_count(0)
                dialog=new_order(page)
                dialog.get_by_role('button',name='Create order',exact=True).click()
                expect(dialog.locator('[data-error]')).to_contain_text('Duplicate record number')
                assert len(mock.tables['jobtracker_repair_orders'])==2
                dialog.get_by_role('button',name='Cancel',exact=True).click()
                navigate(page,'orders');mock.reject=('GET','jobtracker_repair_orders',500)
                page.get_by_role('button',name='Refresh records',exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('Simulated read failure')
                page.get_by_role('button',name='Refresh records',exact=True).click()
                expect(page.locator('.compact-order')).to_have_count(2)
            case('Failed and duplicate saves preserve form; retry and read-error recovery',reject_retry)

            def parts_delete(page,mock):
                navigate(page,'parts');page.get_by_role('button',name='Add part',exact=True).click()
                dialog=page.locator('dialog')
                for key,value in {'part_number':'AUDIT-PART','part_name':'Audit Screen','quantity':'4','unit_price':'49.90','min_quantity':'2','category':'Displays','supplier':'Supplier','location':'A1','description':'Test part'}.items():dialog.locator(f'[name={key}]').fill(value)
                dialog.get_by_role('button',name='Add part',exact=True).click();expect(dialog).to_have_count(0)
                page.reload();navigate(page,'parts')
                card=page.locator('.compact-part').filter(has_text='AUDIT-PART');card.locator('summary').click()
                card.get_by_role('button',name='Edit part',exact=True).click();dialog.locator('[name=quantity]').fill('7')
                dialog.get_by_role('button',name='Save changes',exact=True).click();expect(dialog).to_have_count(0)
                page.reload();navigate(page,'parts');card.locator('summary').click()
                expect(card.locator('.part-quantity')).to_contain_text('7')
                card.get_by_role('button',name='Delete part',exact=True).click()
                dialog.get_by_role('button',name='Cancel',exact=True).click();assert len(mock.tables['jobtracker_spare_parts'])==2
                card.get_by_role('button',name='Delete part',exact=True).click()
                dialog.get_by_role('button',name='Delete record',exact=True).click();expect(dialog).to_have_count(0)
                page.reload();navigate(page,'parts');expect(card).to_have_count(0)
                navigate(page,'orders');page.locator('.compact-order').first.click();page.get_by_role('button',name='Delete order',exact=True).click()
                dialog.get_by_role('button',name='Delete record',exact=True).click();expect(dialog).to_have_count(0)
                page.reload();navigate(page,'orders');expect(page.locator('.compact-order')).to_have_count(0)
            case('Parts create/edit/reload, cancel deletion, confirmed part and repair deletion',parts_delete)

            def calendar(page,mock):
                page.evaluate("async()=>{const m=await import('./src/date-range.js');m.openDateRange({from:'2026-10-01',to:'2026-10-10'},r=>window.__range=r);}")
                dialog=page.locator('.calendar-dialog')
                dialog.locator('[data-date="2026-10-25"]').click();expect(dialog.locator('[data-apply]')).to_be_disabled()
                dialog.locator('[data-move="1"]').click();dialog.locator('[data-date="2026-11-05"]').click()
                expect(dialog.locator('.calendar-message')).to_contain_text('12 days selected')
                dialog.locator('[data-apply]').click();assert page.evaluate('window.__range')=={'from':'2026-10-25','to':'2026-11-05'}
                navigate(page,'revenue');page.locator('.period-selector').click()
                dialog.locator('[data-preset=previous]').click();dialog.locator('[data-cancel]').click()
                page.locator('.period-selector').click();expect(dialog.locator('[data-phase=start]')).to_contain_text('Oct')
                dialog.press('Escape');expect(dialog).to_have_count(0)
            case('Calendar cross-month selection, presets/cancel and Escape',calendar)

            def invalid_end(page,mock):
                page.evaluate("async()=>{const m=await import('./src/date-range.js');m.openDateRange({from:'2026-10-01',to:'2026-10-10'},r=>window.__range=r);}")
                dialog=page.locator('.calendar-dialog');dialog.locator('[data-phase=end]').click()
                dialog.locator('[data-move="1"]').click();dialog.locator('[data-date="2026-11-30"]').click()
                expect(dialog.locator('[role=alert]')).to_contain_text('within 31 days')
                expect(dialog.locator('[data-apply]')).to_be_disabled(timeout=1000)
            case('Calendar rejects out-of-range end date without retaining an applyable stale end',invalid_end)

            def layouts(page,mock):
                for width,height in [(320,568),(360,640),(390,844),(430,932),(844,390),(768,1024)]:
                    page.set_viewport_size({'width':width,'height':height})
                    for view in ['home','orders','parts','revenue','settings']:
                        navigate(page,view)
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,height,view)
                    navigate(page,'orders')
                    selector='.mobile-tab-bar [data-action=new-order]' if width<768 else '.records-heading [data-action=new-order]'
                    page.locator(selector).click();dialog=page.locator('.repair-dialog')
                    assert dialog.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),(width,height,'repair')
                    for name in ['date_received','end_date']:
                        assert dialog.locator(f'[name={name}]').evaluate('(el)=>el.getBoundingClientRect().width<=el.parentElement.getBoundingClientRect().width+1')
                    dialog.get_by_role('button',name='Cancel',exact=True).click()
                    navigate(page,'revenue');page.locator('.period-selector').click();calendar=page.locator('.calendar-dialog')
                    assert calendar.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),(width,height,'calendar')
                    calendar.locator('[data-apply]').scroll_into_view_if_needed();calendar.locator('[data-cancel]').click()
            case('Six mobile/tablet/landscape sizes: all tabs, repair dates and calendar overflow',layouts)

            def pdf(page,mock):
                for style in ['circuitcare_v1','modern_v1']:
                    mock.companies[COMPANY]['invoice_template']=style
                    navigate(page,'orders');page.locator('.compact-order').first.click();page.get_by_role('button',name='View invoice',exact=True).click()
                    dialog=page.locator('.invoice-preview');share=dialog.get_by_role('button',name='Share PDF',exact=True)
                    expect(share).to_be_enabled(timeout=30000)
                    page.evaluate('window.__cancelShare=true');share.click();expect(dialog.locator('.invoice-message')).to_have_text('Sharing cancelled.')
                    page.evaluate('window.__cancelShare=false');share.click();expect(dialog.locator('.invoice-message')).to_contain_text('passed to the share menu')
                    data=page.evaluate('window.__shared');assert data['magic']=='%PDF-' and data['size']>1000 and data['type']=='application/pdf',data
                    frame=page.frames[-1];frame.evaluate('window.print=()=>{parent.__printed=true}')
                    dialog.get_by_role('button',name='Print',exact=True).click();assert page.evaluate('window.__printed')
                    dialog.get_by_role('button',name='Close',exact=True).click();expect(dialog).to_have_count(0)
            case('Both invoice styles generate real PDF bytes; share/cancel and print dispatch are mocked',pdf,share=True)

            def profile_settings(page,mock):
                page.get_by_role('button',name='Edit profile',exact=True).click()
                page.get_by_label('Your name',exact=True).fill('Reloaded Owner')
                page.get_by_role('button',name='Save profile',exact=True).click()
                expect(page.get_by_role('heading',name='Reloaded Owner',exact=True)).to_be_visible()
                page.reload()
                expect(page.get_by_role('heading',name='Reloaded Owner',exact=True)).to_be_visible()
                navigate(page,'settings')
                page.get_by_label('Company name',exact=True).fill('Reloaded Company')
                page.get_by_label('Invoice style').select_option('modern_v1')
                page.get_by_role('button',name='Save company details',exact=True).click()
                expect(page.get_by_text('Company details saved.',exact=True)).to_be_visible()
                page.reload();navigate(page,'settings')
                expect(page.get_by_label('Company name',exact=True)).to_have_value('Reloaded Company')
                expect(page.get_by_label('Invoice style')).to_have_value('modern_v1')
            case('Profile and company settings saves persist after reload',profile_settings)

            def revoked(page,mock):
                navigate(page,'orders');expect(page.locator('.compact-order')).to_have_count(1)
                mock.reject=('GET','jobtracker_repair_orders',401)
                page.get_by_role('button',name='Refresh records',exact=True).click()
                expect(page.get_by_role('heading',name='Sign in to your workspace',exact=True)).to_be_visible()
                assert page.locator('.compact-order').count()==0 and page.evaluate('sessionStorage.length')==0
            case('Revoked access during data load removes visible data and saved session',revoked)
            browser.close()
    finally:
        server.shutdown()
        (OUT/output).write_text(json.dumps({'scope':'offline Chromium mobile emulation; no live database or OS sharing','results':results},indent=2),encoding='utf-8')
    return all(result['status']=='PASS' for result in results)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--only',default='')
    parser.add_argument('--output',default='audit-results.json')
    args=parser.parse_args()
    raise SystemExit(0 if run(args.only,args.output) else 1)
