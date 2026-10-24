"""Offline browser integration checks. Every external request is intercepted.
Run: python cc/app/tests/browser_test.py
Never connects to a live Supabase project or database.
"""
import copy
import functools
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

APP_ROOT = Path(__file__).resolve().parents[2]
USER = '00000000-0000-4000-8000-000000000001'
COMPANY = '10000000-0000-4000-8000-000000000001'
OTHER = '20000000-0000-4000-8000-000000000002'
STAMP = '2026-10-23T10:00:00+00:00'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class MockSupabase:
    def __init__(self, scenario='owner'):
        self.scenario = scenario
        self.calls = []
        self.refreshes = 0
        self.conflict = False
        self.delay_response = False
        self.user = {'id': USER, 'email': 'owner@example.test', 'email_confirmed_at': STAMP}
        self.companies = {COMPANY: {'id': COMPANY, 'name': 'CircuitCare Test', 'status': 'active', 'invoice_template': 'circuitcare_v1', 'updated_at': STAMP},
                          OTHER: {'id': OTHER, 'name': 'Second Company', 'status': 'active', 'invoice_template': 'modern_v1', 'updated_at': STAMP}}
        self.memberships = [] if scenario == 'new' else [{'company_id': COMPANY, 'role': 'staff' if scenario == 'staff' else 'owner', 'status': 'suspended' if scenario == 'suspended' else 'active', 'company': None if scenario == 'suspended' else self.companies[COMPANY]}]
        if scenario == 'multi':
            self.memberships.append({'company_id': OTHER, 'role': 'admin', 'status': 'active', 'company': self.companies[OTHER]})
        self.order = {'id': '30000000-0000-4000-8000-000000000001', 'company_id': COMPANY, 'order_number': 'JT0001', 'customer_name': 'Alex Tan', 'phone': '0123456789', 'email': 'alex@example.test', 'device': 'Laptop', 'issue': 'Screen replacement', 'estimated_cost': 120, 'status': 'in-progress', 'date_received': '2026-10-23', 'end_date': None, 'components_changed': [{'name':'Screen repair', 'cost': 100.25}], 'images': [], 'updates': [], 'created_at': STAMP, 'updated_at': STAMP}
        self.part = {'id': '40000000-0000-4000-8000-000000000001', 'company_id': COMPANY, 'part_number': 'PART01', 'part_name': 'Screen', 'description': 'Replacement', 'quantity': 3, 'min_quantity': 5, 'unit_price': 80, 'supplier': '', 'location': 'A1', 'category': 'Screens', 'created_at': STAMP, 'updated_at': STAMP}
        self.created = []
    def session(self):
        return {'access_token': 'test-access', 'refresh_token': 'test-refresh', 'expires_in': 3600, 'user': self.user}
    def route(self, route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname == '127.0.0.1':
            if url.path.endswith('/gh-pages-config.js'):
                route.fulfill(content_type='application/javascript', body="window.SUPABASE_URL='https://test-project.supabase.co';window.SUPABASE_ANON_KEY='sb_publishable_offline_test';")
            else:
                route.continue_()
            return
        assert url.hostname == 'test-project.supabase.co', 'Unexpected external request: ' + url.hostname
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'})
            return
        query = {k:v[0] for k,v in parse_qs(url.query).items()}
        body = request.post_data_json if request.post_data else None
        self.calls.append((request.method, url.path, query, body))
        def reply(value, status=200, extra_headers=None):
            route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin':'*', 'Access-Control-Expose-Headers':'Content-Range', **(extra_headers or {})}, body=json.dumps(value))
        path = url.path
        if path == '/functions/v1/jobtracker-login':
            assert set(body) == {'username', 'password'}
            assert body['username'] == 'test.owner'
            if body['password'] == 'wrong':
                return reply({'message':'Invalid login credentials'},401)
            return reply(self.session())
        if path == '/auth/v1/token':
            if query['grant_type'] == 'refresh_token':
                self.refreshes += 1
                if self.scenario == 'expired': return reply({'message':'Refresh token revoked'},400)
            else:
                raise AssertionError('Password login must use the username Edge Function')
            return reply(self.session())
        if path == '/auth/v1/user':
            return reply(self.user)
        if path == '/auth/v1/recover':
            assert query['redirect_to'].endswith('/app/')
            return reply({})
        if path == '/auth/v1/logout': return reply({})
        assert request.headers.get('authorization') == 'Bearer test-access'
        if path == '/rest/v1/jobtracker_company_memberships':
            assert query['user_id'] == 'eq.' + USER
            return reply(self.memberships)
        if path == '/rest/v1/jobtracker_profiles':
            return reply([{'user_id':USER, 'display_name':body['display_name'] if body else 'Test Owner', 'phone':'', 'updated_at':STAMP}])
        if path == '/rest/v1/jobtracker_companies':
            return reply([self.companies[query['id'][3:]]])
        if path == '/rest/v1/rpc/jobtracker_create_company':
            assert set(body) == {'company_name','display_name','template_key'}
            self.companies[COMPANY]['name'] = body['company_name']
            self.companies[COMPANY]['invoice_template'] = body['template_key']
            self.memberships = [{'company_id':COMPANY,'role':'owner','status':'active','company':self.companies[COMPANY]}]
            return reply(COMPANY)
        if path == '/rest/v1/rpc/jobtracker_update_company':
            assert body['expected_updated_at'] == STAMP
            self.companies[COMPANY]['name'] = body['company_name']
            self.companies[COMPANY]['invoice_template'] = body['template_key']
            return reply(None)
        if path in ['/rest/v1/rpc/jobtracker_repair_suggestions','/rest/v1/rpc/jobtracker_customer_suggestions']:
            assert body['target_company_id'] == COMPANY
            assert body['search_field'] in ['customer_name','phone','device']
            return reply([self.order])
        if path == '/rest/v1/rpc/jobtracker_list_customers':
            assert body['target_company_id'] in self.companies
            return reply([])
        if path == '/rest/v1/rpc/jobtracker_is_user_admin':
            return reply(False)
        assert path in ['/rest/v1/jobtracker_repair_orders','/rest/v1/jobtracker_spare_parts'], path
        record = self.order if path.endswith('orders') else self.part
        if request.method == 'POST':
            assert body['company_id'] in self.companies
            assert 'id' not in body
            if path.endswith('orders'): assert isinstance(body['components_changed'],list)
            self.created.append(body)
            return reply([{**record,**body}],201)
        assert query['company_id'] in ['eq.'+COMPANY,'eq.'+OTHER], query
        if request.method in ['PATCH','DELETE']:
            assert query['updated_at'] == 'eq.' + STAMP
            assert query['id'].startswith('eq.')
            if self.conflict: return reply([])
            if request.method == 'PATCH':
                assert 'company_id' not in body
                record.update(body)
            return reply([record])
        if request.headers.get('prefer') == 'count=exact':
            assert query['limit'] == '1' and query['select'] == 'id'
            count = 0 if query['company_id'] == 'eq.'+OTHER else 1
            return reply([{'id':record['id']}] if count else [], extra_headers={'Content-Range':f'0-0/{count}'})
        if query.get('limit') == '501':
            assert query['status'] == 'eq.completed'
            assert 'date_received.gte.' in query['and'] and 'date_received.lte.' in query['and']
            if self.scenario == 'report-overflow': return reply([self.order] * 501)
            return reply([self.order] if query['company_id']=='eq.'+COMPANY else [])
        if query.get('select') == '*': return reply([record])
        assert int(query['limit']) == 51
        assert query['order'] == 'created_at.desc,id.desc'
        if query['company_id'] == 'eq.'+OTHER: return reply([])
        if self.scenario == 'pagination':
            if 'created_at.lt.' in query.get('and',''): return reply([])
            return reply([{**record,'id':f'30000000-0000-4000-8000-{i:012d}','order_number':f'JT{i:04}'} for i in range(1,52)])
        return reply([record])

def run():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(APP_ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/app/'
    with sync_playwright() as p:
        browser=p.chromium.launch()
        def page_for(scenario='owner',mobile=False):
            context=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':960})
            mock=MockSupabase(scenario)
            context.route('**/*',mock.route)
            page=context.new_page()
            page.errors=[]
            page.scenario=scenario
            page.on('pageerror',lambda error:page.errors.append(str(error)))
            page.goto(base)
            expect(page.get_by_role('heading',name='Sign in to your workspace')).to_be_visible()
            assert not mock.calls, 'Anonymous page must not contact Auth or business tables.'
            return page,mock
        def navigate(page, view):
            nav = page.locator('nav[aria-label="Mobile navigation"]' if page.viewport_size['width'] < 768 else '.sidebar nav')
            selector = f'button[data-view="{view}"]'
            if view == 'orders' and page.viewport_size['width'] >= 768: selector += '[data-status=""]'
            nav.locator(selector).click()
        def records_text(page, text):
            return page.locator('#record-list .mobile-only:visible, #record-list .desktop-only:visible').get_by_text(text,exact=True)
        def mobile_order_action(page, name):
            page.locator('.compact-order').first.click()
            page.locator('dialog').get_by_role('button',name=name,exact=True).click()
        def sign_in(page,password='correct-password'):

            page.get_by_label('Username', exact=True).fill('Test.Owner')
            page.get_by_label('Password',exact=True).fill(password)
            page.get_by_role('button',name='Sign in',exact=True).click()
            if password != 'wrong' and page.scenario not in ['new','multi','suspended']:
                expect(page.get_by_role('heading',name='At a glance')).to_be_visible()
                expect(page.locator('[data-metric="total"]')).to_have_text('1')
                if page.scenario == 'owner' and page.viewport_size['width'] < 768:
                    page.screenshot(path=str(Path(__file__).parent/'home-mobile.png'),full_page=True)
                elif page.scenario == 'owner':
                    page.screenshot(path=str(Path(__file__).parent/'home-desktop.png'),full_page=True)
                navigate(page,'orders')
        page,mock=page_for(mobile=True)
        page.screenshot(path=str(Path(__file__).parent/'login-mobile.png'),full_page=True)
        sign_in(page,'wrong')
        expect(page.get_by_role('alert')).to_have_text('Invalid login credentials')
        assert not any('/rest/v1/' in call[1] for call in mock.calls)
        sign_in(page)
        expect(records_text(page,'Alex Tan')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(Path(__file__).parent/'orders-mobile.png'),full_page=True)
        mobile_order_action(page,'View invoice')
        invoice=page.frame_locator('iframe[title="Repair invoice"]')
        expect(invoice.get_by_role('heading',name='CircuitCare Test')).to_be_visible()
        expect(invoice.locator('.grand-total')).to_contain_text('100.25')
        expect(page.get_by_role('button',name='Share PDF',exact=True)).to_be_disabled()
        page.locator('.invoice-preview [data-action=close]').click()
        page.locator('.invoice-preview').wait_for(state='detached')
        mock.conflict=True
        mobile_order_action(page,'Edit order')
        page.get_by_label('Customer name',exact=True).fill('Updated customer')
        page.get_by_role('button',name='Save changes',exact=True).click()
        expect(page.locator('dialog [data-error]')).to_contain_text('record changed')
        mock.conflict=False
        page.get_by_role('button',name='Save changes',exact=True).click()
        page.locator('dialog').wait_for(state='detached')
        expect(records_text(page,'Updated customer')).to_be_visible()
        mobile_order_action(page,'Order notes')
        page.get_by_label('Add a progress note').fill('Waiting for parts')
        page.get_by_role('button',name='Save note',exact=True).click()
        page.locator('dialog').wait_for(state='detached')
        assert mock.order['updates'][0]['text']=='Waiting for parts'
        page.locator('.mobile-tab-bar [data-action=new-order]').click()
        for label,value in [('Order number','JT0002'),('Customer name','Jamie'),('Phone','0123456789'),('Device','Phone'),('Issue description','Repair port')]:
            page.get_by_label(label,exact=True).fill(value)
        page.get_by_role('button',name='Add charge').click()
        page.get_by_label('Description',exact=True).fill('Port repair')
        page.get_by_label('Cost (RM)',exact=True).fill('49.90')
        page.get_by_role('button',name='Create order',exact=True).click()
        page.locator('dialog').wait_for(state='detached')
        assert mock.created[-1]['components_changed']==[{'name':'Port repair','cost':49.9}]
        navigate(page,'parts')
        expect(records_text(page,'PART01')).to_be_visible()
        page.locator('.compact-part summary').click()
        page.locator('.compact-part').get_by_role('button',name='Edit part',exact=True).click()
        page.get_by_label('Quantity',exact=True).fill('9')
        page.get_by_role('button',name='Save changes',exact=True).click()
        page.locator('dialog').wait_for(state='detached')
        assert mock.part['quantity']==9
        page.get_by_role('button',name='Company settings',exact=True).click()
        page.get_by_label('Invoice style').select_option('modern_v1')
        page.get_by_role('button',name='Save company details',exact=True).click()
        expect(page.get_by_text('Company details saved.',exact=True)).to_be_visible()
        page.get_by_role('button',name='Sign out',exact=True).click()
        expect(page.get_by_role('heading',name='Sign in to your workspace')).to_be_visible()
        assert page.evaluate('sessionStorage.length')==0
        assert not page.errors,page.errors
        page.context.close()
        print('PASS: failed login, no anonymous queries, mobile, invoice, conflict, order create/edit, notes, inventory, company style, logout',flush=True)

        page,mock=page_for('new')
        sign_in(page)
        expect(page.get_by_role('heading',name='Set up your company')).to_be_visible()
        page.get_by_label('Your name').fill('Business Owner')
        page.get_by_label('Company name',exact=True).fill('New Repair Company')
        page.get_by_label('Invoice style').select_option('modern_v1')
        page.get_by_role('button',name='Create company').click()
        expect(page.get_by_role('heading',name='At a glance',exact=True)).to_be_visible()
        assert mock.companies[COMPANY]['name']=='New Repair Company'
        assert not page.errors,page.errors
        page.context.close()
        print('PASS: first-company RPC and owner workspace',flush=True)

        page,mock=page_for(mobile=True)
        sign_in(page)
        navigate(page,'home')
        expect(page.locator('[data-metric=revenue]')).to_contain_text('100.25')
        page.get_by_role('button',name='Edit profile',exact=True).click()
        page.get_by_label('Your name',exact=True).fill('Updated Owner')
        page.get_by_role('button',name='Save profile',exact=True).click()
        expect(page.get_by_role('heading',name='Updated Owner',exact=True)).to_be_visible()
        navigate(page,'revenue')
        expect(page.locator('.revenue-summary')).to_contain_text('100.25')
        expect(page.locator('.revenue-breakdown')).to_contain_text('Alex Tan')
        page.screenshot(path=str(Path(__file__).parent/'revenue-mobile.png'),full_page=True)
        for width in [320,768,1440]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        assert not page.errors,page.errors
        page.context.close()

        page,mock=page_for('report-overflow',mobile=True)
        sign_in(page)
        navigate(page,'revenue')
        expect(page.get_by_role('alert')).to_contain_text('Choose fewer days')
        assert page.locator('.revenue-summary').count()==0
        assert not page.errors,page.errors
        page.context.close()
        print('PASS: profile editing, revenue report, responsive widths and no partial totals on report overflow',flush=True)


        for scenario in ['suspended','staff','multi','pagination']:
            page,mock=page_for(scenario)
            sign_in(page)
            if scenario=='suspended':
                expect(page.get_by_role('heading',name='Your workspace is unavailable')).to_be_visible()
                assert not any(call[1].endswith(('jobtracker_repair_orders','jobtracker_spare_parts')) for call in mock.calls)
            elif scenario=='staff':
                expect(records_text(page,'Alex Tan')).to_be_visible()
                assert page.get_by_role('button',name='Delete order',exact=True).count()==0
                page.get_by_role('button',name='Company',exact=True).click()
                expect(page.get_by_label('Company name',exact=True)).to_be_disabled()
            elif scenario=='multi':
                expect(page.get_by_role('heading',name='Choose a workspace')).to_be_visible()
                page.get_by_role('button',name='CircuitCare Test owner').click()
                navigate(page,'orders')
                expect(records_text(page,'Alex Tan')).to_be_visible()
                page.locator('#company-select').select_option(OTHER)
                expect(page.get_by_role('heading',name='At a glance')).to_be_visible()
                expect(page.locator('[data-metric=total]')).to_have_text('0')
                navigate(page,'orders')
                expect(page.get_by_role('heading',name='Your next repair starts here')).to_be_visible()
                assert records_text(page,'Alex Tan').count()==0
            else:
                expect(page.get_by_text('Page 1 - 50 records - up to 50 per page')).to_be_visible()
                page.get_by_role('button',name='Next',exact=True).click()
                expect(page.get_by_text('Page 2 - 0 records - up to 50 per page')).to_be_visible()
                page.get_by_role('button',name='Previous',exact=True).click()
                expect(page.get_by_text('Page 1 - 50 records - up to 50 per page')).to_be_visible()
            assert not page.errors,page.errors
            page.context.close()
        print('PASS: suspended access, staff permissions, company isolation in queries/UI, keyset pagination',flush=True)

        page,mock=page_for()
        page.screenshot(path=str(Path(__file__).parent/'login-desktop.png'),full_page=True)
        page.get_by_role('button',name='Forgot password?').click()
        page.get_by_label('Email address').fill('owner@example.test')
        page.get_by_role('button',name='Send reset link').click()
        expect(page.get_by_role('status')).to_contain_text('If an account exists')
        page.goto(base+'#access_token=test-access&refresh_token=test-refresh&expires_in=3600&type=recovery')
        expect(page.get_by_role('heading',name='Set your password',exact=True)).to_be_visible()
        expect(page).to_have_url(base)
        assert not any('/rest/v1/' in call[1] for call in mock.calls)
        page.get_by_label('New password',exact=True).fill('new-test-password')
        page.get_by_label('Confirm password',exact=True).fill('new-test-password')
        page.get_by_role('button',name='Save password',exact=True).click()
        navigate(page,'orders')
        expect(records_text(page,'Alex Tan')).to_be_visible()
        page.evaluate("const key=Object.keys(sessionStorage)[0];const session=JSON.parse(sessionStorage.getItem(key));session.expires_at=1;sessionStorage.setItem(key,JSON.stringify(session));")
        page.reload()
        navigate(page,'orders')
        expect(records_text(page,'Alex Tan')).to_be_visible()
        assert mock.refreshes==1,mock.refreshes
        mock.scenario='expired'
        page.evaluate("const key=Object.keys(sessionStorage)[0];const session=JSON.parse(sessionStorage.getItem(key));session.expires_at=1;sessionStorage.setItem(key,JSON.stringify(session));")
        page.reload()
        expect(page.get_by_role('heading',name='Sign in to your workspace')).to_be_visible()
        assert not page.errors,page.errors
        page.context.close()
        print('PASS: password reset, recovery callback, password save, session restore/refresh and revoked-session cleanup',flush=True)
        browser.close()
    server.shutdown()

if __name__=='__main__': run()
