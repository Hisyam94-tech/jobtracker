"""Offline repair controls regression test. All external traffic is intercepted."""
import base64
import argparse
import functools
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from browser_test import MockSupabase, QuietHandler, APP_ROOT, COMPANY, USER

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=')

class RepairMock(MockSupabase):
    def __init__(self):
        super().__init__()
        self.lookups = []
        self.uploads = []
        self.fail_upload = False

    def route(self, route):
        request = route.request
        path = urlparse(request.url).path
        if urlparse(request.url).hostname == 'test-project.supabase.co' and request.method != 'OPTIONS':
            headers = {'Access-Control-Allow-Origin': '*'}
            if path in ['/rest/v1/rpc/jobtracker_repair_suggestions','/rest/v1/rpc/jobtracker_customer_suggestions']:
                body = request.post_data_json
                assert body['target_company_id'] == COMPANY
                assert len(body['search_text']) >= 2
                self.lookups.append(body)
                route.fulfill(content_type='application/json', headers=headers, body=json.dumps([self.order]))
                return
            if path.startswith('/storage/v1/object/'):
                assert request.headers['authorization'] == 'Bearer test-access'
                if request.method == 'POST':
                    assert path.startswith('/storage/v1/object/jobtracker-repair-images/' + COMPANY + '/' + USER + '/')
                    assert request.headers['content-type'] == 'image/png'
                    assert request.post_data_buffer == PNG
                    self.uploads.append(path)
                    route.fulfill(status=403 if self.fail_upload else 200, content_type='application/json', headers=headers,
                                  body=json.dumps({'message':'Upload denied'} if self.fail_upload else {'Key':path}))
                else:
                    assert '/authenticated/jobtracker-repair-images/' + COMPANY + '/' in path
                    route.fulfill(content_type='image/png', headers=headers, body=PNG)
                return
        super().route(route)

def run(browser_name='chromium'):
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(QuietHandler,directory=str(APP_ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            for engine in [getattr(p,browser_name)]:
                browser = engine.launch()
                context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
                mock = RepairMock(); context.route('**/*', mock.route)
                page = context.new_page(); errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}/app/')
                page.get_by_label('Username',exact=True).fill('test.owner')
                page.get_by_label('Password',exact=True).fill('correct-password')
                page.get_by_role('button',name='Sign in',exact=True).click()
                page.locator('.mobile-tab-bar [data-action=new-order]').click()
                dialog = page.locator('.repair-dialog')
                expect(dialog).to_be_visible()
                assert not mock.lookups
                customer = page.get_by_label('Customer name',exact=True)
                customer.fill('A'); page.wait_for_timeout(350); assert not mock.lookups
                customer.fill('Al'); customer.fill('Ale'); customer.fill('Alex')
                expect(page.get_by_role('option',name='Alex Tan')).to_be_visible()
                assert len(mock.lookups)==1
                page.get_by_role('option',name='Alex Tan').tap()
                expect(customer).to_have_value('Alex Tan')
                expect(page.get_by_label('Phone',exact=True)).to_have_value('0123456789')
                expect(page.get_by_label('Email (optional)',exact=True)).to_have_value('alex@example.test')
                phone = page.get_by_label('Phone',exact=True)
                phone.fill('012'); expect(page.locator('#repair-suggestions-phone [role=option]')).to_be_visible()
                phone.press('ArrowDown'); phone.press('Enter')
                expect(phone).to_have_value('0123456789')
                device = page.get_by_label('Device',exact=True)
                device.fill('Lap'); expect(page.get_by_role('option',name='Laptop')).to_be_visible()
                page.get_by_role('option',name='Laptop').tap()
                expect(device).to_have_value('Laptop')
                dialog.evaluate('(el)=>el.scrollTop=0')
                page.screenshot(path=str(Path(__file__).parent/'new-repair-mobile.png'))
                for width in [320,360,390,430,768,1440]:
                    page.set_viewport_size({'width':width,'height':844})
                    assert dialog.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),(engine.name,width)
                    for name in ['date_received','end_date']:
                        assert dialog.locator(f'[name={name}]').evaluate('(el)=>el.getBoundingClientRect().width<=el.parentElement.getBoundingClientRect().width+1'),(engine.name,width,name)
                page.set_viewport_size({'width':390,'height':844})
                upload = page.get_by_label('Add device images',exact=True)
                upload.set_input_files({'name':'invalid.txt','mimeType':'text/plain','buffer':b'bad'})
                expect(dialog.locator('.image-error')).to_contain_text('Choose JPG')
                upload.set_input_files({'name':'broken.png','mimeType':'image/png','buffer':b'not an image'})
                expect(dialog.locator('.image-error')).to_contain_text('could not be read')
                upload.set_input_files([{'name':'device.png','mimeType':'image/png','buffer':PNG}]*6)
                expect(dialog.locator('.image-error')).to_contain_text('up to 5')
                upload.set_input_files({'name':'device.png','mimeType':'image/png','buffer':PNG})
                expect(dialog.locator('.repair-image-grid img')).to_have_count(1)
                dialog.locator('.repair-images').scroll_into_view_if_needed()
                page.screenshot(path=str(Path(__file__).parent/'repair-images-mobile.png'))
                assert not mock.uploads
                page.get_by_role('button',name='Remove image 1',exact=True).click()
                expect(dialog.locator('.repair-image-grid img')).to_have_count(0)
                upload.set_input_files({'name':'device.png','mimeType':'image/png','buffer':PNG})
                expect(dialog.locator('.repair-image-grid img')).to_have_count(1)
                page.get_by_label('Order number',exact=True).fill('JT0002')
                page.get_by_label('Issue description',exact=True).fill('Screen repair')
                page.get_by_label('Date received',exact=True).fill('2026-10-24')
                page.get_by_label('Date completed (optional)',exact=True).fill('2026-10-23')
                page.get_by_role('button',name='Create order',exact=True).click()
                assert not mock.uploads and not mock.created
                page.get_by_label('Date completed (optional)',exact=True).fill('2026-10-25')
                mock.fail_upload = True
                page.get_by_role('button',name='Create order',exact=True).click()
                expect(dialog.locator('[data-error]')).to_contain_text('Upload denied')
                assert not mock.created
                mock.fail_upload = False
                page.get_by_role('button',name='Create order',exact=True).click()
                expect(dialog).to_have_count(0)
                saved = mock.created[-1]
                assert len(saved['images'])==1 and saved['images'][0]['path'].startswith(COMPANY + '/' + USER + '/')
                assert 'data:' not in json.dumps(saved['images'])
                mock.order['images'] = saved['images']
                page.locator('.compact-order').first.click()
                expect(page.locator('.repair-image-grid img')).to_have_count(1)
                page.get_by_role('button',name='Edit order',exact=True).click()
                expect(page.locator('.repair-image-grid img')).to_have_count(1)
                mock.conflict = True
                before = len(mock.uploads)
                page.get_by_role('button',name='Save changes',exact=True).click()
                expect(dialog.locator('[data-error]')).to_contain_text('record changed')
                assert len(mock.uploads)==before
                mock.conflict = False
                page.get_by_role('button',name='Remove image 1',exact=True).click()
                page.get_by_role('button',name='Save changes',exact=True).click()
                expect(dialog).to_have_count(0)
                assert mock.order['images']==[]
                assert not errors,errors
                browser.close()
                print(engine.name + ': dropdown/autofill, six widths, image validation/upload/retry/removal, date validation passed')
    finally:
        server.shutdown()

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',choices=['chromium','webkit'],default='chromium')
    run(parser.parse_args().browser)
