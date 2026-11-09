"use strict";

/**
 * 看板进度口径的纯计算层（单一数据源改造）。
 *
 * 里程碑状态是**只读派生值**：完全由关联热点状态推导，不允许手动覆盖。
 * 唯一可写的数据是热点状态（页面表格 / 导入 JSON / localStorage）。
 * 依赖全局 HOTSPOTS / STATUS_LIST（dashboard-data.js）与 statusOf（dashboard.js）。
 * 本文件必须在 dashboard.js 之前加载；函数体只在调用时读取 statusOf，加载顺序安全。
 */

/**
 * 计算某里程碑的完成度（0~1）：关联热点中「已完成」占比。
 * @param {string} milestoneId 里程碑 ID
 * @returns {number} 完成度
 */
function milestoneProgress(milestoneId) {
  const related = HOTSPOTS.filter((h) => h.milestone === milestoneId);
  if (related.length === 0) return 0;
  const done = related.filter((h) => statusOf("hotspots", h.id) === "已完成").length;
  return done / related.length;
}

/**
 * 由关联热点状态推导里程碑状态（唯一真值来源）。
 * 优先级：全部已完成 → 已完成；存在阻塞 → 阻塞；存在进行中/已完成 → 进行中；否则未开始。
 * @param {string} milestoneId 里程碑 ID
 * @returns {string} 状态
 */
function derivedMilestoneStatus(milestoneId) {
  const related = HOTSPOTS.filter((h) => h.milestone === milestoneId);
  if (related.length === 0) return STATUS_LIST[0];
  const statuses = related.map((h) => statusOf("hotspots", h.id));
  if (statuses.every((s) => s === "已完成")) return "已完成";
  if (statuses.includes("阻塞")) return "阻塞";
  if (statuses.includes("进行中") || statuses.includes("已完成")) return "进行中";
  return "未开始";
}

/**
 * 汇总一个里程碑的进度，供流程图、卡片与详情面板共用。
 * @param {string} milestoneId 里程碑 ID
 * @returns {{done:number,total:number,percent:number,status:string}} 汇总
 */
function milestoneSummary(milestoneId) {
  const related = HOTSPOTS.filter((h) => h.milestone === milestoneId);
  const done = related.filter((h) => statusOf("hotspots", h.id) === "已完成").length;
  return {
    done,
    total: related.length,
    percent: related.length === 0 ? 0 : Math.round((done / related.length) * 100),
    status: derivedMilestoneStatus(milestoneId),
  };
}
