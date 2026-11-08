"use strict";

/**
 * OpenCut Rust 重写版 · 动态路线图看板
 * 数据来自 roadmap/README.md §6 与 roadmap/HOTSPOTS.md，ID 一一对应。
 * 本文件只操作浏览器本地状态，不修改仓库文件；离线双击 dashboard.html 即可使用。
 */

/**
 * 数据层已拆分到 dashboard-data.js（MILESTONES / HOTSPOTS / QUESTIONS 及配置常量），
 * 本文件只负责渲染、事件与本地状态，保持「数据与 UI 组装分离」。
 */

/** 运行时状态：只保存用户可改的状态与选中节点，数据定义仍以常量为准。 */
let state = { version: STATE_VERSION, milestones: {}, hotspots: {}, selectedId: "M0" };

/**
 * 按 ID 获取 DOM 元素。
 * @param {string} id 元素 ID
 * @returns {HTMLElement} 元素
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少页面元素 #${id}`);
  return el;
}

/**
 * 读取 CSS 变量，避免把颜色硬编码在脚本里。
 * @param {string} name 变量名
 * @returns {string} 颜色值
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 显示用户可见的提示信息。
 * @param {string} text 提示文本
 * @param {string} kind ok 或 error
 * @returns {void}
 */
function showMessage(text, kind) {
  try {
    const box = byId("message");
    box.textContent = text;
    box.className = `message show ${kind}`;
    window.setTimeout(() => { box.className = "message"; }, MESSAGE_TIMEOUT_MS);
  } catch (error) {
    console.error("[看板] 显示提示失败：", error);
  }
}

/**
 * 记录错误并向用户显示友好提示，禁止静默吞异常。
 * @param {string} scene 出错场景
 * @param {unknown} error 异常对象
 * @returns {void}
 */
function reportError(scene, error) {
  console.error(`[看板] ${scene}失败：`, error);
  showMessage(`${scene}失败，已记录详细日志到控制台，请稍后重试。`, "error");
}

/**
 * 从 localStorage 恢复状态，损坏数据回退到默认值。
 * @returns {void}
 */
function readState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    // 只接受已知 ID 与合法状态值，避免导入脏数据污染渲染
    if (!parsed || parsed.version !== STATE_VERSION) return;
    for (const item of MILESTONES) {
      const value = parsed.milestones?.[item.id];
      if (STATUS_LIST.includes(value)) state.milestones[item.id] = value;
    }
    for (const item of HOTSPOTS) {
      const value = parsed.hotspots?.[item.id];
      if (STATUS_LIST.includes(value)) state.hotspots[item.id] = value;
    }
    if (MILESTONES.some((m) => m.id === parsed.selectedId)) state.selectedId = parsed.selectedId;
  } catch (error) {
    reportError("读取本地进度", error);
  }
}

/**
 * 保存状态到 localStorage。
 * @returns {void}
 */
function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    reportError("保存本地进度", error);
  }
}

/**
 * 取得某条目的当前状态。
 * @param {string} kind milestones 或 hotspots
 * @param {string} id 条目 ID
 * @returns {string} 状态
 */
function statusOf(kind, id) {
  const list = kind === "milestones" ? MILESTONES : HOTSPOTS;
  const item = list.find((entry) => entry.id === id);
  return state[kind][id] || item?.status || STATUS_LIST[0];
}

/**
 * 循环切换到下一个状态。
 * @param {string} current 当前状态
 * @returns {string} 下一个状态
 */
function nextStatus(current) {
  const index = STATUS_LIST.indexOf(current);
  return STATUS_LIST[(index + 1) % STATUS_LIST.length];
}

/**
 * 计算某里程碑的完成度（0~1）。
 * @param {string} milestoneId 里程碑 ID
 * @returns {number} 完成度
 */
function milestoneProgress(milestoneId) {
  const related = HOTSPOTS.filter((h) => h.milestone === milestoneId);
  if (related.length === 0) {
    const status = statusOf("milestones", milestoneId);
    return status === "已完成" ? 1 : status === "进行中" ? 0.5 : 0;
  }
  const done = related.filter((h) => statusOf("hotspots", h.id) === "已完成").length;
  return done / related.length;
}

/**
 * 创建 SVG 元素。
 * @param {string} tag 标签名
 * @param {Record<string, string|number>} attrs 属性表
 * @returns {SVGElement} 元素
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/**
 * 计算节点左上角坐标。
 * @param {{row: number, col: number}} item 里程碑
 * @returns {{x: number, y: number}} 坐标
 */
