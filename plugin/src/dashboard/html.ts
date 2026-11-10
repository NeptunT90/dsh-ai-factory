export const DASHBOARD_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>DSH AI Factory — Control Plane</title>
<style>
:root {
  color-scheme: dark;
  --bg: #090d10;
  --panel: #0f1519;
  --panel-2: #121b20;
  --line: #223038;
  --line-soft: #19242a;
  --text: #dbe7ea;
  --muted: #8da0a8;
  --dim: #63757d;
  --accent: #5eead4;
  --accent-dim: #1f766c;
  --amber: #f6c453;
  --danger: #fb7185;
  --ok: #6ee7b7;
  --font: "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  background:
    radial-gradient(1000px 500px at 85% -10%, rgba(94, 234, 212, .08), transparent 60%),
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
    var(--bg);
  background-size: auto, 32px 32px, 32px 32px, auto;
  color: var(--text);
  font: 14px/1.5 var(--font);
}
button { font: inherit; color: inherit; }
.app { display: grid; grid-template-columns: 238px minmax(0, 1fr); min-height: 100vh; }
.rail {
  border-right: 1px solid var(--line-soft);
  padding: 20px 14px 16px;
  display: flex; flex-direction: column; gap: 22px;
  background: rgba(10, 15, 18, .72);
  backdrop-filter: blur(12px);
}
.brand { display: flex; gap: 10px; align-items: center; padding: 0 6px; }
.brand-mark {
  width: 38px; height: 38px; display: grid; place-items: center;
  border: 1px solid var(--accent-dim); color: var(--accent);
  font: 700 12px/1 var(--mono); letter-spacing: .08em;
  background: linear-gradient(135deg, rgba(94,234,212,.12), transparent);
}
.brand strong { display: block; font: 700 13px/1.2 var(--mono); letter-spacing: .12em; }
.brand small { display: block; margin-top: 4px; color: var(--dim); font: 10px/1.2 var(--mono); letter-spacing: .08em; }
nav { display: flex; flex-direction: column; gap: 3px; }
nav button {
  text-align: left; background: transparent; border: 1px solid transparent;
  padding: 9px 10px; color: var(--muted); cursor: pointer;
  display: flex; justify-content: space-between; gap: 8px; align-items: center;
}
nav button:hover { color: var(--text); background: rgba(255,255,255,.025); }
nav button[aria-current="page"] {
  color: var(--accent); border-color: var(--line); background: rgba(94,234,212,.05);
}
nav .nav-count { font: 11px var(--mono); color: var(--dim); }
.rail-foot { margin-top: auto; color: var(--dim); font: 10px/1.6 var(--mono); letter-spacing: .04em; border-top: 1px solid var(--line-soft); padding: 14px 6px 0; }
main { padding: 24px 28px 30px; min-width: 0; }
.topbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.eyebrow { margin: 0 0 6px; color: var(--dim); font: 10px/1 var(--mono); letter-spacing: .18em; }
h1 { margin: 0; font-size: clamp(22px, 2.6vw, 34px); font-weight: 650; letter-spacing: -.02em; }
.top-actions { display: flex; align-items: center; gap: 12px; }
.clock { color: var(--muted); font: 12px var(--mono); }
button.refresh {
  border: 1px solid var(--line); background: var(--panel);
  padding: 8px 12px; cursor: pointer; color: var(--text);
}
button.refresh:hover { border-color: var(--accent-dim); color: var(--accent); }
.statusline {
  margin-top: 18px; padding: 10px 12px; border: 1px solid var(--line-soft);
  color: var(--muted); font: 11px/1.4 var(--mono);
  display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center;
  background: rgba(15,21,25,.6);
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 12px rgba(110,231,183,.75); }
.dot.off { background: var(--danger); box-shadow: none; }
.banner { margin-top: 14px; padding: 12px 14px; border: 1px solid rgba(251,113,133,.4); background: rgba(251,113,133,.06); color: #ffd3da; }
#view { margin-top: 22px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.section-head h2 { margin: 0; font-size: 15px; font-weight: 650; }
.section-head p { margin: 0; color: var(--dim); font: 11px var(--mono); }
.grid { display: grid; gap: 12px; }
.kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi { background: var(--panel); border: 1px solid var(--line-soft); padding: 14px 15px; min-height: 104px; position: relative; overflow: hidden; }
.kpi:after { content: ""; position: absolute; inset: auto 0 0; height: 2px; background: var(--accent-dim); opacity: .65; }
.kpi .label { color: var(--dim); font: 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.kpi strong { display: block; margin-top: 12px; font: 650 30px/1 var(--mono); letter-spacing: -.04em; }
.kpi .sub { display: block; margin-top: 7px; color: var(--muted); font-size: 12px; }
.two { grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr); margin-top: 12px; }
.panel { background: var(--panel); border: 1px solid var(--line-soft); padding: 16px; min-width: 0; }
.panel h3 { margin: 0 0 12px; font-size: 13px; font-weight: 650; }
.bars { display: flex; flex-direction: column; gap: 9px; }
.bar-row { display: grid; grid-template-columns: 82px minmax(0, 1fr) 38px; gap: 10px; align-items: center; }
.bar-row span:first-child { color: var(--muted); font: 11px var(--mono); }
.bar { height: 5px; background: var(--line-soft); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.bar-row b { text-align: right; font: 11px var(--mono); color: var(--text); }
.facts { display: grid; gap: 8px; }
.fact { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line-soft); font-size: 12px; }
.fact:last-child { border-bottom: 0; padding-bottom: 0; }
.fact span { color: var(--muted); }
.fact code { font: 11px var(--mono); color: var(--text); overflow-wrap: anywhere; text-align: right; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line-soft); background: var(--panel); }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
th { color: var(--dim); font: 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; background: rgba(255,255,255,.015); }
td { font-size: 12px; color: var(--muted); }
td strong { color: var(--text); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
.mono { font-family: var(--mono); }
.chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); padding: 2px 7px; font: 10px var(--mono); color: var(--muted); white-space: nowrap; }
.chip.ready { color: var(--ok); border-color: rgba(110,231,183,.25); }
.chip.planned { color: var(--amber); border-color: rgba(246,196,83,.25); }
.chip.off { color: var(--danger); border-color: rgba(251,113,133,.25); }
.st-ready { color: var(--ok); }
.st-running { color: var(--accent); }
.st-completed { color: var(--ok); }
.st-failed { color: var(--danger); }
.st-cancelled { color: var(--dim); }
.st-review, .st-waiting { color: var(--amber); }
.task-title { color: var(--text); font-weight: 600; }
.small { color: var(--dim); font-size: 11px; }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.agent { background: var(--panel); border: 1px solid var(--line-soft); padding: 14px; }
.agent-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.agent h3 { margin: 0; font-size: 14px; }
.agent .role { color: var(--accent); font: 10px var(--mono); letter-spacing: .08em; }
.agent p { color: var(--muted); font-size: 12px; margin: 8px 0; }
.agent .tools { color: var(--dim); font: 10px/1.6 var(--mono); overflow-wrap: anywhere; }
.memory-list { display: flex; flex-direction: column; }
.memory-item { padding: 13px 2px; border-bottom: 1px solid var(--line-soft); display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 12px; }
.memory-item:last-child { border-bottom: 0; }
.memory-item h3 { margin: 2px 0 4px; font-size: 13px; }
.memory-item p { margin: 0; color: var(--muted); font-size: 12px; }
.audit-row { display: grid; grid-template-columns: 70px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line-soft); font-size: 12px; }
.audit-row:last-child { border-bottom: 0; }
.audit-row time { color: var(--dim); font: 10px var(--mono); }
.audit-row .ev { color: var(--text); font-family: var(--mono); font-size: 11px; }
.audit-row .meta { color: var(--dim); font-size: 11px; }
.empty { padding: 28px 10px; color: var(--dim); text-align: center; border: 1px dashed var(--line); }
.foot { margin-top: 24px; color: var(--dim); font: 10px var(--mono); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 980px) {
  .app { grid-template-columns: 1fr; }
  .rail { border-right: 0; border-bottom: 1px solid var(--line-soft); padding: 14px; flex-direction: row; align-items: center; overflow-x: auto; }
  .brand { min-width: 190px; }
  nav { flex-direction: row; gap: 2px; }
  nav button { white-space: nowrap; padding: 8px 10px; }
  .rail-foot { display: none; }
  main { padding: 18px 14px 24px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .two, .settings-grid, .cards { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .topbar { align-items: flex-start; flex-direction: column; }
  .kpis { grid-template-columns: 1fr; }
  .memory-item { grid-template-columns: 1fr; gap: 4px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="brand">
      <div class="brand-mark">AF</div>
      <div><strong>AI FACTORY</strong><small>DSH CONTROL PLANE</small></div>
    </div>
    <nav id="nav" aria-label="Разделы dashboard">
      <button data-tab="overview" aria-current="page">Обзор <span class="nav-count" id="nav-tasks"></span></button>
      <button data-tab="agents">Агенты <span class="nav-count" id="nav-agents"></span></button>
      <button data-tab="tasks">Задачи <span class="nav-count" id="nav-task-count"></span></button>
      <button data-tab="memory">Память <span class="nav-count" id="nav-memory"></span></button>
      <button data-tab="audit">Журнал</button>
      <button data-tab="models">Модели</button>
      <button data-tab="sync">Синхронизация</button>
      <button data-tab="tools">Инструменты</button>
      <button data-tab="settings">Настройки</button>
    </nav>
    <div class="rail-foot">read-only · loopback only<br>token session · no external assets</div>
  </aside>
  <main>
    <header class="topbar">
      <div><p class="eyebrow">LOCAL CONTROL PLANE · DSH 0.2.2-rc.1</p><h1 id="page-title">Обзор</h1></div>
      <div class="top-actions"><span class="clock" id="clock"></span><button class="refresh" id="refresh" type="button">Обновить</button></div>
    </header>
    <div class="statusline" id="statusline"><span class="dot" id="live-dot"></span><span id="live-text">Подключение…</span><span id="identity"></span></div>
    <div id="error"></div>
    <section id="view" aria-live="polite"><div class="empty">Загрузка состояния…</div></section>
    <footer class="foot"><span>DSH AI Factory · локальная панель</span><span>данные: SQLite · обновление каждые 10 с</span></footer>
  </main>
</div>
<script>
(function () {
  'use strict';
  var state = { data: null, tab: 'overview', error: '' };
  var titles = { overview: 'Обзор', agents: 'Агенты', tasks: 'Задачи', memory: 'Память', audit: 'Журнал', models: 'Модели', sync: 'Синхронизация', tools: 'Инструменты', settings: 'Настройки' };
  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;';
    });
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(ts); }
  }
  function fmtUptime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600); s %= 3600;
    var m = Math.floor(s / 60); s %= 60;
    return (h > 0 ? h + ' ч ' : '') + m + ' мин ' + s + ' с';
  }
  function statusClass(status) { return 'st-' + String(status || '').toLowerCase(); }
  function chip(status) {
    var cls = status === 'ready' ? 'ready' : status === 'planned' ? 'planned' : 'off';
    return '<span class="chip ' + cls + '">' + esc(status === 'ready' ? 'готово' : status === 'planned' ? 'план' : status) + '</span>';
  }
  function kpi(label, value, sub) {
    return '<article class="kpi"><span class="label">' + esc(label) + '</span><strong>' + esc(value) + '</strong><span class="sub">' + esc(sub) + '</span></article>';
  }
  function empty(text) { return '<div class="empty">' + esc(text) + '</div>'; }
  function renderOverview(d) {
    var o = d.overview, t = o.tasks;
    var bars = Object.keys(t.byStatus).map(function (status) {
      var count = t.byStatus[status] || 0;
      var width = t.total ? Math.round((count / t.total) * 100) : 0;
      return '<div class="bar-row"><span>' + esc(status) + '</span><div class="bar"><i style="width:' + width + '%"></i></div><b>' + count + '</b></div>';
    }).join('');
    var recent = (d.audit || []).slice(0, 6).map(function (record) {
      return '<div class="audit-row"><time>' + esc(fmtTime(record.ts)) + '</time><div><div class="ev">' + esc(record.event) + '</div><div class="meta">' + esc(record.level) + (record.actor ? ' · ' + esc(record.actor) : '') + '</div></div></div>';
    }).join('');
    return '<div class="section-head"><h2>Состояние фабрики</h2><p>обновлено ' + esc(fmtTime(d.generatedAt)) + '</p></div>' +
      '<div class="grid kpis">' +
        kpi('Агенты', o.agents, o.runningAgents + ' включены') +
        kpi('Активные задачи', t.active, 'всего ' + t.total + ' · failed ' + t.failed) +
        kpi('Память', o.memory.activeEntries, 'всего ' + o.memory.totalEntries + ' · проектов ' + o.projects) +
        kpi('Uptime', fmtUptime(o.uptimeMs), o.driver) +
      '</div>' +
      '<div class="grid two">' +
        '<div class="panel"><h3>Очередь задач</h3><div class="bars">' + bars + '</div><p class="small" style="margin:12px 0 0">overdue: ' + esc(t.overdue) + ' · recovery: ' + esc(o.recoveredTasks) + '</p></div>' +
        '<div class="panel"><h3>Система</h3><div class="facts">' +
          '<div class="fact"><span>версия</span><code>v' + esc(o.version) + '</code></div>' +
          '<div class="fact"><span>схема</span><code>' + esc(o.schemaVersion) + '</code></div>' +
          '<div class="fact"><span>драйвер</span><code>' + esc(o.driver) + '</code></div>' +
          '<div class="fact"><span>автономность</span><code>' + esc(o.autonomy) + '</code></div>' +
          '<div class="fact"><span>БД</span><code>' + esc(o.dbPath) + '</code></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="section-head" style="margin-top:20px"><h2>Последние события</h2><p>audit log</p></div>' +
      '<div class="panel">' + (recent || empty('Событий пока нет.')) + '</div>';
  }
  function renderAgents(d) {
    var cards = (d.agents || []).map(function (agent) {
      return '<article class="agent"><div class="agent-head"><div><h3>' + esc(agent.name) + '</h3><div class="role">' + esc(agent.role) + '</div></div><span class="chip ' + (agent.enabled ? 'ready' : 'off') + '">' + (agent.enabled ? 'вкл' : 'выкл') + '</span></div>' +
        '<p>' + esc(agent.title) + ' · доступ: ' + esc(agent.accessLevel) + ' · память: ' + esc(agent.memoryScope) + '</p>' +
        '<div class="small">модель: ' + esc(agent.model) + ' · лимит задач: ' + esc(agent.limits.maxConcurrentTasks) + ' · v' + esc(agent.version) + '</div>' +
        '<div class="tools">' + esc((agent.tools || []).join(' · ')) + '</div></article>';
    }).join('');
    return '<div class="section-head"><h2>Профили специалистов</h2><p>' + esc((d.agents || []).length) + ' профилей · конфигурация ролей, не запущенные LLM</p></div>' +
      (cards ? '<div class="cards">' + cards + '</div>' : empty('Профили не найдены.'));
  }
  function renderTasks(d) {
    var rows = (d.tasks || []).map(function (task) {
      return '<tr><td><span class="task-title">' + esc(task.title) + '</span><div class="small mono">' + esc(task.id) + '</div></td>' +
        '<td><span class="mono ' + statusClass(task.status) + '">' + esc(task.status) + '</span></td>' +
        '<td>' + esc(task.priority) + '</td>' +
        '<td>' + esc(task.projectName) + '</td>' +
        '<td>' + esc(task.assignedRole || '—') + '</td>' +
        '<td>' + esc(task.attempts + '/' + task.maxAttempts) + '</td>' +
        '<td>' + esc(fmtTime(task.updatedAt)) + '</td></tr>';
    }).join('');
    return '<div class="section-head"><h2>Task Engine</h2><p>' + esc((d.tasks || []).length) + ' последних задач</p></div>' +
      (rows ? '<div class="table-wrap"><table><thead><tr><th>Задача</th><th>Статус</th><th>Приоритет</th><th>Проект</th><th>Роль</th><th>Попытки</th><th>Обновлена</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : empty('Задач пока нет. Создайте план через factory_plan_create.'));
  }
  function renderMemory(d) {
    var items = (d.memory || []).map(function (entry) {
      return '<div class="memory-item"><div><span class="chip">' + esc(entry.kind) + '</span><div class="small" style="margin-top:6px">' + esc(entry.trust) + '</div></div>' +
        '<div><h3>' + esc(entry.title) + '</h3><p>' + esc(entry.snippet) + '</p><div class="small mono">' + esc(entry.id) + ' · ' + esc(entry.projectName) + ' · ' + esc(fmtTime(entry.updatedAt)) + '</div></div></div>';
    }).join('');
    return '<div class="section-head"><h2>Durable memory</h2><p>' + esc((d.memory || []).length) + ' активных записей · FTS5</p></div>' +
      (items ? '<div class="panel memory-list">' + items + '</div>' : empty('Память пуста.'));
  }
  function renderAudit(d) {
    var rows = (d.audit || []).map(function (record) {
      return '<div class="audit-row"><time>' + esc(fmtTime(record.ts)) + '</time><div><div class="ev">' + esc(record.event) + ' <span class="chip">' + esc(record.level) + '</span></div><div class="meta">' + esc(record.actor || 'system') + (record.projectId ? ' · ' + esc(record.projectId) : '') + ' · ' + esc(JSON.stringify(record.data)) + '</div></div></div>';
    }).join('');
    return '<div class="section-head"><h2>Audit log</h2><p>метаданные, без содержимого памяти</p></div><div class="panel">' + (rows || empty('Журнал пуст.')) + '</div>';
  }
  function renderModels(d) {
    var m = d.models || {};
    var agents = (d.agents || []).map(function (agent) {
      var route = agent.route || {};
      return '<div class="agent"><div class="agent-head"><div><h3>' + esc(agent.name) + '</h3><div class="role">' + esc(agent.role) + '</div></div><span class="chip ' + (agent.enabled ? 'ready' : 'off') + '">' + (agent.enabled ? 'вкл' : 'выкл') + '</span></div>' +
        '<div class="facts"><div class="fact"><span>primary</span><code>' + esc(route.primary || agent.model || 'inherit') + '</code></div>' +
        '<div class="fact"><span>fallbacks</span><code>' + esc((route.fallbacks || []).join(', ') || '—') + '</code></div>' +
        '<div class="fact"><span>allowlist</span><code>' + esc((agent.allowedTools || []).length) + ' tools</code></div></div></div>';
    }).join('');
    return '<div class="section-head"><h2>Model Router</h2><p>' + (m.enabled ? 'включён' : 'выключен') + ' · max attempts ' + esc(m.maxAttempts) + '</p></div>' +
      '<div class="grid kpis">' + kpi('Router', m.enabled ? 'ON' : 'OFF', 'profile → parent') + kpi('Fallbacks', (m.fallbacks || []).length, (m.fallbacks || []).join(', ') || 'не заданы') + kpi('Attempts', m.maxAttempts, 'на один child') + '</div>' +
      (agents ? '<div class="cards">' + agents + '</div>' : empty('Профили не найдены.'));
  }
  function renderSync(d) {
    var s = d.sync || {};
    var facts = [
      ['URL', s.configured ? s.url : 'не настроен'],
      ['auto', s.auto ? 'включён' : 'выключен'],
      ['running', s.running ? 'да' : 'нет'],
      ['token', s.tokenPresent ? 'есть' : 'нет'],
      ['cursor', s.cursor || '—'],
      ['last sync', s.lastSyncAt ? fmtTime(s.lastSyncAt) : '—'],
      ['last error', s.lastSyncError || s.lastError || '—'],
    ].map(function (pair) {
      return '<div class="fact"><span>' + esc(pair[0]) + '</span><code>' + esc(pair[1]) + '</code></div>';
    }).join('');
    return '<div class="section-head"><h2>Синхронизация памяти</h2><p>outbox → HTTP → PostgreSQL/pgvector</p></div>' +
      '<div class="grid kpis">' + kpi('Настроен', s.configured ? 'да' : 'нет', s.url || 'локальный режим') + kpi('Pending', s.pending || 0, 'операций в outbox') + kpi('Failed', s.failed || 0, 'ждут retry') + kpi('Auto', s.auto ? 'ON' : 'OFF', 'таймер плагина') + '</div>' +
      '<div class="panel"><h3>Состояние</h3><div class="facts">' + facts + '</div></div>';
  }
  function renderTools(d) {
    var rows = (d.tools || []).map(function (tool) {
      var status = tool.healthStatus || (tool.name.indexOf('factory_') === 0 ? 'UNKNOWN' : 'DSH-managed');
      var risk = tool.risk || '—';
      var checked = tool.healthCheckedAt ? new Date(tool.healthCheckedAt).toLocaleTimeString() : '—';
      var latency = tool.latencyMs === null || tool.latencyMs === undefined ? '—' : tool.latencyMs + ' ms';
      var error = tool.errorKind ? ' · ' + esc(tool.errorKind) : '';
      return '<tr><td><strong class="mono">' + esc(tool.name) + '</strong></td><td>' + esc(status) + error + '</td><td>' + esc(risk) + '</td><td>' + esc(checked) + '</td><td>' + esc(latency) + '</td><td>' + esc(tool.description) + '</td></tr>';
    }).join('');
    return '<div class="section-head"><h2>Tool Registry</h2><p>' + esc((d.tools || []).length) + ' инструментов; health только для factory_*</p></div>' +
      (rows ? '<div class="table-wrap"><table><thead><tr><th>Инструмент</th><th>Статус</th><th>Риск</th><th>Проверено</th><th>Latency</th><th>Описание</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : empty('Инструменты не найдены.'));
  }
  function renderSettings(d) {
    var s = d.settings || {};
    var facts = Object.keys(s).map(function (key) {
      var value = s[key];
      return '<div class="fact"><span>' + esc(key) + '</span><code>' + esc(value) + '</code></div>';
    }).join('');
    var caps = (d.capabilities || []).map(function (cap) {
      return '<div class="fact"><span>' + esc(cap.name) + '</span><div>' + chip(cap.status) + '<div class="small">' + esc(cap.note) + '</div></div></div>';
    }).join('');
    return '<div class="section-head"><h2>Конфигурация и возможности</h2><p>только чтение</p></div><div class="settings-grid">' +
      '<div class="panel"><h3>Настройки</h3><div class="facts">' + facts + '</div></div>' +
      '<div class="panel"><h3>Подсистемы</h3><div class="facts">' + caps + '</div></div></div>';
  }
  function render() {
    var d = state.data;
    var view = byId('view');
    byId('page-title').textContent = titles[state.tab] || 'Обзор';
    document.querySelectorAll('#nav button').forEach(function (button) {
      button.setAttribute('aria-current', button.getAttribute('data-tab') === state.tab ? 'page' : 'false');
    });
    byId('error').innerHTML = state.error ? '<div class="banner">Ошибка данных: ' + esc(state.error) + '</div>' : '';
    if (!d) { if (!state.error) view.innerHTML = '<div class="empty">Загрузка состояния…</div>'; return; }
    var o = d.overview;
    byId('nav-agents').textContent = String(o.agents);
    byId('nav-task-count').textContent = String(o.tasks.total);
    byId('nav-tasks').textContent = String(o.tasks.active);
    byId('nav-memory').textContent = String(o.memory.activeEntries);
    byId('identity').textContent = 'v' + o.version + ' · ' + o.driver + ' · schema ' + o.schemaVersion + ' · ' + o.projects + ' проектов';
    byId('live-text').textContent = 'LIVE · данные SQLite';
    byId('live-dot').className = 'dot';
    if (state.tab === 'overview') view.innerHTML = renderOverview(d);
    else if (state.tab === 'agents') view.innerHTML = renderAgents(d);
    else if (state.tab === 'tasks') view.innerHTML = renderTasks(d);
    else if (state.tab === 'memory') view.innerHTML = renderMemory(d);
    else if (state.tab === 'audit') view.innerHTML = renderAudit(d);
    else if (state.tab === 'models') view.innerHTML = renderModels(d);
    else if (state.tab === 'sync') view.innerHTML = renderSync(d);
    else if (state.tab === 'tools') view.innerHTML = renderTools(d);
    else view.innerHTML = renderSettings(d);
  }
  async function load() {
    byId('live-text').textContent = 'обновление…';
    try {
      var response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      state.data = await response.json();
      state.error = '';
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
      byId('live-text').textContent = 'нет связи';
      byId('live-dot').className = 'dot off';
    }
    render();
  }
  byId('nav').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-tab]');
    if (!button) return;
    state.tab = button.getAttribute('data-tab');
    render();
    byId('view').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  byId('refresh').addEventListener('click', load);
  function clock() {
    byId('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  clock(); setInterval(clock, 1000);
  load(); setInterval(load, 10000);
})();
</script>
</body>
</html>`
