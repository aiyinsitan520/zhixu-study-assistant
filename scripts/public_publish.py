"""Local-only publishing controls. No HTTP management endpoint is exposed."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import time
import uuid
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request

APP = Path(__file__).resolve().parents[1]
DEPLOY = Path('E:/AAA数据库/知序服务器')
LOCAL = 'http://127.0.0.1:4317'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def healthy(origin, timeout=8):
    """Check the actual unauthenticated app, without cookies, redirects or a proxy."""
    try:
        opener = build_opener(ProxyHandler({}), NoRedirect())
        with opener.open(Request(origin + '/api/auth/status', headers={
            'Cache-Control': 'no-cache', 'User-Agent': 'Zhixu-Publisher/1.0'
        }), timeout=timeout) as response:
            value = json.loads(response.read(8192))
            return response.status == 200 and value.get('initialized') is True and value.get('user', 'missing') is None
    except Exception:
        return False


def read_origin(deploy=DEPLOY):
    try:
        origin = (deploy / 'public-origin.txt').read_text(encoding='utf-8-sig').strip()
        if re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com', origin):
            return origin
        # Fixed domains must match the owner's local configuration exactly.
        fixed = json.loads((deploy / 'fixed-tunnel.json').read_text(encoding='utf-8-sig'))
        if re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::443)?', origin) and origin == fixed['publicOrigin'].rstrip('/'):
            return origin
    except (OSError, ValueError, KeyError):
        pass
    return ''


def request_repair(deploy, action):
    if action not in ('restart-tunnel', 'restart-server'):
        raise ValueError('Unknown repair action')
    request_id = str(uuid.uuid4())
    target = deploy / 'publish-request.json'
    temp = deploy / ('publish-' + request_id + '.tmp')
    temp.write_text(json.dumps({'id': request_id, 'action': action, 'createdAt': time.time()}), encoding='utf-8')
    os.replace(temp, target)
    return request_id


def start_supervisor():
    python = Path(sys.executable)
    pythonw = python.with_name('pythonw.exe')
    subprocess.Popen([str(pythonw if pythonw.exists() else python), str(APP / 'scripts/serve-windows.py')],
                     cwd=APP, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)


def publish(deploy=DEPLOY, check=healthy, launch=start_supervisor, progress=lambda value: None,
            now=time.monotonic, sleep=time.sleep, timeout=180):
    """Reuse a healthy URL; otherwise recover via the supervisor, then verify HTTPS."""
    import msvcrt
    deploy.mkdir(parents=True, exist_ok=True)
    with (deploy / 'publisher.lock').open('a+b') as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('另一个发布窗口正在工作，请稍候查看该窗口。') from None
        try:
            start = now()
            progress('正在检查本机服务与当前 HTTPS 地址…')
            local_ok = check(LOCAL, timeout=3)
            origin = read_origin(deploy)
            if local_ok and origin and check(origin):
                return {'url': origin, 'reused': True, 'verifiedAt': time.time()}
            # The supervisor has its own exclusive lock; an existing one is reused.
            progress('正在启动或唤醒网站服务…')
            launch()
            server_repaired = tunnel_repaired = False
            public_failures = 0
            while now() - start < timeout:
                if not check(LOCAL, timeout=3):
                    if now() - start >= 20 and not server_repaired:
                        progress('本机服务未响应，正在请求恢复…')
                        request_repair(deploy, 'restart-server')
                        server_repaired = True
                    sleep(3)
                    continue
                origin = read_origin(deploy)
                if origin:
                    progress('本机已就绪，正在验证公网 HTTPS…')
                    if check(origin):
                        return {'url': origin, 'reused': False, 'verifiedAt': time.time()}
                    public_failures += 1
                else:
                    progress('正在等待公网连接分配地址…')
                # Give transient network failures and a freshly started tunnel time to settle.
                if not tunnel_repaired and now() - start >= 35 and (public_failures >= 3 or not origin):
                    progress('公网连接未响应，正在重新建立隧道…')
                    request_repair(deploy, 'restart-tunnel')
                    tunnel_repaired = True
                sleep(3)
            raise RuntimeError('暂未验证公网连通。请检查电脑网络，稍后重试；详见部署目录的 server.log 和 tunnel.log。')
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def main():
    if '--publish' in sys.argv:
        try:
            print(json.dumps(publish(), ensure_ascii=True))
        except Exception as error:
            print(json.dumps({'error': str(error)}, ensure_ascii=True))
            raise SystemExit(1)
        return
    import queue
    import threading
    import tkinter as tk
    from tkinter import ttk
    import webbrowser

    root = tk.Tk()
    root.title('知序 · 一键发布到公网')
    root.geometry('760x550')
    root.minsize(710, 540)
    root.configure(bg='#f4f6f1')
    root.option_add('*Font', ('Microsoft YaHei UI', 11))
    style = ttk.Style(root)
    style.theme_use('clam')
    style.configure('Publish.Horizontal.TProgressbar', background='#276653', troughcolor='#e1e9df')
    frame = tk.Frame(root, bg='#f4f6f1', padx=36, pady=26)
    frame.pack(fill='both', expand=True)
    tk.Label(frame, text='知序  /  公网发布', fg='#276653', bg='#f4f6f1', font=('Microsoft YaHei UI', 12, 'bold')).pack(anchor='w')
    tk.Label(frame, text='让同学随时找到你的刷题空间', fg='#182f27', bg='#f4f6f1', font=('Microsoft YaHei UI', 21, 'bold')).pack(anchor='w', pady=(14, 7))
    tk.Label(frame, text='自动检查网站、恢复连接，验证成功后显示 HTTPS 地址。', fg='#596a61', bg='#f4f6f1').pack(anchor='w')
    status = tk.StringVar(value='点击下方按钮，开始检查与发布。')
    url = tk.StringVar()
    events = queue.Queue()
    busy = False

    def begin():
        nonlocal busy
        if busy:
            return
        busy = True
        url.set('')
        copy_button.configure(state='disabled')
        open_button.configure(state='disabled')
        publish_button.configure(state='disabled', text='正在发布，请稍候…')
        bar.start(12)

        def work():
            try:
                result = publish(progress=lambda message: events.put(('progress', message)))
                events.put(('done', result))
            except Exception as error:
                events.put(('error', str(error)))
        threading.Thread(target=work, daemon=True).start()

    publish_button = tk.Button(frame, text='一键发布到公网', command=begin, bg='#276653', fg='white',
                               activebackground='#1e5142', activeforeground='white', relief='flat', padx=24, pady=12, cursor='hand2')
    publish_button.pack(anchor='w', pady=(24, 15))
    bar = ttk.Progressbar(frame, mode='indeterminate', style='Publish.Horizontal.TProgressbar')
    bar.pack(fill='x')
    tk.Label(frame, textvariable=status, wraplength=640, justify='left', fg='#3f5449', bg='#f4f6f1').pack(anchor='w', pady=(10, 14))
    ttk.Entry(frame, textvariable=url, state='readonly', font=('Consolas', 11)).pack(fill='x', ipady=7)
    actions = tk.Frame(frame, bg='#f4f6f1')
    actions.pack(fill='x', pady=(12, 12))

    def copy_url():
        root.clipboard_clear()
        root.clipboard_append(url.get())
        status.set('链接已复制，可以发给同学。')
    copy_button = ttk.Button(actions, text='复制公网链接', command=copy_url, state='disabled')
    copy_button.pack(side='left', padx=(0, 10))
    open_button = ttk.Button(actions, text='打开网站', command=lambda: webbrowser.open(url.get()), state='disabled')
    open_button.pack(side='left')
    ttk.Button(actions, text='本机访问', command=lambda: webbrowser.open(LOCAL)).pack(side='right')
    tk.Label(frame, text='电脑需保持开机联网。临时链接可能变化；下次从此入口获取最新地址。\n关闭此窗口不影响网站运行。服务器账号与记录保留。',
             justify='left', fg='#758078', bg='#f4f6f1', font=('Microsoft YaHei UI', 9)).pack(anchor='w')

    def poll():
        nonlocal busy
        try:
            while True:
                kind, value = events.get_nowait()
                if kind == 'progress':
                    status.set(value)
                else:
                    busy = False
                    bar.stop()
                    publish_button.configure(state='normal', text='再次检查 / 一键发布')
                    if kind == 'done':
                        url.set(value['url'])
                        status.set('公网 HTTPS 已验证，可以打开网站或复制链接。' + (' 已复用当前地址。' if value['reused'] else ''))
                        copy_button.configure(state='normal')
                        open_button.configure(state='normal')
                    else:
                        status.set('发布未完成：' + value)
        except queue.Empty:
            pass
        root.after(100, poll)
    root.after(100, poll)
    if '--auto' in sys.argv:
        root.after(300, begin)
    root.mainloop()


if __name__ == '__main__':
    main()
