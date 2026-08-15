/**
 * dsh-ui-hud — browser half.
 *
 * DSH Web 状态 HUD + 会话记忆中心（生态空白点：底部状态栏 HUD + 记忆可视化面板）：
 *
 *  1) 状态栏 HUD（底部悬浮条，可自动隐藏/点击展开）：
 *     - 状态 pill（空闲/思考中(带计时)/完成/错误/待命）+ 当前模型
 *     - token 用量 + 上下文压力条（tokenUsage / contextPressure 投影）
 *     - 后台任务数（jobsBySession）、goal 阶段（goal 投影）
 *     - 点击展开详情：sessionStats（turn/step/llmMs/toolMs/首token延迟）
 *  2) 会话记忆中心（右侧抽屉，受 hello-agents 第8章"四种记忆类型"启发）：
 *     - 情景记忆：会话时间线（用户/助手/工具/压缩/上下文注入/错误，可★固定）
 *     - 工作记忆：当前回合输出 + 固定的消息（pin，localStorage）
 *     - 语义记忆：上下文注入卡片（context 节点 + provenance 来源）
 *     - 感知记忆：会话中的图片附件墙
 *     - 检索框：客户端关键词过滤 + 统计行（回合/步骤/token/上下文）
 *  3) 快捷操作：Ctrl+Shift+H 切换 HUD，Ctrl+Shift+M 切换记忆抽屉
 *
 * 兼容性：HUD/抽屉为插件私有 fixed 元素（类前缀 dshhud-）；数据全部来自
 * 官方会话快照与投影服务（ctx.sessions + projections.faceOf）；配置存
 * localStorage；settings.section 提供开关。
 */
