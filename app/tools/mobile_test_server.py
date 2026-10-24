"""LAN preview server: exposes only the new app and its public configuration."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

REPO = Path(__file__).resolve().parents[2]
APP = REPO / 'app'

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        route = unquote(urlsplit(self.path).path)
        if route == '/':
            self.send_response(302)
            self.send_header('Location', '/app/')
            self.end_headers()
            return None
        if '\\' in route or any(part in ('.', '..') for part in route.split('/')):
            self.send_error(404)
            return None
        permitted = route in ('/app/', '/app/index.html', '/gh-pages-config.js')
        for prefix in ('/app/src/', '/app/vendor/'):
            if route.startswith(prefix):
                target = (REPO / route.lstrip('/')).resolve()
                allowed_root = (REPO / prefix.lstrip('/')).resolve()
                permitted = target.is_relative_to(allowed_root) and target.is_file() and target.suffix in ('.js', '.css', '.txt', '.png', '.ttf', '.woff2')
                break
        if not permitted:
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8004)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('0.0.0.0', args.port), partial(Handler, directory=str(REPO)))
    print(f'JobTracker LAN preview on port {args.port}: /app/', flush=True)
    server.serve_forever()
