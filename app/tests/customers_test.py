"""Offline customer directory integration: never contacts live tables."""
import functools
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
from browser_test import MockSupabase, QuietHandler, APP_ROOT, COMPANY, OTHER, STAMP

class CustomerMock(MockSupabase):
    def __init__(self):
        super().__init__('multi')
        self.customers = []
        self.customer_calls = []
        self.customer_conflict = False

    def route(self, route):
        request=route.request; url=urlparse(request.url)
        if url.hostname == 'test-project.supabase.co' and request.method != 'OPTIONS' and 'customer' in url.path:
            body=request.post_data_json if request.post_data else None
            query={key:values[0] for key,values in parse_qs(url.query).items()}
            self.customer_calls.append((request.method,url.path,body,query))
            def reply(value):
                route.fulfill(content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(value))
            if url.path.endswith('jobtracker_list_customers'):
                assert body['target_company_id'] in [COMPANY,OTHER]
                rows=[row for row in self.customers if row['company_id']==body['target_company_id']]
                if body['search_text']:
                    rows=[row for row in rows if (row[body['search_field']] or '').lower().startswith(body['search_text'].lower())]
                rows.sort(key=lambda row:(row['created_at'],row['id']),reverse=True)
                if body['before_id']:
                    rows=[row for row in rows if (row['created_at'],row['id']) < (body['before_created'],body['before_id'])]
                reply(rows[:26]);return
            if url.path.endswith('jobtracker_customer_suggestions'):
                reply([row for row in self.customers if row['company_id']==body['target_company_id'] and row[body['search_field']].lower().startswith(body['search_text'].lower())][:20]);return
            assert url.path=='/rest/v1/jobtracker_customers',url.path
            if request.method=='POST':
                assert set(body)=={'company_id','customer_name','phone','email','address'}
                row={**body,'id':f'50000000-0000-4000-8000-{len(self.customers)+1:012d}','created_at':STAMP,'updated_at':STAMP}
                self.customers.append(row);reply([row]);return
            assert request.method=='PATCH'
            assert set(body)=={'customer_name','phone','email','address'}
            row=next(row for row in self.customers if query['id']=='eq.'+row['id'] and query['company_id']=='eq.'+row['company_id'])
            assert query['updated_at']=='eq.'+row['updated_at']
            if self.customer_conflict:reply([]);return
            row.update(body);reply([row]);return
        super().route(route)

def run():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(APP_ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(); context=browser.new_context(viewport={'width':390,'height':844})
            mock=CustomerMock();context.route('**/*',mock.route)
            page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/app/')
            page.get_by_label('Username',exact=True).fill('test.owner');page.get_by_label('Password',exact=True).fill('correct-password')
            page.get_by_role('button',name='Sign in',exact=True).click()
            page.get_by_role('button',name='CircuitCare Test owner').click()
            page.get_by_role('button',name='Company settings',exact=True).click()
            section=page.locator('.customer-settings')
            expect(section).to_contain_text('No customers yet')
            section.get_by_role('button',name='Add customer',exact=True).click()
            dialog=page.locator('.customer-dialog')
            page.get_by_label('Customer name',exact=True).fill('  Nadia Hamid  ')
            page.get_by_label('Phone number',exact=True).fill('  +60123456789  ')
            page.get_by_label('Email (optional)',exact=True).fill('nadia@example.test')
            page.get_by_label('Address (optional)',exact=True).fill('12 Jalan Test\nKuala Lumpur')
            for width in [320,390,768,1440]:
                page.set_viewport_size({'width':width,'height':844})
                assert dialog.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),width
            page.set_viewport_size({'width':390,'height':844})
            dialog.get_by_role('button',name='Add customer',exact=True).click()
            expect(dialog).to_have_count(0)
            expect(section).to_contain_text('Nadia Hamid')
            expect(section).to_contain_text('Kuala Lumpur')
            assert mock.customers[0]['phone']=='+60123456789'
            section.get_by_role('button',name='Edit Nadia Hamid',exact=True).click()
            page.get_by_label('Address (optional)',exact=True).fill('Updated address')
            mock.customer_conflict=True
            dialog.get_by_role('button',name='Save customer',exact=True).click()
            expect(dialog.locator('[data-error]')).to_contain_text('customer changed')
            expect(page.get_by_label('Address (optional)',exact=True)).to_have_value('Updated address')
            mock.customer_conflict=False
            dialog.get_by_role('button',name='Save customer',exact=True).click()
            expect(dialog).to_have_count(0)
            expect(section).to_contain_text('Updated address')
            page.reload()
            page.get_by_role('button',name='CircuitCare Test owner').click()
            page.get_by_role('button',name='Company settings',exact=True).click()
            expect(section).to_contain_text('Updated address')
            section.get_by_label('Search by',exact=True).select_option('email')
            section.get_by_label('Search customers',exact=True).fill('absent')
            section.get_by_role('button',name='Search',exact=True).click()
            expect(section).to_contain_text('No matching customers')
            section.get_by_label('Search customers',exact=True).fill('nadia')
            section.get_by_role('button',name='Search',exact=True).click()
            expect(section).to_contain_text('Nadia Hamid')
            section.scroll_into_view_if_needed()
            page.screenshot(path=str(Path(__file__).parent/'customers-mobile.png'),full_page=True)
            page.locator('.mobile-tab-bar [data-action=new-order]').click()
            page.get_by_label('Customer name',exact=True).fill('Nad')
            page.get_by_role('option',name='Nadia Hamid').click()
            expect(page.get_by_label('Phone',exact=True)).to_have_value('+60123456789')
            expect(page.get_by_label('Email (optional)',exact=True)).to_have_value('nadia@example.test')
            page.get_by_role('button',name='Cancel',exact=True).click()
            page.get_by_role('button',name='Company settings',exact=True).click()
            page.locator('#company-select').select_option(OTHER)
            page.get_by_role('button',name='Company settings',exact=True).click()
            expect(section).to_contain_text('No customers yet')
            expect(section).not_to_contain_text('Nadia')
            page.locator('#company-select').select_option(COMPANY)
            for index in range(2,29):
                mock.customers.append({**mock.customers[0],'id':f'50000000-0000-4000-8000-{index:012d}','customer_name':f'Customer {index}'})
            page.get_by_role('button',name='Company settings',exact=True).click()
            expect(section.locator('.customer-card')).to_have_count(25)
            section.get_by_role('button',name='Next',exact=True).click()
            expect(section.locator('.customer-card')).to_have_count(3)
            expect(section.get_by_role('button',name='Next',exact=True)).to_be_disabled()
            assert any(call[2] and call[2].get('before_id') for call in mock.customer_calls)
            section.get_by_role('button',name='Previous',exact=True).click()
            expect(section.locator('.customer-card')).to_have_count(25)
            for width in [320,390,768,1440]:
                page.set_viewport_size({'width':width,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
            assert not errors,errors
            browser.close()
            print('PASS: customer add/edit/conflict/search, repair autofill, company isolation, keyset pagination, mobile layouts (mocked)')
    finally:server.shutdown()

if __name__=='__main__':run()
