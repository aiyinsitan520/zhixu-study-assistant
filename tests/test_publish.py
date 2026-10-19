"""Publisher state transitions use temporary files and never touch production."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('public_publish', Path(__file__).resolve().parents[1] / 'scripts/public_publish.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
URL = 'https://verified-test.trycloudflare.com'


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.deploy = Path(self.temp.name)
        self.seconds = 0
        self.launched = 0
        self.repairs = []

    def sleep(self, seconds):
        self.seconds += seconds

    def launch(self):
        self.launched += 1

    def run_publish(self, check, timeout=90):
        return publisher.publish(self.deploy, check=check, launch=self.launch,
                                 now=lambda: self.seconds, sleep=self.sleep, timeout=timeout)

    def origin(self, value=URL):
        (self.deploy / 'public-origin.txt').write_text(value, encoding='utf-8')

    def test_healthy_link_is_reused_without_restart(self):
        self.origin()
        result = self.run_publish(lambda origin, **kw: True)
        self.assertEqual(result['url'], URL)
        self.assertTrue(result['reused'])
        self.assertEqual(self.launched, 0)
        self.assertFalse((self.deploy / 'publish-request.json').exists())

    def test_stopped_service_is_started_and_new_link_verified(self):
        def check(origin, **kw):
            return self.launched > 0
        def launch():
            self.launched += 1
            self.origin()
        with patch.object(self, 'launch', launch):
            result = self.run_publish(check)
        self.assertEqual(result['url'], URL)
        self.assertFalse(result['reused'])
        self.assertEqual(self.launched, 1)

    def test_bad_tunnel_requests_recovery_then_returns_new_url(self):
        self.origin()
        new_url = 'https://replacement-test.trycloudflare.com'
        def check(origin, **kw):
            return origin == publisher.LOCAL or origin == new_url
        real_request = publisher.request_repair
        def repair(deploy, action):
            self.repairs.append(action)
            request_id = real_request(deploy, action)
            self.origin(new_url)
            return request_id
        with patch.object(publisher, 'request_repair', repair):
            result = self.run_publish(check)
        self.assertEqual(result['url'], new_url)
        self.assertEqual(self.repairs, ['restart-tunnel'])
        request = json.loads((self.deploy / 'publish-request.json').read_text())
        self.assertEqual(request['action'], 'restart-tunnel')
        self.assertTrue(request['id'])

    def test_transient_https_failures_do_not_change_address(self):
        self.origin()
        checks = 0
        def check(origin, **kw):
            nonlocal checks
            if origin == publisher.LOCAL:
                return True
            checks += 1
            return checks >= 3
        result = self.run_publish(check)
        self.assertEqual(result['url'], URL)
        self.assertFalse((self.deploy / 'publish-request.json').exists())

    def test_hung_server_requests_restart_and_timeout_is_failure(self):
        with self.assertRaisesRegex(RuntimeError, '暂未验证公网连通'):
            self.run_publish(lambda origin, **kw: False, timeout=45)
        request = json.loads((self.deploy / 'publish-request.json').read_text())
        self.assertEqual(request['action'], 'restart-server')
        # A timeout releases the lock and a later healthy attempt can succeed.
        self.origin()
        self.assertTrue(self.run_publish(lambda origin, **kw: True)['reused'])

    def test_absent_public_address_requests_tunnel_repair(self):
        with self.assertRaises(RuntimeError):
            self.run_publish(lambda origin, **kw: origin == publisher.LOCAL, timeout=50)
        request = json.loads((self.deploy / 'publish-request.json').read_text())
        self.assertEqual(request['action'], 'restart-tunnel')

    def test_concurrent_publish_is_rejected(self):
        self.origin()
        nested = False
        def check(origin, **kw):
            nonlocal nested
            if not nested:
                nested = True
                with self.assertRaisesRegex(RuntimeError, '另一个发布窗口'):
                    self.run_publish(lambda origin, **kw: True)
            return True
        self.assertTrue(self.run_publish(check)['reused'])

    def test_origin_must_be_https_tunnel_or_configured_fixed_domain(self):
        for bad in ('http://evil.example', 'https://evil.example', URL + '/extra', URL + '?q=1', URL + '@evil.example'):
            self.origin(bad)
            self.assertEqual(publisher.read_origin(self.deploy), '')
        (self.deploy / 'fixed-tunnel.json').write_text(json.dumps({'publicOrigin': 'https://study.example.com'}))
        self.origin('https://study.example.com')
        self.assertEqual(publisher.read_origin(self.deploy), 'https://study.example.com')

    def test_health_requires_initialized_app_and_never_follows_redirect(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        state = {'initialized': True, 'user': None}
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                requests.append(self.path)
                self.send_response(302 if state.get('redirect') else 200)
                if state.get('redirect'):
                    self.send_header('Location', '/redirected')
                self.end_headers()
                self.wfile.write(json.dumps(state).encode())
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = 'http://127.0.0.1:' + str(server.server_port)
            self.assertTrue(publisher.healthy(origin))
            state['initialized'] = False
            self.assertFalse(publisher.healthy(origin))
            state.clear()
            self.assertFalse(publisher.healthy(origin))
            state.update(initialized=True, user=None, redirect=True)
            requests.clear()
            self.assertFalse(publisher.healthy(origin))
            self.assertEqual(requests, ['/api/auth/status'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_supervisor_accepts_request_and_rejects_duplicate_process(self):
        import os
        import subprocess
        import sys
        import time
        env = os.environ.copy()
        env.update(STUDY_DEPLOY_DIR=str(self.deploy), STUDY_NODE_EXE=sys.executable,
                   STUDY_CLOUDFLARED_EXE=sys.executable)
        script = str(Path(publisher.__file__).with_name('serve-windows.py'))
        process = subprocess.Popen([sys.executable, script], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 10
            while not (self.deploy / 'supervisor.pid').exists() and time.monotonic() < deadline:
                time.sleep(.1)
            self.assertIsNone(process.poll())
            self.assertEqual(int((self.deploy / 'supervisor.pid').read_text()), process.pid)
            duplicate = subprocess.run([sys.executable, script], env=env, capture_output=True, timeout=8)
            self.assertEqual(duplicate.returncode, 0)
            self.assertEqual(int((self.deploy / 'supervisor.pid').read_text()), process.pid)
            request_id = publisher.request_repair(self.deploy, 'restart-tunnel')
            deadline = time.monotonic() + 12
            while not (self.deploy / 'publish-result.json').exists() and time.monotonic() < deadline:
                time.sleep(.1)
            result = json.loads((self.deploy / 'publish-result.json').read_text())
            self.assertEqual(result['id'], request_id)
            self.assertEqual(result['action'], 'restart-tunnel')
        finally:
            (self.deploy / 'stop.request').touch()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
        self.assertEqual(process.returncode, 0)
        self.assertFalse((self.deploy / 'supervisor.pid').exists())

    def test_gui_button_success_copy_open_and_failure_states(self):
        import tkinter as tk
        import webbrowser
        real_tk = tk.Tk
        opened = []
        for fails in (False, True):
            errors = []
            def create_root():
                root = real_tk()
                root.geometry('760x550')
                def inspect():
                    try:
                        widgets = []
                        def collect(parent):
                            for child in parent.winfo_children():
                                widgets.append(child)
                                collect(child)
                        collect(root)
                        buttons = {str(w.cget('text')): w for w in widgets if w.winfo_class() in ('Button', 'TButton')}
                        entry = next(w for w in widgets if w.winfo_class() == 'TEntry')
                        self.assertEqual(entry.get(), '' if fails else URL)
                        self.assertEqual(str(buttons['再次检查 / 一键发布'].cget('state')), 'normal')
                        self.assertEqual(str(buttons['复制公网链接'].cget('state')), 'disabled' if fails else 'normal')
                        self.assertEqual(str(buttons['打开网站'].cget('state')), 'disabled' if fails else 'normal')
                        for widget in widgets:
                            if widget.winfo_ismapped():
                                self.assertLessEqual(widget.winfo_rooty() + widget.winfo_height(), root.winfo_rooty() + root.winfo_height())
                        if not fails:
                            buttons['复制公网链接'].invoke()
                            self.assertEqual(root.clipboard_get(), URL)
                            buttons['打开网站'].invoke()
                    except Exception as error:
                        errors.append(error)
                    finally:
                        for callback in root.tk.call('after', 'info'):
                            root.after_cancel(callback)
                        root.destroy()
                root.after(50, lambda: root.winfo_children()[0].winfo_children()[3].invoke())
                root.after(750, inspect)
                return root
            def result(**kwargs):
                if fails:
                    raise RuntimeError('test failure')
                return {'url': URL, 'reused': True}
            with patch.object(tk, 'Tk', create_root), patch.object(publisher, 'publish', result), patch.object(webbrowser, 'open', opened.append):
                publisher.main()
            if errors:
                raise errors[0]
        self.assertEqual(opened, [URL])


if __name__ == '__main__':
    unittest.main()
