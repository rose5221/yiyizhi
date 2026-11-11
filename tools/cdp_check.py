#!/usr/bin/env python3
"""用 CDP 驱动 headless Chromium：加载页面、收集 console 错误、执行交互、截图。

用法：
  python3 cdp_check.py shot <url> <out.png> [宽] [高]
  python3 cdp_check.py act  <url> <out_prefix> <json-actions>
"""
import base64
import json
import sys
import time
import urllib.request

import websocket  # websocket-client

CDP = 'http://127.0.0.1:9777'


def new_tab(url):
    req = urllib.request.Request(CDP + '/json/new?' + url, method='PUT')
    with urllib.request.urlopen(req) as r:
        return json.load(r)


class Tab:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, max_size=64 * 1024 * 1024)
        self.id = 0
        self.events = []

    def send(self, method, **params):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(method + ': ' + json.dumps(msg['error']))
                return msg.get('result', {})
            if 'method' in msg:
                self.events.append(msg)

    def drain(self, sec=0.6):
        end = time.time() + sec
        self.ws.settimeout(0.15)
        while time.time() < end:
            try:
                msg = json.loads(self.ws.recv())
                if 'method' in msg:
                    self.events.append(msg)
            except Exception:
                pass
        self.ws.settimeout(None)

    def eval(self, expr):
        r = self.send('Runtime.evaluate', expression=expr,
                      returnByValue=True, awaitPromise=True)
        if r.get('exceptionDetails'):
            return {'__error__': str(r['exceptionDetails'].get('text'))
                    + ' ' + str(r['exceptionDetails'].get('exception', {}).get('description'))[:400]}
        return r.get('result', {}).get('value')

    def shot(self, path):
        r = self.send('Page.captureScreenshot', format='png', captureBeyondViewport=False)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        return path


def console_errors(events):
    out = []
    for e in events:
        m = e.get('method')
        if m == 'Runtime.consoleAPICalled':
            if e['params'].get('type') in ('error', 'warning'):
                txt = ' '.join(str(a.get('value', a.get('description', '')))
                               for a in e['params'].get('args', []))
                out.append(('console.' + e['params']['type'], txt[:300]))
        elif m == 'Runtime.exceptionThrown':
            d = e['params'].get('exceptionDetails', {})
            out.append(('exception', (d.get('text', '') + ' '
                                      + str(d.get('exception', {}).get('description', '')))[:400]))
        elif m == 'Log.entryAdded':
            en = e['params'].get('entry', {})
            if en.get('level') in ('error', 'warning'):
                out.append(('log.' + en['level'], (en.get('text', '') + ' ' + str(en.get('url', '')))[:300]))
    return out


def main():
    mode = sys.argv[1]
    url = sys.argv[2]

    tab = new_tab(url)
    t = Tab(tab['webSocketDebuggerUrl'])
    t.send('Page.enable')
    t.send('Runtime.enable')
    t.send('Log.enable')
    if '--mobile' in sys.argv:
        t.send('Emulation.setDeviceMetricsOverride', width=390, height=844,
               deviceScaleFactor=3, mobile=True)
    else:
        W = int(sys.argv[4]) if (mode == 'shot' and len(sys.argv) > 4) else 1440
        H = int(sys.argv[5]) if (mode == 'shot' and len(sys.argv) > 5) else 900
        t.send('Emulation.setDeviceMetricsOverride', width=W, height=H,
               deviceScaleFactor=2, mobile=False)
    t.send('Page.navigate', url=url)
    time.sleep(2.2)
    t.drain(1.2)

    if mode == 'mobile':
        t.send('Emulation.setDeviceMetricsOverride', width=390, height=844,
               deviceScaleFactor=3, mobile=True)
        t.eval('window.dispatchEvent(new Event("resize"))')
        time.sleep(0.6)
        print('SHOT', t.shot(sys.argv[3]))
        print('ERRORS', json.dumps(console_errors(t.events), ensure_ascii=False)[:800])
        return

    if mode == 'shot':
        print('TITLE', t.eval('document.title'))
        print('ERRORS', json.dumps(console_errors(t.events), ensure_ascii=False)[:1500])
        print('SHOT', t.shot(sys.argv[3]))
        return

    # act 模式：按顺序执行动作
    actions = json.loads(sys.argv[3])
    prefix = sys.argv[4] if len(sys.argv) > 4 else '/tmp/yyzdump/act'
    results = []
    for a in actions:
        kind = a.get('do')
        if kind == 'eval':
            results.append({'eval': a['expr'][:60], 'value': t.eval(a['expr'])})
        elif kind == 'click':
            t.eval("(()=>{const e=document.querySelector(%s); if(!e) return 'MISSING'; e.click(); return 'ok';})()"
                   % json.dumps(a['sel']))
            results.append({'click': a['sel']})
        elif kind == 'key':
            for typ in ('keyDown', 'keyUp'):
                t.send('Input.dispatchKeyEvent', type=typ, key=a['key'],
                       code=a.get('code', a['key']), windowsVirtualKeyCode=a.get('vk', 0))
            results.append({'key': a['key']})
        elif kind == 'shot':
            p = prefix + '_' + a['name'] + '.png'
            t.shot(p)
            results.append({'shot': p})
        elif kind == 'wait':
            time.sleep(a.get('sec', 0.5))
        t.drain(0.35)

    print('RESULTS', json.dumps(results, ensure_ascii=False)[:4000])
    print('ERRORS', json.dumps(console_errors(t.events), ensure_ascii=False)[:2500])


if __name__ == '__main__':
    main()