function nodePos(item) {
  return {
    x: LAYOUT.PAD_X + item.col * (LAYOUT.NODE_W + LAYOUT.GAP_X),
    y: LAYOUT.PAD_Y + item.row * (LAYOUT.NODE_H + LAYOUT.ROW_GAP),
  };
}

/**
 * 渲染里程碑依赖流程图（节点、连线、角标、点击切换状态）。
 * @returns {void}
 */
function renderFlow() {
  try {
    const svg = byId("flow-svg");
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${LAYOUT.SVG_WIDTH} ${LAYOUT.SVG_HEIGHT}`);
    svg.style.height = `${LAYOUT.SVG_HEIGHT}px`;

    const defs = svgEl("defs", {});
    const marker = svgEl("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#6b7c96" }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    // 先画连线，保证节点覆盖在箭头之上
    for (const item of MILESTONES) {
      for (const depId of item.deps) {
        const dep = MILESTONES.find((m) => m.id === depId);
        if (!dep) continue;
        const a = nodePos(dep);
        const b = nodePos(item);
        const x1 = a.x + LAYOUT.NODE_W;
        const y1 = a.y + LAYOUT.NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + LAYOUT.NODE_H / 2;
        // 跨行时用三段折线绕开节点，同行时直接水平连接
        const d = y1 === y2
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${x1 + LAYOUT.GAP_X / 2} ${y1} L ${x1 + LAYOUT.GAP_X / 2} ${y2} L ${x2} ${y2}`;
        svg.appendChild(svgEl("path", { d, class: "flow-edge critical" }));
      }
    }

    for (const item of MILESTONES) {
      const pos = nodePos(item);
      const status = statusOf("milestones", item.id);
      const color = cssVar(STATUS_VAR[status]);
      const related = HOTSPOTS.filter((h) => h.milestone === item.id);
      const blocked = related.filter((h) => statusOf("hotspots", h.id) === "阻塞").length;
      const group = svgEl("g", { class: "flow-node", tabindex: "0", role: "button" });

      const rect = svgEl("rect", { x: pos.x, y: pos.y, width: LAYOUT.NODE_W, height: LAYOUT.NODE_H, rx: 9 });
      rect.style.stroke = color;
      group.appendChild(rect);

      const title = svgEl("text", { x: pos.x + 12, y: pos.y + 25, class: "node-title" });
      title.textContent = `${item.id} ${item.title}`;
      group.appendChild(title);

      const meta = svgEl("text", { x: pos.x + 12, y: pos.y + 46, class: "node-meta" });
      meta.textContent = `${item.period} · ${status}`;
      group.appendChild(meta);

      // 右上角角标：关联热点数；有阻塞时改用红色
      const badge = svgEl("circle", { cx: pos.x + LAYOUT.NODE_W - LAYOUT.BADGE_R - 4, cy: pos.y + LAYOUT.BADGE_R + 4, r: LAYOUT.BADGE_R });
      badge.style.fill = blocked > 0 ? cssVar(STATUS_VAR["阻塞"]) : color;
      group.appendChild(badge);
      const badgeText = svgEl("text", { x: badge.getAttribute("cx"), y: Number(badge.getAttribute("cy")) + 4, class: "badge-text", "text-anchor": "middle" });
      badgeText.textContent = String(related.length);
      group.appendChild(badgeText);

      const tip = svgEl("title", {});
      tip.textContent = `${item.id} ${item.title}\n周期：${item.period}\n状态：${status}\n关联热点：${related.length}，其中阻塞 ${blocked}\n点击切换状态`;
      group.appendChild(tip);

      const activate = () => {
        state.milestones[item.id] = nextStatus(statusOf("milestones", item.id));
        state.selectedId = item.id;
        saveState();
        renderAll();
      };
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      });
      svg.appendChild(group);
    }
  } catch (error) {
    reportError("渲染流程图", error);
  }
}

/**
 * 渲染图例。
 * @returns {void}
 */
function renderLegend() {
  try {
    const box = byId("legend");
    box.replaceChildren();
    for (const status of STATUS_LIST) {
      const wrap = document.createElement("span");
      const dot = document.createElement("i");
      dot.className = "dot";
      dot.style.background = cssVar(STATUS_VAR[status]);
      wrap.append(dot, document.createTextNode(status));
      box.appendChild(wrap);
    }
  } catch (error) {
    reportError("渲染图例", error);
  }
}

