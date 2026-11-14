"""게임용 로컬 서버. 브라우저가 예전 파일을 캐시에서 꺼내 쓰지 않도록 no-store 헤더를 붙인다.

    python serve.py          -> http://localhost:8765/game.html
    python serve.py 9000     -> 다른 포트
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):          # 요청 로그는 찍지 않는다
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = Path(__file__).resolve().parent
    print(f"http://localhost:{port}/game.html  (Ctrl+C 로 종료)")
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(root))).serve_forever()
