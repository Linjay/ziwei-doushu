type ProtocolOptions = {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  send: (message: object) => void;
  onText: (delta: string) => void;
  onComplete: () => void;
  onError: (details: string) => void;
};

/** The installed CLI's app-server stdio protocol, not exec's final-only JSONL. */
export class CodexProtocol {
  private expectedResponse = 1;
  private threadId = '';
  private turnId = '';
  private closed = false;
  private textByItem = new Map<string, string>();
  private completedItems = new Set<string>();

  constructor(private readonly options: ProtocolOptions) {}

  start() {
    this.options.send({
      id: 1, method: 'initialize',
      params: { clientInfo: { name: 'mingli_local', title: '本地命盘解读', version: '0.1.0' }, capabilities: null },
    });
  }

  private fail(message: string) {
    if (this.closed) return;
    this.closed = true;
    this.options.onError(message);
  }

  receive(message: unknown) {
    if (this.closed || !message || typeof message !== 'object') return;
    const event = message as Record<string, any>;
    // This text-only integration never accepts tool or approval requests.
    if (event.method && event.id !== undefined) {
      this.options.send({ id: event.id, error: { code: -32601, message: 'Tools are disabled for chart interpretation.' } });
      this.fail('Codex requested an unsupported tool or approval');
      return;
    }
    if (event.id !== undefined) {
      if (event.id !== this.expectedResponse) return;
      if (event.error) { this.fail(String(event.error.message ?? 'Codex protocol error')); return; }
      if (event.id === 1) {
        this.expectedResponse = 2;
        this.options.send({ method: 'initialized', params: {} });
        this.options.send({
          id: 2, method: 'thread/start',
          params: {
            cwd: this.options.cwd, model: this.options.model,
            approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
          },
        });
      } else if (event.id === 2) {
        if (typeof event.result?.thread?.id !== 'string') { this.fail('Missing Codex thread id'); return; }
        this.threadId = event.result.thread.id;
        this.expectedResponse = 3;
        this.options.send({
          id: 3, method: 'turn/start',
          params: {
            threadId: this.threadId, effort: this.options.effort,
            input: [{ type: 'text', text: this.options.prompt, text_elements: [] }],
          },
        });
      } else if (event.id === 3) {
        this.turnId = event.result?.turn?.id ?? this.turnId;
      }
      return;
    }

    const params = event.params;
    if (!this.threadId || params?.threadId !== this.threadId) return;
    if (event.method === 'turn/started') {
      if (typeof params.turn?.id === 'string') this.turnId = params.turn.id;
      return;
    }
    const notificationTurn = params.turnId ?? params.turn?.id;
    if (this.turnId && notificationTurn !== this.turnId) return;

    if (event.method === 'item/agentMessage/delta') {
      if (typeof params.itemId !== 'string' || typeof params.delta !== 'string' || this.completedItems.has(params.itemId)) return;
      this.textByItem.set(params.itemId, (this.textByItem.get(params.itemId) ?? '') + params.delta);
      this.options.onText(params.delta);
    } else if (event.method === 'item/completed' && params.item?.type === 'agentMessage') {
      const { id, text } = params.item;
      if (typeof id !== 'string' || typeof text !== 'string' || this.completedItems.has(id)) return;
      const streamed = this.textByItem.get(id) ?? '';
      if (!text.startsWith(streamed)) { this.fail('Codex stream and final text differ'); return; }
      // A completed snapshot may repeat all text or contain a final unsent suffix.
      const tail = text.slice(streamed.length);
      if (tail) this.options.onText(tail);
      this.textByItem.set(id, text);
      this.completedItems.add(id);
    } else if (event.method === 'turn/completed') {
      if (params.turn?.status !== 'completed') {
        this.fail(String(params.turn?.error?.message ?? `Codex turn ${params.turn?.status}`));
      } else {
        this.closed = true;
        this.options.onComplete();
      }
    } else if (event.method === 'error' && !params.willRetry) {
      this.fail(String(params.error?.message ?? 'Codex failed'));
    }
    // Reasoning, tool output and legacy duplicate events are never displayed.
  }
}
