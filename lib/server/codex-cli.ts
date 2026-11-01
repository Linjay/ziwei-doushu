import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { CodexProtocol } from './codex-protocol';

export class LocalAIError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
  }
}

// Keep the limit across Next.js development reloads.
const globalState = globalThis as typeof globalThis & { mingliCodex?: { active: number } };
const state = globalState.mingliCodex ??= { active: 0 };

function cliCommand(): { command: string; prefix: string[] } {
  const configured = process.env.CODEX_CLI_PATH;
  if (configured) {
    if (!existsSync(configured) || /\.(cmd|bat|ps1)$/i.test(configured)) {
      throw new LocalAIError('CODEX_CLI_PATH 需要指向现有的 codex 可执行文件或 codex.js。', 503);
    }
    return /\.m?js$/i.test(configured)
      ? { command: process.execPath, prefix: [configured] }
      : { command: configured, prefix: [] };
  }

  const windows = process.platform === 'win32';
  const executable = windows ? 'codex.exe' : 'codex';
  const target = windows
    ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : process.platform === 'darwin'
      ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const platformPackage = `codex-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
  const directories = (process.env.PATH ?? '').split(path.delimiter);
  if (process.env.APPDATA) directories.push(path.join(process.env.APPDATA, 'npm'));

  for (const directory of directories.filter(Boolean)) {
    const packageRoot = path.join(directory, 'node_modules', '@openai', 'codex');
    const candidates = [
      path.join(directory, executable),
      path.join(packageRoot, 'node_modules', '@openai', platformPackage, 'vendor', target, 'bin', executable),
      path.join(packageRoot, 'vendor', target, 'bin', executable),
      path.join(packageRoot, 'vendor', target, 'codex', executable),
    ];
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) return { command: found, prefix: [] };
  }
  throw new LocalAIError('未找到本机 Codex CLI，请安装并执行 codex login，或设置 CODEX_CLI_PATH。', 503);
}

function friendlyFailure(details: string): string {
  if (/model_not_found|model.*not supported|model.*not found/i.test(details)) {
    return '当前 Codex 模型不可用，请在 .env.local 中设置可用的 CODEX_MODEL。';
  }
  if (/unauthorized|not logged|authentication|401|token.*expired/i.test(details)) {
    return 'Codex 登录已失效，请在本机终端执行 codex login 后重试。';
  }
  if (/rate.limit|quota|usage.limit|429/i.test(details)) {
    return 'Codex 当前额度或请求频率受限，请稍后重试。';
  }
  return '本机 Codex 执行失败，请先在终端确认 codex app-server 可以正常启动。';
}

/** Stream the installed CLI's app-server text notifications over SSE. */
export function codexResponse(prompt: string, signal: AbortSignal, references?: { footer?: string; status?: string }): Response {
  if (state.active >= 2) throw new LocalAIError('已有两个解读正在运行，请稍后重试。', 429);
  const launch = cliCommand();
  const args = [
    ...launch.prefix, 'app-server', '--listen', 'stdio://',
    '-c', 'approval_policy=never', '-c', 'features.shell_tool=false',
    '-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0',
  ];
  const model = process.env.CODEX_MODEL || undefined;
  if (model) args.push('-c', `model=${JSON.stringify(model)}`);
  const configuredEffort = process.env.CODEX_REASONING_EFFORT;
  const effort = configuredEffort && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(configuredEffort)
    ? configuredEffort : undefined;
  if (effort) {
    args.push('-c', `model_reasoning_effort=${effort}`);
  }
  const configuredTimeout = Number(process.env.CODEX_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 50
    ? Math.min(configuredTimeout, 900_000) : 180_000;
  const encoder = new TextEncoder();
  let cancel = () => {};
  state.active++;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      let disconnected = false;
      let readerCancelled = false;
      let replyReceived = false;
      let stderr = '';
      let outputBytes = 0;
      let child: ReturnType<typeof spawn> | undefined;
      let lines: ReturnType<typeof createInterface> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const emit = (data: unknown) => {
        if (!finished && !disconnected) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const finish = (error?: string, terminate = false) => {
        if (finished) return;
        if (error) emit({ error: { message: error } });
        if (!error && replyReceived && references?.footer) emit({ delta: { text: references.footer } });
        if (!disconnected) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        finished = true;
        clearInterval(heartbeat);
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        if (terminate && child && !child.killed) child.kill();
        lines?.close();
        state.active--;
        if (!readerCancelled) controller.close();
      };
      const onAbort = () => { disconnected = true; finish(undefined, true); };
      cancel = () => { readerCancelled = true; onAbort(); };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }

      try {
        const environment = { ...process.env };
        delete environment.CODEX_THREAD_ID;
        child = spawn(launch.command, args, {
          cwd: process.cwd(), env: environment, shell: false, windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        emit({ status: references?.status || '正在连接本机 Codex CLI…' });
        heartbeat = setInterval(() => {
          if (!finished && !disconnected) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 15_000);
        timeout = setTimeout(() => finish('本次解读超时，请重试或缩短问题。', true), timeoutMs);
        child.on('error', () => finish('无法启动 Codex CLI，请检查 CODEX_CLI_PATH 和本机安装。', true));
        child.stdin!.on('error', () => { /* An early CLI exit is reported by close. */ });
        child.stderr!.setEncoding('utf8');
        child.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });
        child.stdout!.on('data', (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > 8_000_000) finish('Codex 输出过长，请缩短问题后重试。', true);
        });
        const protocol = new CodexProtocol({
          prompt, model, effort, cwd: process.cwd(),
          send(message) { if (!finished) child!.stdin!.write(JSON.stringify(message) + '\n'); },
          onText(text) {
            if (!text) return;
            if (!replyReceived) emit({ status: '正在实时输出解读…' });
            replyReceived ||= Boolean(text.trim());
            emit({ delta: { text } });
          },
          onComplete() { finish(replyReceived ? undefined : 'Codex 未返回解读内容，请重试。', true); },
          onError(details) { finish(friendlyFailure(details + stderr), true); },
        });
        lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
        lines.on('line', line => {
          if (finished) return;
          let event;
          try { event = JSON.parse(line); } catch { return; }
          try { protocol.receive(event); }
          catch { finish('Codex 流式协议响应异常，请重试。', true); }
        });
        child.on('close', () => {
          if (finished) return;
          finish(replyReceived ? 'Codex 连接中断，已保留收到的解读。' : friendlyFailure(stderr));
        });
        protocol.start();
      } catch {
        finish('无法启动本机 Codex CLI。', true);
      }
    },
    cancel() { cancel(); },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
