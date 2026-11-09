"use strict";

/**
 * 看板进度口径的纯计算层（W-09 看板 UX 修复时从 dashboard.js 抽离）。
 *
 * 这里刻意区分两套互相独立的数据：
 * - 「人工标记」= statusOf("milestones", id)，用户点击节点切换并持久化在 localStorage；
 * - 「客观进度」= 关联热点里「已完成」占比，来自仓库数据层 HOTSPOTS。
 * 两者不互相校验，所以 UI 必须分别展示并在冲突时给出提示。
 *
 * 依赖全局 HOTSPOTS / STATUS_LIST（dashboard-data.js）与 statusOf（dashboard.js）。
 * 本文件必须在 dashboard.js 之前加载；函数体只在调用时读取 statusOf，加载顺序安全。
 */

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
 * 由关联热点状态推导里程碑的「客观状态」。
 * 与 statusOf("milestones") 的「人工标记」相互独立，两者不一致时需要显式提示。
 * @param {string} milestoneId 里程碑 ID
 * @returns {string} 客观状态
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
 * 汇总一个里程碑的两种口径，供流程图、卡片与详情面板共用。
 * conflict 只在「人工标记已完成、但热点客观未完成」时为真，避免默认状态下满屏告警。
 * @param {string} milestoneId 里程碑 ID
 * @returns {{done:number,total:number,percent:number,manual:string,derived:string,conflict:boolean}} 汇总
 */
function milestoneSummary(milestoneId) {
  const related = HOTSPOTS.filter((h) => h.milestone === milestoneId);
  const done = related.filter((h) => statusOf("hotspots", h.id) === "已完成").length;
  const manual = statusOf("milestones", milestoneId);
  const derived = derivedMilestoneStatus(milestoneId);
  return {
    done,
    total: related.length,
    percent: related.length === 0 ? 0 : Math.round((done / related.length) * 100),
    manual,
    derived,
    conflict: manual === "已完成" && derived !== "已完成",
  };
}
