"""Serve the docs-only UX hub with browser module MIME types on Windows."""

from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DOCS_ROOT = Path(__file__).resolve().parents[1]


class HubHandler(SimpleHTTPRequestHandler):
    explicit_types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".md": "text/plain; charset=utf-8",
        ".woff2": "font/woff2",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS_ROOT), **kwargs)

    def guess_type(self, path):
        return self.explicit_types.get(Path(path).suffix.lower(), super().guess_type(path))

    def do_GET(self):
        # Avoid stale browser caches during local iteration of ES modules.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    parser = ArgumentParser(description="Serve the local Moeazi UX research hub")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), HubHandler)
    print(f"Serving {DOCS_ROOT} at http://127.0.0.1:{args.port}/user-experience/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping local UX preview.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
