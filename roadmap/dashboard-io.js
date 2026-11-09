"use strict";

/**
 * 看板的导入导出层：进度 JSON 导出、导入与重置（单一数据源改造）。
 *
 * 里程碑状态由热点自动推导、不可手动覆盖，因此：
 * - 导出只包含**唯一可写数据**：热点状态与选中节点；里程碑状态可由热点重算，不落盘。
 * - 导入显式忽略旧文件里的 milestones 字段（兼容旧导出），只合并热点状态。
 * 依赖 dashboard-data.js 的数据常量与 dashboard.js 的状态/提示工具，须在其之后加载。
 */

/**
 * 导出当前进度为 JSON 文件。
 * @returns {void}
 */
function exportJson() {
  try {
    const payload = {
      version: STATE_VERSION,
      exportedAt: new Date().toISOString(),
      note: "里程碑状态由关联热点自动推导，不写入进度文件",
      hotspots: Object.fromEntries(HOTSPOTS.map((h) => [h.id, statusOf("hotspots", h.id)])),
      selectedId: state.selectedId,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opencut-roadmap-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showMessage("进度已导出，可把结果回填到 HOTSPOTS.md §3 进度台账。", "ok");
  } catch (error) {
    reportError("导出进度", error);
  }
}

/**
 * 导入进度 JSON，只合并热点状态；里程碑字段被忽略。
 * @param {File} file 用户选择的文件
 * @returns {void}
 */
function importJson(file) {
  try {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || parsed.version !== STATE_VERSION) throw new Error("版本不匹配或文件结构无效");
        for (const item of HOTSPOTS) {
          const value = parsed.hotspots?.[item.id];
          if (STATUS_LIST.includes(value)) state.hotspots[item.id] = value;
        }
        if (MILESTONES.some((m) => m.id === parsed.selectedId)) state.selectedId = parsed.selectedId;
        saveState();
        renderAll();
        showMessage("进度已导入；里程碑状态已按热点自动重算（不可手动覆盖）。", "ok");
      } catch (error) {
        reportError("解析进度文件", error);
      }
    };
    reader.onerror = () => reportError("读取进度文件", new Error("FileReader 报错"));
    reader.readAsText(file);
  } catch (error) {
    reportError("导入进度", error);
  }
}

/**
 * 重置为文档基线状态（清空热点覆盖，里程碑自动回到推导值）。
 * @returns {void}
 */
function resetAll() {
  try {
    if (!window.confirm("确定清空本机保存的进度，恢复到文档基线状态？")) return;
    state = { version: STATE_VERSION, hotspots: {}, selectedId: "M0" };
    window.localStorage.removeItem(STORAGE_KEY);
    renderAll();
    showMessage("已恢复基线状态，里程碑由热点自动推导。", "ok");
  } catch (error) {
    reportError("重置进度", error);
  }
}
