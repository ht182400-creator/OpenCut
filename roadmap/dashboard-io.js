"use strict";

/**
 * 动态看板的导入导出层：进度 JSON 导出、导入与重置。
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
      milestones: Object.fromEntries(MILESTONES.map((m) => [m.id, statusOf("milestones", m.id)])),
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
 * 导入进度 JSON 并合并合法状态。
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
        for (const item of MILESTONES) {
          const value = parsed.milestones?.[item.id];
          if (STATUS_LIST.includes(value)) state.milestones[item.id] = value;
        }
        for (const item of HOTSPOTS) {
          const value = parsed.hotspots?.[item.id];
          if (STATUS_LIST.includes(value)) state.hotspots[item.id] = value;
        }
        if (MILESTONES.some((m) => m.id === parsed.selectedId)) state.selectedId = parsed.selectedId;
        saveState();
        renderAll();
        showMessage("进度已导入并保存到本机。", "ok");
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
 * 重置为文档基线状态。
 * @returns {void}
 */
function resetAll() {
  try {
    if (!window.confirm("确定清空本机保存的进度，恢复到文档基线状态？")) return;
    state = { version: STATE_VERSION, milestones: {}, hotspots: {}, selectedId: "M0" };
    window.localStorage.removeItem(STORAGE_KEY);
    renderAll();
    showMessage("已恢复基线状态。", "ok");
  } catch (error) {
    reportError("重置进度", error);
  }
}