window.__ModuleLoader__.load({
  id: "dsh-ui-hud",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;

    /** Cordis 插件名（与 patch 行 id 一致）。 */
    const name = "ui-hud";
    /** 依赖的客户端服务。 */
    const inject = ["slots", "theme", "sessions"];

    const CFG_KEY = "dsh-ui-hud.config";
    const PINS_KEY = "dsh-ui-hud.pins";

    const DEFAULTS = {
      hud: true,
      hudAutoHide: true,
      memory: true
    };

    function loadConfig() {
      try {
        const raw = localStorage.getItem(CFG_KEY);
        if (!raw) return Object.assign({}, DEFAULTS);
        const parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        return Object.assign({}, DEFAULTS);
      }
    }

    let cfg;

    function saveConfig() {
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      } catch (e) {
        console.warn("dsh-ui-hud: saveConfig failed", e);
      }
    }

    function loadPins() {
      try {
        const raw = localStorage.getItem(PINS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }

    function savePins(pins) {
      try {
        localStorage.setItem(PINS_KEY, JSON.stringify(pins.slice(0, 50)));
      } catch { /* ignore */ }
    }

    function apply(ctx) {
      cfg = loadConfig();

      // ================= 内存 store（设置页 + 抽屉用） =================
      const listeners = new Set();
      let state = Object.assign({
        machine: "idle",
        elapsedMs: 0,
        model: null,
        tokens: null,
        pressure: null,
        stats: null,
        goal: null,
        jobsRunning: 0,
        detailOpen: false,
        drawerOpen: false,
        pins: loadPins(),
        search: "",
        memTab: "episodic"
      }, cfg);
      const store = {
        get: () => state,
        set(patch) { state = Object.assign({}, state, patch); for (const l of listeners) l(state); },
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
      };

      // ================= 私有样式 =================
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-dsh-ui-hud", "true");
      document.head.appendChild(styleEl);
      styleEl.textContent = `
        #dshhud-bar {
          position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%);
          display: flex; align-items: center; gap: 10px;
          height: 30px; padding: 0 12px; border-radius: 15px;
          background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1a1d27) 82%, transparent);
          border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          color: var(--dsw-alias-label-primary, #e5e7eb);
          font-size: 12px; line-height: 20px; white-space: nowrap;
          z-index: 8000; cursor: pointer; user-select: none;
          box-shadow: 0 4px 18px rgba(0,0,0,0.25);
          transition: opacity 0.4s ease;
          font-family: inherit;
        }
        #dshhud-bar.dshhud-dim { opacity: 0.35; }
        #dshhud-bar.dshhud-hidden { opacity: 0; pointer-events: none; }
        #dshhud-bar:hover { opacity: 1 !important; }
        .dshhud-seg {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 0 6px; border-radius: 8px; height: 20px;
        }
        .dshhud-seg:hover { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06)); }
        .dshhud-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .dshhud-dot.idle { background: #6b7280; }
        .dshhud-dot.thinking { background: var(--dsw-alias-brand-primary, #4f83f2); animation: dshhudPulse 1.2s ease-in-out infinite; }
        .dshhud-dot.done { background: #22c55e; }
        .dshhud-dot.error { background: #ef4444; animation: dshhudPulse 0.8s ease-in-out infinite; }
        .dshhud-dot.pending { background: #f59e0b; }
        @keyframes dshhudPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .dshhud-bar-wrap { flex: 1; min-width: 70px; height: 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08)); overflow: hidden; }
        .dshhud-bar-wrap > i { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary, #4f83f2); transition: width 0.4s ease; }
        .dshhud-btn { border: 0; background: transparent; color: inherit; font-size: 12px; cursor: pointer; padding: 0 4px; border-radius: 6px; line-height: 20px; }
        .dshhud-btn:hover { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06)); }

        #dshhud-detail {
          position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%);
          width: 420px; max-height: 60vh; overflow: auto;
          background: var(--dsw-alias-bg-layer-1, #16181f);
          border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));
          border-radius: 14px; padding: 14px; z-index: 8001;
          box-shadow: 0 10px 34px rgba(0,0,0,0.35);
          display: none; flex-direction: column; gap: 10px;
          font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary, #e5e7eb);
        }
        #dshhud-detail.dshhud-open { display: flex; }
        .dshhud-dt { font-weight: 600; font-size: 13px; }
        .dshhud-row { display: flex; align-items: center; gap: 8px; }
        .dshhud-row .dshhud-lbl { width: 120px; flex: none; color: var(--dsw-alias-label-secondary, #9ca3af); }

        #dshhud-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 8002;
          opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
        }
        #dshhud-backdrop.dshhud-open { opacity: 1; pointer-events: auto; }
        #dshhud-drawer {
          position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 92vw;
          background: var(--dsw-alias-bg-layer-1, #16181f);
          border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));
          box-shadow: -10px 0 40px rgba(0,0,0,0.35);
          z-index: 8003; transform: translateX(102%); transition: transform 0.28s ease;
          display: flex; flex-direction: column;
          color: var(--dsw-alias-label-primary, #e5e7eb);
          font-size: 13px; line-height: 20px;
        }
        #dshhud-drawer.dshhud-open { transform: translateX(0); }
        .dshhud-drawer-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); font-weight: 600; font-size: 14px; }
        .dshhud-drawer-head .dshhud-spacer { flex: 1; }
        .dshhud-tabs { display: flex; gap: 4px; padding: 8px 14px 0; }
        .dshhud-tab { padding: 4px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary, #9ca3af); border: 1px solid transparent; }
        .dshhud-tab:hover { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.05)); }
        .dshhud-tab.dshhud-sel { color: var(--dsw-alias-label-primary, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #1f222b); border-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
        .dshhud-search { margin: 8px 14px 0; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); background: var(--dsw-alias-bg-layer-2, #1f222b); color: inherit; font-size: 12px; outline: none; }
        .dshhud-body { flex: 1; overflow: auto; padding: 10px 14px 20px; display: flex; flex-direction: column; gap: 8px; }
        .dshhud-statrow { display: flex; gap: 8px; flex-wrap: wrap; }
        .dshhud-stat { flex: 1; min-width: 84px; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #1f222b); border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06)); text-align: center; }
        .dshhud-stat b { display: block; font-size: 16px; font-weight: 700; }
        .dshhud-stat span { font-size: 11px; color: var(--dsw-alias-label-secondary, #9ca3af); }
        .dshhud-card { padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #1f222b); border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.06)); }
        .dshhud-card .dshhud-card-title { font-weight: 600; font-size: 12px; }
        .dshhud-card .dshhud-card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #9ca3af); }
        .dshhud-card .dshhud-card-text { margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-primary, #e5e7eb); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .dshhud-empty { text-align: center; color: var(--dsw-alias-label-tertiary, #6b7280); padding: 24px 0; font-size: 12px; }
        .dshhud-pin { float: right; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #9ca3af); cursor: pointer; font-size: 13px; }
        .dshhud-pin.dshhud-on { color: #f59e0b; }
        .dshhud-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
        .dshhud-thumbs img { width: 100%; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
        .dshhud-note { font-size: 11px; color: var(--dsw-alias-label-tertiary, #6b7280); }

        .dshhud-page { padding: 4px 20px 28px; max-width: 620px; display: flex; flex-direction: column; gap: 16px; }
        .dshhud-card2 { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .dshhud-title { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); margin: 0; }
        .dshhud-srow { display: flex; align-items: center; gap: 10px; }
        .dshhud-grow { flex: 1; min-width: 0; }
        .dshhud-switch { position: relative; width: 40px; height: 22px; flex: none; cursor: pointer; display: inline-block; }
        .dshhud-switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
        .dshhud-switch .dshhud-track { position: absolute; inset: 0; border-radius: 11px; background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); border: 1px solid var(--dsw-alias-border-l1); transition: background 0.15s ease; }
        .dshhud-switch .dshhud-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform 0.15s ease, background 0.15s ease; }
        .dshhud-switch input:checked ~ .dshhud-track { background: var(--dsw-alias-brand-primary); border-color: transparent; }
        .dshhud-switch input:checked ~ .dshhud-thumb { transform: translateX(18px); background: #fff; }
      `;

      // ================= HUD / 抽屉 DOM =================
      const bar = document.createElement("div");
      bar.id = "dshhud-bar";
      bar.className = "dshhud-hidden";
      bar.setAttribute("title", "点击展开详情 · Ctrl+Shift+H 隐藏/显示");
      document.body.appendChild(bar);

      const detail = document.createElement("div");
      detail.id = "dshhud-detail";
      document.body.appendChild(detail);

      const backdrop = document.createElement("div");
      backdrop.id = "dshhud-backdrop";
      document.body.appendChild(backdrop);

      const drawer = document.createElement("div");
      drawer.id = "dshhud-drawer";
      document.body.appendChild(drawer);

      const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== void 0) e.textContent = text;
        return e;
      };

      function shortText(text, len) {
        const t = String(text || "").replace(/\s+/g, " ").trim();
        return t.length > len ? t.slice(0, len - 1) + "…" : t;
      }

      function contentText(content) {
        if (!Array.isArray(content)) return "";
        return content.map((b) => {
          if (!b) return "";
          if (typeof b.text === "string") return b.text;
          if (b.content && Array.isArray(b.content)) return b.content.map((x) => x && x.text || "").join(" ");
          return "";
        }).join(" ").trim();
      }

      // ================= 会话观察 =================
      let unsubList = null;
      let unsubSession = null;
      let currentSession = null;
      let thinkingStart = 0;
      let lastSnap = null;

      function deriveMachine(snap) {
        if (!snap) return { m: "idle", active: false };
        if (snap.openState !== "open") return { m: "idle", active: false };
        if (snap.promptError || snap.lastAgentError) return { m: "error", active: false };
        if (snap.pending && snap.pending.length > 0) return { m: "pending", active: false };
        if (snap.partial || (snap.runningCalls && snap.runningCalls.length > 0)) return { m: "thinking", active: true };
        if (snap.turnTimings) {
          for (const t of snap.turnTimings.values()) {
            if (t && t.startTime !== void 0 && t.endTime === void 0) return { m: "thinking", active: true };
          }
        }
        return { m: "idle", active: false };
      }

      function readProjection(session, key) {
        try {
          const face = session && session.projections && session.projections.faceOf(key);
          return face ? face.getSnapshot() : undefined;
        } catch {
          return undefined;
        }
      }

      function modelName(snap) {
        if (!snap || !snap.nodes) return null;
        for (let i = snap.nodes.length - 1; i >= 0; i--) {
          const n = snap.nodes[i];
          if (n.kind === "assistant" && n.provenance) return n.provenance.model || null;
        }
        return null;
      }

      // ================= HUD 刷新 =================
      function refresh() {
        if (!cfg.hud) { bar.classList.add("dshhud-hidden"); return; }
        const snap = lastSnap;
        const { m } = deriveMachine(snap);
        if (m === "thinking" && thinkingStart === 0) thinkingStart = Date.now();
        if (m !== "thinking") thinkingStart = 0;
        const elapsed = thinkingStart ? Math.max(0, Math.round((Date.now() - thinkingStart) / 1000)) : 0;

        const tokens = readProjection(currentSession, "tokenUsage");
        const pressure = readProjection(currentSession, "contextPressure");
        const stats = readProjection(currentSession, "sessionStats");
        const goal = readProjection(currentSession, "goal");
        let jobsRunning = 0;
        try {
          const list = ctx.sessions.list.getSnapshot();
          const sid = list && list.current;
          const jobs = sid && list.jobsBySession ? list.jobsBySession[sid] : null;
          if (jobs) {
            for (const j of jobs) if (j.status === "running" || j.status === "stopping") jobsRunning++;
          }
        } catch { jobsRunning = 0; }

        const model = modelName(snap);
        const totalTokens = tokens && typeof tokens.totalTokens === "number"
          ? tokens.totalTokens
          : tokens && typeof tokens.promptTokens === "number" && typeof tokens.completionTokens === "number"
            ? tokens.promptTokens + tokens.completionTokens
            : 0;
        const pressurePct = pressure && pressure.contextWindow && pressure.projectedTokens
          ? Math.min(100, Math.round((pressure.projectedTokens / pressure.contextWindow) * 100))
          : null;

        store.set({
          machine: m,
          elapsedMs: elapsed,
          model: model || null,
          tokens: totalTokens,
          pressure: pressure ? { pct: pressurePct, projected: pressure.projectedTokens, window: pressure.contextWindow } : null,
          stats: stats ? {
            turns: stats.turns, steps: stats.steps, llmMs: stats.llmMs, toolMs: stats.toolMs,
            ttftMs: stats.ttftMs, ttftSteps: stats.ttftSteps
          } : null,
          goal: goal && goal.phase ? { phase: goal.phase } : null,
          jobsRunning
        });

        bar.innerHTML = "";
        const dotCls = m === "thinking" ? "thinking" : m === "done" ? "done" : m === "error" ? "error" : m === "pending" ? "pending" : "idle";
        const segState = el("span", "dshhud-seg");
        segState.appendChild(el("span", "dshhud-dot " + dotCls));
        segState.appendChild(el("span", null,
          m === "thinking" ? "思考中" + (elapsed > 0 ? " " + elapsed + "s" : "")
            : m === "done" ? "完成" : m === "error" ? "错误" : m === "pending" ? "待命" : "空闲"));
        bar.appendChild(segState);

        if (model) bar.appendChild(el("span", "dshhud-seg", model.length > 22 ? model.slice(0, 21) + "…" : model));
        if (totalTokens > 0) {
          const seg = el("span", "dshhud-seg");
          seg.appendChild(el("span", null, "⚡"));
          seg.appendChild(el("span", null, (totalTokens / 1000).toFixed(1) + "k"));
          bar.appendChild(seg);
        }
        if (pressurePct !== null) {
          const seg = el("span", "dshhud-seg");
          const wrap = el("span", "dshhud-bar-wrap");
          const fill = el("i");
          fill.style.width = pressurePct + "%";
          fill.style.background = pressurePct > 85 ? "#ef4444" : pressurePct > 65 ? "#f59e0b" : "var(--dsw-alias-brand-primary, #4f83f2)";
          wrap.appendChild(fill);
          seg.appendChild(el("span", null, "上下文"));
          seg.appendChild(wrap);
          seg.appendChild(el("span", null, pressurePct + "%"));
          bar.appendChild(seg);
        }
        if (jobsRunning > 0) bar.appendChild(el("span", "dshhud-seg", "⚙ " + jobsRunning + " 任务"));
        if (goal) bar.appendChild(el("span", "dshhud-seg", goal.phase === "blocked" ? "🎯 阻塞" : goal.phase === "paused" ? "🎯 暂停" : "🎯 目标"));
        if (cfg.memory) {
          const btn = el("button", "dshhud-btn", "📖 记忆");
          btn.onclick = (e) => {
            e.stopPropagation();
            toggleDrawer();
          };
          bar.appendChild(btn);
        }
        bar.appendChild(el("span", "dshhud-seg", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));

        bar.classList.toggle("dshhud-hidden", !cfg.hud);
        if (!cfg.hudAutoHide) bar.classList.remove("dshhud-dim");
        else {
          bar.classList.add("dshhud-dim");
          bar.onmouseenter = () => bar.classList.remove("dshhud-dim");
          bar.onmouseleave = () => { if (cfg.hudAutoHide) bar.classList.add("dshhud-dim"); };
        }

        if (state.detailOpen) buildDetail();
      }

      function toggleDetail() {
        store.set({ detailOpen: !state.detailOpen });
        if (state.detailOpen) buildDetail();
        else detail.classList.remove("dshhud-open");
      }

      function buildDetail() {
        detail.innerHTML = "";
        const s = state;
        detail.appendChild(el("div", "dshhud-dt", "会话统计 · Session Stats"));
        const row = el("div", "dshhud-statrow");
        const mk = (v, label) => {
          const d = el("div", "dshhud-stat");
          d.appendChild(el("b", null, String(v)));
          d.appendChild(el("span", null, label));
          return d;
        };
        if (s.stats) {
          row.appendChild(mk(s.stats.turns, "turns"));
          row.appendChild(mk(s.stats.steps, "steps"));
          row.appendChild(mk((s.stats.llmMs / 1000).toFixed(1) + "s", "LLM"));
          row.appendChild(mk((s.stats.toolMs / 1000).toFixed(1) + "s", "工具"));
          row.appendChild(mk(s.stats.ttftSteps > 0 ? (s.stats.ttftMs / s.stats.ttftSteps / 1000).toFixed(2) + "s" : "—", "首token"));
        } else {
          row.appendChild(mk("—", "等待数据"));
        }
        detail.appendChild(row);
        if (s.pressure) {
          const r = el("div", "dshhud-row");
          r.appendChild(el("span", "dshhud-lbl", "上下文占用"));
          const wrap = el("span", "dshhud-bar-wrap");
          const fill = el("i");
          fill.style.width = (s.pressure.pct || 0) + "%";
          wrap.appendChild(fill);
          r.appendChild(wrap);
          r.appendChild(el("span", null, (s.pressure.pct || 0) + "%"));
          detail.appendChild(r);
          detail.appendChild(el("div", "dshhud-note", "投影 " + (s.pressure.projected || 0) + " / 窗口 " + (s.pressure.window || "?") + " tokens"));
        }
        detail.appendChild(el("div", "dshhud-note", "数据来自官方投影（tokenUsage / contextPressure / sessionStats）。"));
      }

      // ================= 记忆抽屉 =================
      let drawerBody = null;

      function toggleDrawer() {
        store.set({ drawerOpen: !state.drawerOpen });
        backdrop.classList.toggle("dshhud-open", state.drawerOpen);
        drawer.classList.toggle("dshhud-open", state.drawerOpen);
        if (state.drawerOpen) buildDrawer();
        else drawer.innerHTML = "";
      }

      function buildDrawer() {
        drawer.innerHTML = "";
        const s = state;

        const head = el("div", "dshhud-drawer-head");
        head.appendChild(el("span", null, "🧠 记忆中心 · Memory Hub"));
        head.appendChild(el("span", "dshhud-spacer"));
        const closeBtn = el("button", "dshhud-btn", "✕");
        closeBtn.onclick = toggleDrawer;
        head.appendChild(closeBtn);
        drawer.appendChild(head);

        const statRow = el("div", "dshhud-statrow");
        const mkStat = (v, label) => {
          const d = el("div", "dshhud-stat");
          d.appendChild(el("b", null, String(v)));
          d.appendChild(el("span", null, label));
          return d;
        };
        statRow.appendChild(mkStat(s.stats ? s.stats.turns : "—", "回合"));
        statRow.appendChild(mkStat(s.stats ? s.stats.steps : "—", "步骤"));
        statRow.appendChild(mkStat(s.tokens ? (s.tokens / 1000).toFixed(1) + "k" : "—", "token"));
        statRow.appendChild(mkStat(s.pressure && s.pressure.pct !== null ? s.pressure.pct + "%" : "—", "上下文"));
        drawer.appendChild(statRow);

        const search = el("input", "dshhud-search");
        search.placeholder = "检索当前会话…";
        search.value = s.search || "";
        search.oninput = () => {
          store.set({ search: search.value });
          renderBody();
        };
        drawer.appendChild(search);

        const tabs = el("div", "dshhud-tabs");
        const TABS = [
          { key: "episodic", label: "情景" },
          { key: "working", label: "工作" },
          { key: "semantic", label: "语义" },
          { key: "sensory", label: "感知" }
        ];
        for (const t of TABS) {
          const tab = el("div", "dshhud-tab" + (s.memTab === t.key ? " dshhud-sel" : ""), t.label);
          tab.onclick = () => {
            store.set({ memTab: t.key });
            renderBody();
          };
          tabs.appendChild(tab);
        }
        drawer.appendChild(tabs);

        const body = el("div", "dshhud-body");
        drawer.appendChild(body);
        drawerBody = body;
        renderBody();
      }

      function renderBody() {
        const body = drawerBody;
        if (!body) return;
        body.innerHTML = "";
        const s = state;
        const snap = lastSnap;
        const nodes = (snap && snap.nodes) || [];
        const q = (s.search || "").trim().toLowerCase();

        // ---- 情景记忆：时间线 ----
        if (s.memTab === "episodic") {
          const items = [];
          for (const n of nodes) {
            let entry = null;
            if (n.kind === "user") {
              entry = { kind: "user", title: "你", text: shortText(contentText(n.content), 160), seq: n.seq };
            } else if (n.kind === "assistant") {
              const text = (n.blocks || []).map((b) => b.kind === "text" || b.kind === "reasoning" ? b.text : "").join(" ");
              entry = { kind: "assistant", title: "助手" + (n.interrupted ? "（已停止）" : ""), text: shortText(text, 160), seq: n.seq };
            } else if (n.kind === "tool-result") {
              entry = {
                kind: "tool",
                title: "🔧 " + ((n.call && n.call.name) || n.callId || "工具") + (n.isError ? " ⚠️失败" : ""),
                text: shortText((n.content || []).map((b) => b.text || "").join(" "), 120),
                seq: n.seq
              };
            } else if (n.kind === "compaction") {
              entry = { kind: "system", title: "🧹 上下文压缩", text: "历史已压缩，模型窗口释放", seq: n.seq };
            } else if (n.kind === "context") {
              entry = { kind: "system", title: "📥 上下文注入", text: shortText(contentText(n.content), 120), seq: n.seq };
            } else if (n.kind === "turn-error") {
              entry = { kind: "error", title: "⚠️ 回合错误", text: shortText(n.message || "", 120), seq: n.seq };
            }
            if (entry && (!q || (entry.text || "").toLowerCase().includes(q) || (entry.title || "").toLowerCase().includes(q))) {
              items.push(entry);
            }
          }
          if (items.length === 0) {
            body.appendChild(el("div", "dshhud-empty", q ? "没有匹配的记忆" : "会话还没有内容"));
          } else {
            for (const it of items.slice(-60).reverse()) {
              const card = el("div", "dshhud-card");
              const pinBtn = el("button", "dshhud-pin" + (s.pins.some((p) => p.seq === it.seq) ? " dshhud-on" : ""), "★");
              pinBtn.title = "固定到工作记忆";
              pinBtn.onclick = (e) => {
                e.stopPropagation();
                togglePin(it);
              };
              card.appendChild(pinBtn);
              card.appendChild(el("div", "dshhud-card-title", it.title));
              if (it.text) card.appendChild(el("div", "dshhud-card-text", it.text));
              card.appendChild(el("div", "dshhud-card-sub", "seq " + it.seq + " · " + it.kind));
              body.appendChild(card);
            }
          }
        }

        // ---- 工作记忆：固定 + 当前输出 ----
        if (s.memTab === "working") {
          if (snap && snap.partial) {
            const card = el("div", "dshhud-card");
            card.appendChild(el("div", "dshhud-card-title", "当前输出 · Partial"));
            card.appendChild(el("div", "dshhud-card-text", shortText((snap.partial.blocks || []).map((b) => b.text || "").join(" "), 200) || "（流式中）"));
            body.appendChild(card);
          }
          const pins = s.pins;
          if (pins.length === 0) {
            body.appendChild(el("div", "dshhud-empty", "还没有固定的记忆。在「情景」时间线里点 ★ 固定重要内容。"));
          } else {
            for (const p of pins.slice().reverse()) {
              const card = el("div", "dshhud-card");
              const unpin = el("button", "dshhud-pin dshhud-on", "★");
              unpin.onclick = () => togglePin({ seq: p.seq });
              card.appendChild(unpin);
              card.appendChild(el("div", "dshhud-card-title", p.title));
              if (p.text) card.appendChild(el("div", "dshhud-card-text", p.text));
              body.appendChild(card);
            }
          }
          body.appendChild(el("div", "dshhud-note", "工作记忆 = 当前回合 + 你固定的内容（持久化在浏览器）。"));
        }

        // ---- 语义记忆：上下文注入 ----
        if (s.memTab === "semantic") {
          const items = [];
          for (const n of nodes) {
            if (n.kind === "context") {
              const prov = n.provenance;
              const title = (prov && (prov.role || prov.producerName)) || "上下文注入";
              const text = shortText(contentText(n.content), 140);
              if (!q || text.toLowerCase().includes(q) || String(title).toLowerCase().includes(q)) {
                items.push({ title, text, seq: n.seq });
              }
            }
          }
          if (items.length === 0) {
            body.appendChild(el("div", "dshhud-empty", q ? "没有匹配的语义记忆" : "暂无上下文注入（语义记忆会在注入知识时出现）"));
          } else {
            for (const it of items) {
              const card = el("div", "dshhud-card");
              card.appendChild(el("div", "dshhud-card-title", "📥 " + it.title));
              if (it.text) card.appendChild(el("div", "dshhud-card-text", it.text));
              card.appendChild(el("div", "dshhud-card-sub", "seq " + it.seq));
              body.appendChild(card);
            }
          }
        }

        // ---- 感知记忆：附件 ----
        if (s.memTab === "sensory") {
          const images = [];
          for (const n of nodes) {
            if (n.kind === "user" && Array.isArray(n.content)) {
              for (const b of n.content) {
                if (b && b.type === "image") images.push({ src: b, seq: n.seq });
              }
            }
            if (n.kind === "assistant" && Array.isArray(n.blocks)) {
              for (const b of n.blocks) {
                if (b && b.kind === "image" && b.attachment) images.push({ src: b.attachment, seq: n.seq });
              }
            }
          }
          if (images.length === 0) {
            body.appendChild(el("div", "dshhud-empty", "会话中没有图片附件"));
          } else {
            const grid = el("div", "dshhud-thumbs");
            for (const im of images) {
              const url = im.src && (im.src.url || im.src.src);
              if (!url) continue;
              const img = el("img");
              img.src = url;
              img.title = "附件 · seq " + im.seq;
              grid.appendChild(img);
            }
            body.appendChild(grid);
            body.appendChild(el("div", "dshhud-note", "感知记忆 = 会话中的多模态附件。"));
          }
        }
      }

      function togglePin(entry) {
        const pins = state.pins.slice();
        const i = pins.findIndex((p) => p.seq === entry.seq);
        if (i >= 0) pins.splice(i, 1);
        else pins.push({ seq: entry.seq, title: entry.title || "固定", text: entry.text || "" });
        savePins(pins);
        store.set({ pins });
        if (state.drawerOpen) renderBody();
      }

      // ================= 会话订阅 =================
      function onSnapshot(snap) {
        lastSnap = snap;
        refresh();
      }

      function observeCurrent() {
        if (unsubSession) { unsubSession(); unsubSession = null; }
        currentSession = null;
        let list = null;
        try { list = ctx.sessions.list.getSnapshot(); } catch { list = null; }
        const sid = list && list.current;
        if (!sid) { onSnapshot(null); return; }
        let binding = null;
        try { binding = ctx.sessions.binding(sid); } catch { binding = null; }
        if (!binding || !binding.session) { onSnapshot(null); return; }
        currentSession = binding.session;
        unsubSession = currentSession.subscribe(() => onSnapshot(currentSession.getSnapshot()));
        onSnapshot(currentSession.getSnapshot());
      }
      unsubList = ctx.sessions.list.subscribe(observeCurrent);
      observeCurrent();

      // 时钟与思考计时
      const clockTimer = setInterval(() => {
        if (cfg.hud && !document.hidden) refresh();
      }, 1000);

      // ================= 交互 =================
      bar.addEventListener("click", (e) => {
        if (e.target.closest(".dshhud-btn")) return;
        toggleDetail();
      });
      backdrop.addEventListener("click", toggleDrawer);

      function onKeyDown(e) {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
        const k = (e.key || "").toLowerCase();
        if (k === "h") {
          e.preventDefault();
          applyConfig({ hud: !cfg.hud });
        } else if (k === "m") {
          e.preventDefault();
          if (cfg.memory) toggleDrawer();
        }
      }
      window.addEventListener("keydown", onKeyDown);

      // ================= 配置写入 =================
      function applyConfig(patch) {
        Object.assign(cfg, patch);
        saveConfig();
        store.set(patch);
        if (patch.hud !== void 0) {
          bar.classList.toggle("dshhud-hidden", !cfg.hud);
          if (cfg.hud) refresh();
        }
        if (patch.memory === false && state.drawerOpen) toggleDrawer();
      }

      // ================= 设置页 UI =================
      function SettingsView() {
        const [snap, setSnap] = React.useState(store.get());
        React.useEffect(() => store.subscribe(setSnap), []);
        const switchRow = (label, hint, checked, onChange) => h("div", { className: "dshhud-srow" }, [
          h("div", { className: "dshhud-grow" }, [
            h("div", { style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, label),
            h("div", { style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, hint)
          ]),
          h("label", { className: "dshhud-switch" }, [
            h("input", { type: "checkbox", checked, onChange }),
            h("span", { className: "dshhud-track" }),
            h("span", { className: "dshhud-thumb" })
          ])
        ]);
        return h("div", { className: "dshhud-page" }, [
          h("div", { className: "dshhud-card2" }, [
            h("div", { className: "dshhud-title" }, "状态 HUD · Status HUD"),
            switchRow("状态栏 HUD", "底部悬浮条：状态/模型/token/上下文压力/任务/goal（生态空白点）", snap.hud, (e) => applyConfig({ hud: e.target.checked })),
            switchRow("自动隐藏", "鼠标移开时淡出，悬停恢复", snap.hudAutoHide, (e) => applyConfig({ hudAutoHide: e.target.checked })),
            h("div", { className: "dshhud-note" }, "快捷键：Ctrl+Shift+H 显示/隐藏 HUD")
          ]),
          h("div", { className: "dshhud-card2" }, [
            h("div", { className: "dshhud-title" }, "记忆中心 · Memory Hub"),
            switchRow("记忆抽屉", "会话时间线/固定/上下文注入/附件（受 hello-agents 第8章启发）", snap.memory, (e) => applyConfig({ memory: e.target.checked })),
            h("div", { className: "dshhud-note" }, "快捷键：Ctrl+Shift+M 打开/关闭记忆抽屉")
          ]),
          h("div", { className: "dshhud-note" }, "配置保存在浏览器 localStorage。数据全部来自官方会话快照与投影服务。")
        ]);
      }

      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "ui-hud", order: 40, label: "状态 HUD · Memory" },
        () => h("div", { className: "dshhud-page" }, h(SettingsView))
      )), "dsh-ui-hud: settings section");

      // ================= 启动 =================
      refresh();

      // ================= 卸载清理 =================
      ctx.effect(() => () => {
        clearInterval(clockTimer);
        if (unsubList) unsubList();
        if (unsubSession) unsubSession();
        window.removeEventListener("keydown", onKeyDown);
        [bar, detail, backdrop, drawer].forEach((n) => {
          if (n && n.parentNode) n.parentNode.removeChild(n);
        });
        styleEl.remove();
      }, "dsh-ui-hud: cleanup");
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