/**
 * 渲染里程碑卡片。
 * @returns {void}
 */
function renderCards() {
  try {
    const box = byId("milestone-cards");
    box.replaceChildren();
    for (const item of MILESTONES) {
      const status = statusOf("milestones", item.id);
      const progress = Math.round(milestoneProgress(item.id) * 100);
      const card = document.createElement("div");
      card.className = "card";
      card.style.borderLeftColor = cssVar(STATUS_VAR[status]);
      const head = document.createElement("div");
      head.className = "card-head";
      head.innerHTML = `<span class="card-id">${item.id}</span><span class="card-period">${item.period}</span>`;
      const h3 = document.createElement("h3");
      h3.textContent = item.title;
      const meta = document.createElement("div");
      meta.className = "card-meta";
      meta.textContent = `${status} · 热点完成度 ${progress}%`;
      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = `${progress}%`;
      track.appendChild(fill);
      card.append(head, h3, meta, track);
      card.addEventListener("click", () => { state.selectedId = item.id; saveState(); renderDetail(); });
      box.appendChild(card);
    }
  } catch (error) {
    reportError("渲染里程碑卡片", error);
  }
}

/**
 * 渲染热点表格（受状态与优先级筛选，下拉可改状态）。
 * @returns {void}
 */
function renderTable() {
  try {
    const tbody = byId("hotspot-table").querySelector("tbody");
    const statusFilter = byId("filter-status").value;
    const priorityFilter = byId("filter-priority").value;
    tbody.replaceChildren();
    for (const item of HOTSPOTS) {
      const status = statusOf("hotspots", item.id);
      if (statusFilter !== "ALL" && status !== statusFilter) continue;
      if (priorityFilter !== "ALL" && item.priority !== priorityFilter) continue;
      const tr = document.createElement("tr");
      const cells = [
        `<td class="cell-id">${item.id}</td>`,
        `<td>${item.title}</td>`,
        `<td class="priority ${item.priority}">${item.priority}</td>`,
        `<td>${item.milestone}</td>`,
      ];
      tr.innerHTML = cells.join("");
      const statusCell = document.createElement("td");
      const select = document.createElement("select");
      for (const option of STATUS_LIST) {
        const el = document.createElement("option");
        el.value = option;
        el.textContent = option;
        if (option === status) el.selected = true;
        select.appendChild(el);
      }
      select.dataset.hotspotId = item.id;
      statusCell.appendChild(select);
      tr.appendChild(statusCell);
      const actionCell = document.createElement("td");
      actionCell.className = "cell-action";
      actionCell.textContent = item.action;
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    }
  } catch (error) {
    reportError("渲染热点表格", error);
  }
}

/**
 * 渲染决策台账：状态徽章、结论、期限与来源，支持按「待决 / 已决」筛选。
 * @returns {void}
 */
function renderQuestions() {
  try {
    const box = byId("question-list");
    const filter = byId("filter-decision").value;
    const decided = QUESTIONS.filter((q) => q.status === DECISION_STATUS.DECIDED).length;
    byId("question-stats").textContent = `共 ${QUESTIONS.length} 项 · 已决 ${decided} · 待决 ${QUESTIONS.length - decided}`;
    box.replaceChildren();
    for (const item of QUESTIONS) {
      // 筛选只影响显示，不改变数据或统计口径
      if (filter !== "ALL" && item.status !== filter) continue;
      const isDecided = item.status === DECISION_STATUS.DECIDED;
      const li = document.createElement("li");
      li.className = isDecided ? "decided" : "open";

      const head = document.createElement("div");
      head.className = "q-head";
      const idEl = document.createElement("b");
      idEl.className = "q-id";
      idEl.textContent = item.id;
      const badge = document.createElement("span");
      badge.className = `q-badge ${isDecided ? "decided" : "open"}`;
      badge.textContent = item.status;
      const text = document.createElement("span");
      text.className = "q-text";
      text.textContent = item.text;
      head.append(idEl, badge, text);
      li.appendChild(head);

      if (item.decision) {
        const decision = document.createElement("div");
        decision.className = "q-decision";
        decision.textContent = `${isDecided ? "结论" : "进展"}：${item.decision}`;
        li.appendChild(decision);
      }

      const meta = document.createElement("div");
      meta.className = "q-meta";
      meta.append(document.createTextNode(`${item.due} · 来源 `));
      const link = document.createElement("a");
      link.href = item.source;
      link.textContent = item.source;
      meta.appendChild(link);
      li.appendChild(meta);
      box.appendChild(li);
    }
  } catch (error) {
    reportError("渲染决策台账", error);
  }
}

