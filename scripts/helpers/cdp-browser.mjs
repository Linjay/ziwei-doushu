import { writeFile } from 'node:fs/promises';
export class BrowserSession {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
      if (!message.id) return;
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new BrowserSession(socket);
  }
  static async page(port = 9333, context) {
    const info = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    const root = await BrowserSession.connect(info.webSocketDebuggerUrl);
    if (!context) context = (await root.send('Target.createBrowserContext')).browserContextId;
    const params = { url: 'about:blank', ...(context ? { browserContextId: context } : {}) };
    const { targetId } = await root.send('Target.createTarget', params); root.close();
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    const page = await BrowserSession.connect(targets.find(item => item.id === targetId).webSocketDebuggerUrl);
    await page.send('Page.enable'); await page.send('Runtime.enable'); return page;
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async wait(expression, timeout = 30000) {
    const end = Date.now() + timeout;
    do { if (await this.evaluate(`(async()=>Boolean(await (${expression})))()`)) return; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < end);
    throw new Error(`Browser condition timed out: ${expression}`);
  }
  async navigate(url) { await this.send('Page.navigate', { url }); await this.wait('document.readyState === "complete"'); }
  async fill(selector, value) {
    await this.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw new Error('Missing field'); const type=e instanceof HTMLTextAreaElement ? HTMLTextAreaElement : e instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  }
  async screenshot(file) { const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(file, Buffer.from(result.data, 'base64')); }
  async size(width, height, mobile = false) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
  close() { this.socket.close(); }
}
