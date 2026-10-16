"""User-session supervisor. Launched with pythonw; no terminal window or passwords."""
from pathlib import Path
import os, subprocess, time, msvcrt, re, winreg, json
from urllib.parse import urlsplit

APP=Path(__file__).resolve().parents[1]
DEPLOY=Path('E:/AAA数据库/知序服务器')
DEPLOY.mkdir(parents=True,exist_ok=True)
lock=(DEPLOY/'server.lock').open('a+')
try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
except OSError:raise SystemExit(0)
stop=DEPLOY/'stop.request'; stop.unlink(missing_ok=True)
env=os.environ.copy()
env.update(STUDY_DATA_DIR=str(DEPLOY/'data'),PORT='4317',NODE_ENV='production')
(DEPLOY/'supervisor.pid').write_text(str(os.getpid()))
node=Path('C:/Program Files/node.exe')
child=None; tunnel=None; current_origin=None
fixed_file=DEPLOY/'fixed-tunnel.json'
fixed_origin=''; token_file=None
if fixed_file.exists():
    fixed=json.loads(fixed_file.read_text(encoding='utf-8-sig'))
    url=urlsplit(fixed['publicOrigin'])
    if url.scheme!='https' or not url.hostname or '.' not in url.hostname or url.username or url.password or url.path not in ('','/') or url.query or url.fragment or url.hostname.endswith('.trycloudflare.com'):
        raise ValueError('Invalid fixed public origin')
    fixed_origin=fixed['publicOrigin'].rstrip('/')
    token_file=Path(fixed['tokenFile']).resolve(strict=True)
    if not token_file.is_file():raise ValueError('Tunnel token file missing')
    (DEPLOY/'public-origin.txt').write_text(fixed_origin)

cloudflared=Path('C:/Users/28058/AppData/Local/AgentDock/bin/cloudflared.exe')
try:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
        desktop=Path(os.path.expandvars(winreg.QueryValueEx(key,'Desktop')[0]))
except OSError:desktop=Path(os.environ['USERPROFILE'])/'Desktop'
with (DEPLOY/'server.log').open('ab',buffering=0) as log:
    while not stop.exists():
        origin_file=DEPLOY/'public-origin.txt'
        origin=origin_file.read_text().strip() if origin_file.exists() else ''
        if origin!=current_origin and child and child.poll() is None:
            child.terminate(); child.wait(timeout=15); child=None
        current_origin=origin;env['STUDY_PUBLIC_ORIGIN']=origin
        if child is None or child.poll() is not None:
            child=subprocess.Popen([str(node),'--import','tsx','server/index.ts'],cwd=APP,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
            (DEPLOY/'server.pid').write_text(str(child.pid))
        if tunnel is None or tunnel.poll() is not None:
            if not fixed_origin:origin_file.unlink(missing_ok=True)
            tunnel_log=DEPLOY/'tunnel.log'; tunnel_log.write_text('')
            with tunnel_log.open('ab') as out:
                tunnel_args=[str(cloudflared),'tunnel','--no-autoupdate','run','--token-file',str(token_file)] if fixed_origin else [str(cloudflared),'tunnel','--url','http://127.0.0.1:4317','--no-autoupdate']
                tunnel=subprocess.Popen(tunnel_args,stdin=subprocess.DEVNULL,stdout=out,stderr=out,creationflags=subprocess.CREATE_NO_WINDOW)
        if fixed_origin:
            (DEPLOY/'知序访问地址.txt').write_text('本机管理：http://127.0.0.1:4317\n固定外网地址：'+fixed_origin+'\n电脑需保持在线。\n',encoding='utf-8-sig')
            if desktop.exists():(desktop/'知序外网地址.url').write_text('[InternetShortcut]\nURL='+fixed_origin+'\n',encoding='utf-8')
        elif tunnel and tunnel.poll() is None:
            urls=re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',(DEPLOY/'tunnel.log').read_text(errors='replace'))
            if urls and not origin_file.exists():
                origin_file.write_text(urls[-1])
                (DEPLOY/'知序访问地址.txt').write_text('本机管理：http://127.0.0.1:4317\n外网同学访问：'+urls[-1]+'\n临时地址可能在服务重启后变化。\n',encoding='utf-8-sig')
                if desktop.exists():(desktop/'知序外网地址.url').write_text('[InternetShortcut]\nURL='+urls[-1]+'\n',encoding='utf-8')
        elif tunnel and 'trycloudflare.com' in origin:
            origin_file.unlink(missing_ok=True)
        time.sleep(5)
    if child and child.poll() is None:
        child.terminate()
        try:child.wait(timeout=15)
        except subprocess.TimeoutExpired:child.kill()
    if tunnel and tunnel.poll() is None:tunnel.terminate()
(DEPLOY/'supervisor.pid').unlink(missing_ok=True)
(DEPLOY/'server.pid').unlink(missing_ok=True)
