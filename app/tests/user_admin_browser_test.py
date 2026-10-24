"""Admin UI checks with all Auth, database and email-function traffic mocked."""
import functools
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from browser_test import MockSupabase, QuietHandler, APP_ROOT, COMPANY, OTHER

class AdminMock(MockSupabase):
    def __init__(self,allowed):
        super().__init__()
        self.allowed=allowed
        self.memberships[0]['role']='admin'  # Company role alone must not unlock UI.
        self.invites=[]; self.invite_fails=True; self.company_pages=[]
        self.catalog=[{'id':f'10000000-0000-4000-8000-{i:012d}','name':f'Company {i}'} for i in range(1,26)] + [{'id':OTHER,'name':'Unrelated Company'}]
    def route(self,route):
        req=route.request;url=urlparse(req.url)
        if url.hostname=='test-project.supabase.co' and req.method!='OPTIONS':
            def reply(value,status=200):route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(value))
            if url.path=='/rest/v1/rpc/jobtracker_is_user_admin':reply(self.allowed);return
            if url.path=='/rest/v1/rpc/jobtracker_admin_companies':
                assert self.allowed
                cursor=req.post_data_json['after_id'];self.company_pages.append(cursor)
                reply([row for row in self.catalog if cursor is None or row['id']>cursor][:26]);return
            if url.path=='/functions/v1/jobtracker-add-user':
                assert self.allowed and req.headers['authorization']=='Bearer test-access'
                self.invites.append(req.post_data_json)
                if self.invite_fails:reply({'message':'The user was created, but invitation delivery was not confirmed. Retry with the same details.'},503)
                else:reply({'username':req.post_data_json['username'],'message':'User created. Invitation sent so they can set their password.'})
                return
        super().route(route)

def run():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(APP_ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            for allowed in [False,True]:
                context=browser.new_context(viewport={'width':390,'height':844})
                mock=AdminMock(allowed);context.route('**/*',mock.route)
                page=context.new_page();page.set_default_timeout(10000)
                errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}/app/')
                page.get_by_label('Username',exact=True).fill('test.owner');page.get_by_label('Password',exact=True).fill('correct-password')
                page.get_by_role('button',name='Sign in',exact=True).click()
                page.get_by_role('button',name='Company settings',exact=True).click()
                expect(page.locator('.customer-list')).to_contain_text('No customers yet')
                section=page.locator('.user-admin')
                if not allowed:
                    expect(section).to_have_count(0)
                    assert not mock.company_pages and not mock.invites
                else:
                    expect(section.get_by_label('Company',exact=True)).to_be_enabled()
                    expect(section.locator('[name=company_id] option')).to_have_count(26)
                    section.get_by_role('button',name='Next companies',exact=True).click()
                    expect(section.locator('[name=company_id] option')).to_have_count(2)
                    section.get_by_label('Company',exact=True).select_option(OTHER)
                    section.get_by_label('Full name',exact=True).fill('Nadia Hamid')
                    section.get_by_label('Username',exact=True).fill('Nadia.Hamid')
                    section.get_by_label('Email address',exact=True).fill('Nadia@example.test')
                    section.get_by_label('Company role',exact=True).select_option('staff')
                    for width in [320,390,768,1440]:
                        page.set_viewport_size({'width':width,'height':844})
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
                    page.set_viewport_size({'width':390,'height':844})
                    section.get_by_role('button',name='Create user & send invitation',exact=True).click()
                    expect(section.locator('[data-error]')).to_contain_text('delivery was not confirmed')
                    expect(section.get_by_label('Username',exact=True)).to_have_value('Nadia.Hamid')
                    assert len(mock.invites)==1
                    assert mock.invites[0]['username']=='nadia.hamid'
                    assert mock.invites[0]['company_id']==OTHER and OTHER not in [m['company_id'] for m in mock.memberships]
                    assert 'password' not in mock.invites[0] and 'actor_id' not in mock.invites[0]
                    mock.invite_fails=False
                    section.get_by_role('button',name='Create user & send invitation',exact=True).click()
                    expect(section.locator('[data-notice]')).to_contain_text('Invitation sent')
                    assert mock.invites[0]['request_id']==mock.invites[1]['request_id']
                    expect(section.get_by_label('Username',exact=True)).to_have_value('')
                    section.scroll_into_view_if_needed()
                    page.screenshot(path=str(Path(__file__).parent/'user-admin-mobile.png'),full_page=True)
                assert not errors,errors
                context.close()
            browser.close()
            print('PASS: company admin denied UI, admin company pagination, unrelated-company selection, normalized username, idempotent retry, four viewport sizes (mocked)')
    finally:server.shutdown()

if __name__=='__main__':run()
