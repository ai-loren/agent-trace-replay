(() => {
  'use strict';

  const MAX_CHARS = 2_000_000;
  const MAX_LINES = 5000;

  const trace = (...events) => events.map((event) => JSON.stringify(event)).join('\n');
  const SAMPLES = [
    {
      id: 'oom',
      title: '排查训练 OOM',
      summary: '读日志、看配置、改一行、dry-run 验证，一轮完成。',
      jsonl: trace(
        { t: 0, type: 'session.started', agent: 'infra-assistant', model: 'claude-sonnet', task: '训练任务 job-7f3a 第 3 次重试仍然 OOM，查原因并给出能跑的配置' },
        { t: 0, type: 'turn.started', turn: 1, prompt: '训练任务 job-7f3a 第 3 次重试仍然 OOM，查原因并给出能跑的配置' },
        { t: 2.1, type: 'thinking', text: '先看最近一次失败的日志，确认是在哪一步 OOM。' },
        { t: 2.4, type: 'tool.call', id: 'call-1', name: 'eden-cli', input: { args: ['job', 'trial-logs', 'search', '--trial', 'job-7f3a-t3', '--query', 'CUDA out of memory'] } },
        { t: 5.0, type: 'tool.result', toolCallId: 'call-1', ok: true, output: 'step 1 rank 0: torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.50 GiB (GPU 0; 79.35 GiB total; 77.12 GiB already allocated)' },
        { t: 7.3, type: 'thinking', text: '第一步就 OOM，不是显存泄漏，是配置本身放不下。看一下训练配置。' },
        { t: 7.6, type: 'tool.call', id: 'call-2', name: 'read_file', input: { path: 'configs/pretrain-8b.yaml' } },
        { t: 7.9, type: 'tool.result', toolCallId: 'call-2', ok: true, output: 'model: llama3-8b\nseq_len: 8192\nmicro_batch: 2\ntp: 1\npp: 1\ndp: 8\nzero: 1\nrecompute: none' },
        { t: 10.2, type: 'thinking', text: '序列 8192、micro-batch 2、不重算：按显存账本估算每卡约 117 GiB，远超 80 GB。打开全量重算最省事。' },
        { t: 10.6, type: 'tool.call', id: 'call-3', name: 'edit_file', input: { path: 'configs/pretrain-8b.yaml', replace: { 'recompute: none': 'recompute: full' } } },
        { t: 10.8, type: 'tool.result', toolCallId: 'call-3', ok: true, output: 'configs/pretrain-8b.yaml：改了 1 处' },
        { t: 11.0, type: 'tool.call', id: 'call-4', name: 'eden-cli', input: { args: ['job', 'runs', 'rerun', 'job-7f3a', '--config', 'configs/pretrain-8b.yaml', '--dry-run'] } },
        { t: 13.4, type: 'tool.result', toolCallId: 'call-4', ok: true, output: 'dry-run 通过：预计每卡显存 55.3 GiB / 80 GiB' },
        { t: 15.0, type: 'message', role: 'assistant', text: '原因：序列 8192、micro-batch 2 且没开激活重计算，第一步就超出显存。已把 recompute 改成 full，dry-run 预计每卡 55.3 GiB。要我正式重跑吗？' },
        { t: 15.1, type: 'turn.completed', turn: 1, usage: { inputTokens: 18420, outputTokens: 1260 } },
        { t: 15.1, type: 'session.completed', summary: '找到 OOM 原因，给出能跑的配置' },
      ),
    },
    {
      id: 'denied',
      title: '强推被拦下后换路',
      summary: '想强推 main 被人拒绝，改成新分支 + 合并请求。',
      jsonl: trace(
        { t: 0, type: 'session.started', agent: 'infra-assistant', model: 'claude-sonnet', task: '把 release/2.3 上的两个热修复同步到 main，CI 要绿' },
        { t: 0, type: 'turn.started', turn: 1, prompt: '把 release/2.3 上的两个热修复同步到 main，CI 要绿' },
        { t: 1.8, type: 'thinking', text: '先看两个分支差哪些提交。' },
        { t: 2.0, type: 'tool.call', id: 'call-1', name: 'bash', input: { command: 'git log --oneline main..release/2.3' } },
        { t: 2.6, type: 'tool.result', toolCallId: 'call-1', ok: true, output: 'a41c9e2 fix: guard empty batch in eval loader\n7d02f11 fix: retry on NCCL timeout' },
        { t: 4.1, type: 'thinking', text: 'main 上有一个会冲突的提交，直接 rebase 后强推最快。' },
        { t: 4.3, type: 'tool.call', id: 'call-2', name: 'bash', input: { command: 'git rebase release/2.3 && git push --force origin main' } },
        { t: 4.4, type: 'permission.requested', toolCallId: 'call-2', risk: 'high', reason: '会改写共享分支 main 的历史（git push --force）' },
        { t: 31.0, type: 'permission.decided', toolCallId: 'call-2', decision: 'denied', by: 'user', reason: 'main 不允许强推，走合并请求' },
        { t: 31.2, type: 'tool.result', toolCallId: 'call-2', ok: false, output: '没有执行：用户拒绝。main 不允许强推，走合并请求' },
        { t: 33.0, type: 'thinking', text: '不能改写 main 的历史。改成在新分支上 cherry-pick 这两个修复，再开合并请求。' },
        { t: 33.3, type: 'tool.call', id: 'call-3', name: 'bash', input: { command: 'git switch -c sync/release-2.3 main && git cherry-pick a41c9e2 7d02f11' } },
        { t: 34.1, type: 'tool.result', toolCallId: 'call-3', ok: true, output: '[sync/release-2.3 c5e1b07] fix: guard empty batch in eval loader\n[sync/release-2.3 9fa2d33] fix: retry on NCCL timeout' },
        { t: 34.5, type: 'tool.call', id: 'call-4', name: 'bash', input: { command: 'git push origin sync/release-2.3' } },
        { t: 34.6, type: 'permission.requested', toolCallId: 'call-4', risk: 'medium', reason: '推送一个新分支到远端' },
        { t: 41.2, type: 'permission.decided', toolCallId: 'call-4', decision: 'approved', by: 'user' },
        { t: 42.9, type: 'tool.result', toolCallId: 'call-4', ok: true, output: '* [new branch] sync/release-2.3 -> sync/release-2.3' },
        { t: 43.4, type: 'tool.call', id: 'call-5', name: 'create_merge_request', input: { source: 'sync/release-2.3', target: 'main', title: '同步 release/2.3 的两个热修复' } },
        { t: 44.8, type: 'tool.result', toolCallId: 'call-5', ok: true, output: '合并请求 !482 已创建，CI 运行中' },
        { t: 46.0, type: 'message', role: 'assistant', text: '没有强推 main。两个热修复已经 cherry-pick 到 sync/release-2.3，并开了合并请求 !482，CI 跑完就能合。' },
        { t: 46.1, type: 'turn.completed', turn: 1, usage: { inputTokens: 21730, outputTokens: 1480 } },
        { t: 46.1, type: 'session.completed', summary: '热修复经合并请求同步到 main，没有改写历史' },
      ),
    },
    {
      id: 'resumed',
      title: '中断后从存档续跑',
      summary: '评测跑到一半节点被抢占，从最近的存档接着跑。',
      jsonl: trace(
        { t: 0, type: 'session.started', agent: 'eval-runner', model: 'claude-sonnet', task: '在 1,000 道数学题上评测 ckpt-0930，汇总准确率' },
        { t: 0, type: 'turn.started', turn: 1, prompt: '在 1,000 道数学题上评测 ckpt-0930，汇总准确率' },
        { t: 1.5, type: 'thinking', text: '1,000 题要跑一阵。每 200 题存一次进度，断了可以接着跑。' },
        { t: 1.8, type: 'tool.call', id: 'call-1', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [0, 200] } },
        { t: 182.0, type: 'tool.result', toolCallId: 'call-1', ok: true, output: '第 0–199 题：正确 151 / 200' },
        { t: 182.2, type: 'checkpoint.saved', label: 'eval-200', note: '已完成 200 题，正确 151' },
        { t: 182.6, type: 'tool.call', id: 'call-2', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [200, 400] } },
        { t: 365.1, type: 'tool.result', toolCallId: 'call-2', ok: true, output: '第 200–399 题：正确 147 / 200' },
        { t: 365.3, type: 'checkpoint.saved', label: 'eval-400', note: '已完成 400 题，正确 298' },
        { t: 365.7, type: 'tool.call', id: 'call-3', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [400, 600] } },
        { t: 448.0, type: 'session.interrupted', reason: '所在节点被抢占（spot 实例回收）' },
        { t: 512.0, type: 'session.resumed', from: 'eval-400', note: '换到新节点，第 400–599 题重新跑' },
        { t: 512.4, type: 'tool.call', id: 'call-4', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [400, 600] } },
        { t: 690.2, type: 'tool.result', toolCallId: 'call-4', ok: true, output: '第 400–599 题：正确 155 / 200' },
        { t: 690.4, type: 'checkpoint.saved', label: 'eval-600', note: '已完成 600 题，正确 453' },
        { t: 690.8, type: 'tool.call', id: 'call-5', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [600, 800] } },
        { t: 871.5, type: 'tool.result', toolCallId: 'call-5', ok: true, output: '第 600–799 题：正确 149 / 200' },
        { t: 871.7, type: 'checkpoint.saved', label: 'eval-800', note: '已完成 800 题，正确 602' },
        { t: 871.9, type: 'tool.call', id: 'call-6', name: 'run_eval', input: { suite: 'math-1000', model: 'ckpt-0930', range: [800, 1000] } },
        { t: 1052.3, type: 'tool.result', toolCallId: 'call-6', ok: true, output: '第 800–999 题：正确 152 / 200' },
        { t: 1053.0, type: 'message', role: 'assistant', text: '1,000 题全部跑完，正确 754 题，准确率 75.4%。中途节点被抢占一次，从第 400 题的存档接着跑，只重跑了中断的那一段。' },
        { t: 1053.1, type: 'turn.completed', turn: 1, usage: { inputTokens: 9850, outputTokens: 940 } },
        { t: 1053.1, type: 'session.completed', summary: '评测完成，准确率 75.4%' },
      ),
    },
  ];

  const describeValue = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

  // 每行一个 JSON 对象，必须有数字 t（距开始的秒数，不能倒退）和字符串 type；其余字段按 type 解释，不认识的 type 原样展示。
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) return { error: '没有读到内容。粘贴 JSONL：每行一个事件，至少带 t（秒）和 type 两个字段。' };
    if (text.length > MAX_CHARS) return { error: `轨迹有 ${text.length.toLocaleString('en-US')} 个字符，超过上限 ${MAX_CHARS.toLocaleString('en-US')}。截取其中一段再粘贴。` };
    const lines = text.split(/\r?\n/);
    const events = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      const where = `第 ${index + 1} 行`;
      if (events.length >= MAX_LINES) return { error: `事件超过 ${MAX_LINES} 条（到${where}为止）。截取其中一段再粘贴。` };
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        return { error: `${where}不是合法的 JSON：${error.message}。每行应当是一个完整的 JSON 对象，例如 {"t": 0, "type": "turn.started"}。` };
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return { error: `${where}应当是一个 JSON 对象，现在是${Array.isArray(event) ? '数组' : ` ${describeValue(event)}`}。把这一行改成 {"t": …, "type": …} 的形式。` };
      if (typeof event.type !== 'string' || !event.type) return { error: `${where}缺少字符串字段 type，现在是 ${describeValue(event.type)}。加上事件类型，例如 "type": "tool.call"。` };
      if (typeof event.t !== 'number' || !Number.isFinite(event.t) || event.t < 0) return { error: `${where}的 t 应当是不小于 0 的秒数，现在是 ${describeValue(event.t)}。填这一步距离开始过了多少秒。` };
      const previous = events[events.length - 1];
      if (previous && event.t < previous.t) return { error: `${where}的 t=${event.t} 早于上一条的 t=${previous.t}。事件要按时间顺序排列。` };
      events.push(event);
    }
    if (!events.length) return { error: '只有空行。粘贴 JSONL：每行一个事件，至少带 t（秒）和 type 两个字段。' };
    return { events };
  }

  const compact = (value) => {
    if (value && Array.isArray(value.args)) return value.args.join(' ');
    if (value && typeof value.command === 'string') return value.command;
    if (value && typeof value.path === 'string' && Object.keys(value).length === 1) return value.path;
    const text = JSON.stringify(value) ?? '';
    return text.length > 90 ? `${text.slice(0, 89)}…` : text;
  };
  const textOf = (value) => (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2));

  // 把事件串成时间线：按 id 把调用、授权和结果连起来，算出等授权等了多久，并给每一步一个状态，供界面着色。
  function timeline(events) {
    const calls = new Map();
    const asked = new Map();
    const decided = new Map();
    return events.map((event, index) => {
      const call = calls.get(event.toolCallId);
      const name = call?.name ?? event.toolCallId ?? '工具';
      const item = { index, t: event.t, type: event.type, status: 'info', title: event.type, text: '', fields: [], raw: event };
      switch (event.type) {
        case 'session.started':
          Object.assign(item, { status: 'start', title: '开始', text: event.task ?? '' });
          item.fields = [['Agent', event.agent], ['模型', event.model]];
          break;
        case 'turn.started':
          Object.assign(item, { title: `第 ${event.turn ?? '?'} 轮开始`, text: event.prompt ?? '' });
          break;
        case 'thinking':
          Object.assign(item, { status: 'think', title: '思考', text: event.text ?? '' });
          break;
        case 'message':
          Object.assign(item, { status: event.role === 'user' ? 'user' : 'reply', title: event.role === 'user' ? '用户' : '回复', text: event.text ?? '' });
          break;
        case 'tool.call':
          calls.set(event.id, { name: event.name, t: event.t });
          Object.assign(item, { status: 'call', title: `调用 ${event.name ?? '工具'}`, text: compact(event.input) });
          item.fields = [['调用 id', event.id], ['参数', textOf(event.input)]];
          break;
        case 'permission.requested':
          asked.set(event.toolCallId, event.t);
          Object.assign(item, { status: 'ask', title: `请求授权：${name}`, text: event.reason ?? '' });
          item.fields = [['风险', { high: '高', medium: '中', low: '低' }[event.risk] ?? event.risk], ['调用 id', event.toolCallId]];
          break;
        case 'permission.decided': {
          const approved = event.decision === 'approved';
          decided.set(event.toolCallId, event.decision);
          const waited = asked.has(event.toolCallId) ? event.t - asked.get(event.toolCallId) : undefined;
          Object.assign(item, { status: approved ? 'ok' : 'denied', title: approved ? `已批准：${name}` : `被拒绝：${name}`, text: event.reason ?? '' });
          item.fields = [['决定人', { user: '用户', policy: '策略' }[event.by] ?? event.by], ['等待', waited === undefined ? undefined : clock(waited, true)]];
          break;
        }
        case 'tool.result': {
          const denied = decided.get(event.toolCallId) === 'denied';
          Object.assign(item, { status: event.ok ? 'ok' : denied ? 'denied' : 'error', title: event.ok ? `${name} 返回` : denied ? `${name} 没有执行` : `${name} 失败`, text: textOf(event.output).split('\n')[0] });
          item.fields = [['耗时', call ? clock(event.t - call.t, true) : undefined], ['输出', textOf(event.output)]];
          calls.delete(event.toolCallId);
          break;
        }
        case 'checkpoint.saved':
          Object.assign(item, { status: 'save', title: `存档：${event.label ?? ''}`, text: event.note ?? '' });
          break;
        case 'session.interrupted': {
          const pending = [...calls.values()].map((entry) => entry.name);
          Object.assign(item, { status: 'interrupt', title: '中断', text: event.reason ?? '' });
          item.fields = [['被打断的调用', pending.length ? pending.join('、') : undefined]];
          calls.clear();
          break;
        }
        case 'session.resumed':
          Object.assign(item, { status: 'resume', title: `从 ${event.from ?? '存档'} 恢复`, text: event.note ?? '' });
          break;
        case 'turn.completed':
          Object.assign(item, { title: `第 ${event.turn ?? '?'} 轮结束`, text: event.usage ? `输入 ${grouped(event.usage.inputTokens)} · 输出 ${grouped(event.usage.outputTokens)} tokens` : '' });
          break;
        case 'turn.failed':
          Object.assign(item, { status: 'error', title: `第 ${event.turn ?? '?'} 轮失败`, text: textOf(event.error) });
          break;
        case 'session.completed':
          Object.assign(item, { status: 'done', title: '完成', text: event.summary ?? '' });
          break;
        default:
          item.text = compact(Object.fromEntries(Object.entries(event).filter(([key]) => key !== 't' && key !== 'type')));
      }
      item.fields = item.fields.filter(([, value]) => value !== undefined && value !== '');
      return item;
    });
  }

  function summarize(events) {
    const count = (type, test = () => true) => events.filter((event) => event.type === type && test(event)).length;
    const results = new Set(events.filter((event) => event.type === 'tool.result').map((event) => event.toolCallId));
    const denied = new Set(events.filter((event) => event.type === 'permission.decided' && event.decision === 'denied').map((event) => event.toolCallId));
    const usage = events.filter((event) => event.type === 'turn.completed' && event.usage).map((event) => event.usage);
    return {
      duration: events.length ? events[events.length - 1].t - events[0].t : 0,
      steps: events.length,
      turns: count('turn.started'),
      toolCalls: count('tool.call'),
      toolFailures: count('tool.result', (event) => !event.ok && !denied.has(event.toolCallId)),
      unfinished: count('tool.call', (event) => !results.has(event.id)),
      permissions: { requested: count('permission.requested'), approved: count('permission.decided', (event) => event.decision === 'approved'), denied: denied.size },
      checkpoints: count('checkpoint.saved'),
      interruptions: count('session.interrupted'),
      tokens: { input: usage.reduce((sum, entry) => sum + (entry.inputTokens || 0), 0), output: usage.reduce((sum, entry) => sum + (entry.outputTokens || 0), 0) },
    };
  }

  const grouped = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '?');

  function clock(seconds, spoken = false) {
    const whole = Math.round(seconds * 10) / 10;
    if (spoken) {
      if (whole < 60) return `${whole} 秒`;
      const minutes = Math.floor(whole / 60);
      const rest = Math.round(whole - minutes * 60);
      return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
    }
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : `+${m}:${s}`;
  }

  const SPEEDS = [1, 2, 4];
  let remembered = { source: SAMPLES[0].id, text: '', index: 0, speed: 1 };

  function mount(root) {
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    root.innerHTML = `
      <div class="trace" tabindex="-1">
        <div class="trace-samples" role="group" aria-label="示例轨迹">
          ${SAMPLES.map((sample) => `<button type="button" class="trace-sample" data-sample="${sample.id}"><b>${sample.title}</b><span>${sample.summary}</span></button>`).join('')}
          <button type="button" class="trace-sample" data-sample="custom" hidden><b>自己的轨迹</b><span>刚才粘贴或打开的那份</span></button>
        </div>
        <ul class="trace-stats" data-out="stats"></ul>
        <div class="trace-controls">
          <button type="button" class="trace-button" data-act="prev" aria-label="上一步">◀</button>
          <button type="button" class="trace-button is-play" data-act="play" aria-label="播放">▶</button>
          <button type="button" class="trace-button" data-act="next" aria-label="下一步">▶▶</button>
          <button type="button" class="trace-button trace-speed" data-act="speed" aria-label="播放速度">1×</button>
          <input class="trace-scrub" type="range" min="0" value="0" step="1" aria-label="回放进度">
          <span class="trace-position" data-out="position"></span>
        </div>
        <div class="trace-body">
          <ol class="trace-steps" data-out="steps"></ol>
          <section class="trace-detail" data-out="detail" aria-live="polite"></section>
        </div>
        <details class="trace-load">
          <summary>回放自己的轨迹</summary>
          <p class="trace-hint">每行一个 JSON 事件，至少带 <code>t</code>（距开始的秒数）和 <code>type</code>。内容只在这个页面里解析和显示，不会上传，也不会被当成网页代码执行。</p>
          <textarea class="trace-input" rows="6" spellcheck="false" placeholder='{"t": 0, "type": "turn.started", "turn": 1, "prompt": "…"}'></textarea>
          <div class="trace-load-actions">
            <button type="button" class="trace-button is-primary" data-act="load">回放这段</button>
            <label class="trace-file"><input type="file" accept=".jsonl,.json,.txt,application/json,text/plain"><span>打开文件</span></label>
          </div>
          <p class="trace-error" role="alert" data-out="error" hidden></p>
        </details>
      </div>`;

    const box = root.querySelector('.trace');
    const out = (name) => root.querySelector(`[data-out="${name}"]`);
    const scrub = root.querySelector('.trace-scrub');
    const input = root.querySelector('.trace-input');
    let items = [];
    let index = 0;
    let timer = 0;

    const stopPlaying = () => {
      clearInterval(timer);
      timer = 0;
      const play = root.querySelector('[data-act="play"]');
      play.textContent = '▶';
      play.setAttribute('aria-label', '播放');
    };

    const show = (next) => {
      index = Math.max(0, Math.min(items.length - 1, next));
      remembered.index = index;
      scrub.value = String(index);
      const item = items[index];
      out('position').textContent = `第 ${index + 1} / ${items.length} 步 · ${clock(item.t)}`;
      out('steps').querySelectorAll('li').forEach((node, position) => {
        node.classList.toggle('is-current', position === index);
        node.classList.toggle('is-future', position > index);
        if (position === index) node.setAttribute('aria-current', 'step');
        else node.removeAttribute('aria-current');
      });
      const current = out('steps').children[index];
      const list = out('steps');
      if (current.offsetTop < list.scrollTop || current.offsetTop + current.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = current.offsetTop - list.clientHeight / 2 + current.offsetHeight / 2;
      }
      const detail = out('detail');
      detail.replaceChildren();
      detail.dataset.status = item.status;
      const head = el('p', 'trace-detail-head');
      head.append(el('span', 'trace-tag', item.type), el('span', 'trace-time', clock(item.t)));
      detail.append(head, el('h4', 'trace-detail-title', item.title));
      if (item.text && !item.fields.some(([label]) => label === '输出')) detail.append(el('p', 'trace-detail-text', item.text));
      if (item.fields.length) {
        const list = el('dl', 'trace-fields');
        for (const [label, value] of item.fields) {
          const block = /\n/.test(value) || label === '参数' || label === '输出';
          const cell = el('dd', block ? 'is-block' : '');
          if (block) cell.append(el('pre', '', value));
          else cell.textContent = value;
          list.append(el('dt', '', label), cell);
        }
        detail.append(list);
      }
      if (index === items.length - 1) stopPlaying();
    };

    const load = (events, source) => {
      stopPlaying();
      items = timeline(events);
      const stats = summarize(events);
      const chips = [
        `${stats.steps} 步`, `${stats.turns} 轮`, clock(stats.duration, true),
        `${stats.toolCalls} 次工具调用`,
        stats.toolFailures ? `${stats.toolFailures} 次失败` : '',
        stats.permissions.requested ? `授权 ${stats.permissions.requested} 次（批准 ${stats.permissions.approved} · 拒绝 ${stats.permissions.denied}）` : '',
        stats.interruptions ? `中断 ${stats.interruptions} 次` : '',
        stats.checkpoints ? `存档 ${stats.checkpoints} 次` : '',
        stats.tokens.input || stats.tokens.output ? `${grouped(stats.tokens.input + stats.tokens.output)} tokens` : '',
      ].filter(Boolean);
      out('stats').replaceChildren(...chips.map((chip) => el('li', '', chip)));
      out('steps').replaceChildren(...items.map((item, position) => {
        const node = el('li', `trace-step is-${item.status}`);
        node.dataset.index = String(position);
        node.tabIndex = -1;
        node.append(el('span', 'trace-time', clock(item.t)), el('b', '', item.title));
        if (item.text) node.append(el('span', 'trace-step-text', item.text));
        return node;
      }));
      scrub.max = String(items.length - 1);
      root.querySelectorAll('[data-sample]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sample === source)));
      root.querySelector('[data-sample="custom"]').hidden = !remembered.text;
      remembered.source = source;
      show(Math.min(remembered.index, items.length - 1));
    };

    const loadSample = (id) => {
      remembered.index = 0;
      load(parse(SAMPLES.find((sample) => sample.id === id).jsonl).events, id);
    };

    const loadCustom = (text) => {
      const parsed = parse(text);
      if (parsed.error) {
        out('error').textContent = parsed.error;
        out('error').hidden = false;
        return false;
      }
      out('error').hidden = true;
      remembered.text = text;
      remembered.index = 0;
      load(parsed.events, 'custom');
      return true;
    };

    const play = () => {
      if (timer) {
        stopPlaying();
        return;
      }
      if (index >= items.length - 1) show(0);
      const button = root.querySelector('[data-act="play"]');
      button.textContent = '❚❚';
      button.setAttribute('aria-label', '暂停');
      timer = setInterval(() => show(index + 1), 900 / remembered.speed);
    };

    box.addEventListener('click', (event) => {
      const sample = event.target.closest('[data-sample]');
      if (sample) {
        if (sample.dataset.sample === 'custom') loadCustom(remembered.text);
        else loadSample(sample.dataset.sample);
        return;
      }
      const step = event.target.closest('.trace-step');
      if (step) {
        stopPlaying();
        show(Number(step.dataset.index));
        return;
      }
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (action === 'prev') { stopPlaying(); show(index - 1); }
      if (action === 'next') { stopPlaying(); show(index + 1); }
      if (action === 'play') play();
      if (action === 'speed') {
        remembered.speed = SPEEDS[(SPEEDS.indexOf(remembered.speed) + 1) % SPEEDS.length];
        event.target.textContent = `${remembered.speed}×`;
        if (timer) { stopPlaying(); play(); }
      }
      if (action === 'load') loadCustom(input.value);
    });
    scrub.addEventListener('input', () => { stopPlaying(); show(Number(scrub.value)); });
    root.querySelector('.trace-file input').addEventListener('change', async (event) => {
      const [file] = event.target.files;
      if (!file) return;
      if (file.size > MAX_CHARS * 4) {
        out('error').textContent = `文件有 ${file.size.toLocaleString('en-US')} 字节，太大了。截取其中一段再打开。`;
        out('error').hidden = false;
        return;
      }
      const text = await file.text();
      input.value = text;
      loadCustom(text);
      event.target.value = '';
    });
    box.addEventListener('keydown', (event) => {
      if (event.target.closest('textarea, input, select, summary')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); stopPlaying(); show(index + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stopPlaying(); show(index - 1); }
      if (event.key === ' ' && !event.target.closest('button')) { event.preventDefault(); play(); }
    });

    root.querySelector('[data-act="speed"]').textContent = `${remembered.speed}×`;
    if (remembered.source === 'custom' && remembered.text) {
      input.value = remembered.text;
      load(parse(remembered.text).events, 'custom');
    } else {
      load(parse(SAMPLES.find((sample) => sample.id === remembered.source).jsonl).events, remembered.source);
    }
  }

  window.SITE_TOOLS = { ...(window.SITE_TOOLS || {}), 'agent-trace-replay': { SAMPLES, parse, timeline, summarize, clock, mount } };
})();