/**
 * 显示数据版本，便于确认浏览器没有加载缓存中的旧脚本。
 * @returns {void}
 */
function renderDataVersion() {
  try {
    byId("data-version").textContent = `${DATA_VERSION}（${DATA_UPDATED_AT}）`;
  } catch (error) {
    reportError("显示数据版本", error);
  }
}

/**
 * 渲染右侧详情面板。
 * @returns {void}
 */
function renderDetail() {
  try {
    const item = MILESTONES.find((m) => m.id === state.selectedId) || MILESTONES[0];
    const box = byId("detail-content");
    box.replaceChildren();
    const status = statusOf("milestones", item.id);
    const progress = Math.round(milestoneProgress(item.id) * 100);
    const related = HOTSPOTS.filter((h) => h.milestone === item.id);
    const deps = item.deps.length > 0 ? item.deps.join("、") : "无";
    const list = related.length > 0
      ? `<ul class="detail-list">${related.map((h) => `<li>${h.id} ${h.title}（${statusOf("hotspots", h.id)}）</li>`).join("")}</ul>`
      : "<p>无直接关联热点</p>";
    box.innerHTML = `
      <div class="detail-item"><strong>节点</strong>${item.id} · ${item.title}</div>
      <div class="detail-item"><strong>周期</strong>${item.period}</div>
      <div class="detail-item"><strong>状态 / 热点完成度</strong>${status} · ${progress}%</div>
      <div class="detail-item"><strong>前置依赖</strong>${deps}</div>
      <div class="detail-item"><strong>验收 DoD</strong>${item.dod}</div>
      <div class="detail-item"><strong>关联热点</strong>${list}</div>
    `;
  } catch (error) {
    reportError("渲染详情面板", error);
  }
}

/**
 * 渲染总体进度与统计。
 * @returns {void}
 */
function renderOverview() {
  try {
    const total = MILESTONES.reduce((sum, m) => sum + milestoneProgress(m.id), 0) / MILESTONES.length;
    const percent = Math.round(total * 100);
    byId("overall-percent").textContent = `${percent}%`;
    byId("overall-bar").style.width = `${percent}%`;
    const counts = STATUS_LIST.map((s) => `${s} ${HOTSPOTS.filter((h) => statusOf("hotspots", h.id) === s).length}`);
    const blocked = HOTSPOTS.filter((h) => statusOf("hotspots", h.id) === "阻塞").length;
    byId("overall-stats").textContent = `热点：${counts.join(" / ")} · 当前阻塞 ${blocked} 项`;
  } catch (error) {
    reportError("渲染总体进度", error);
  }
}

/**
 * 全量重绘。
 * @returns {void}
 */
function renderAll() {
  renderDataVersion();
  renderFlow();
  renderLegend();
  renderCards();
  renderTable();
  renderQuestions();
  renderDetail();
  renderOverview();
}

/**
 * 导入导出层已拆分到 dashboard-io.js，本文件通过全局函数声明调用。
 */

/**
 * 绑定页面交互事件（统一事件委托，避免逐行重复绑定）。
 * @returns {void}
 */
function bindEvents() {
  byId("filter-status").addEventListener("change", renderTable);
  byId("filter-priority").addEventListener("change", renderTable);
  byId("filter-decision").addEventListener("change", renderQuestions);
  byId("btn-reload").addEventListener("click", () => { window.location.reload(); });
  byId("hotspot-table").addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.dataset.hotspotId) return;
    state.hotspots[target.dataset.hotspotId] = target.value;
    saveState();
    renderAll();
  });
  byId("btn-export").addEventListener("click", exportJson);
  byId("btn-import").addEventListener("click", () => byId("file-input").click());
  byId("file-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importJson(file);
    event.target.value = "";
  });
  byId("btn-reset").addEventListener("click", resetAll);
}

/**
 * 初始化看板。
 * @returns {void}
 */
function init() {
  try {
    readState();
    bindEvents();
    renderAll();
  } catch (error) {
    reportError("初始化看板", error);
  }
}

document.addEventListener("DOMContentLoaded", init);
