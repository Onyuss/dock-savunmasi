# Geliştirme sunucusu: dosyaları önbelleksiz sunar, böylece her değişiklik tarayıcıya hemen yansır.
# Kullanım: python devserver.py [port]
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.hdr': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(os.environ.get('PORT') or (sys.argv[1] if len(sys.argv) > 1 else 8080))
    print(f'Dock Savunmasi: http://localhost:{port}')
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
