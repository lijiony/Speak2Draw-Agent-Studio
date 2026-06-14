export type WorkbenchLayout = 'focus' | 'side-inspector' | 'bottom-inspector';

export const detectLayoutCommand = (text: string): WorkbenchLayout | null => {
  const normalized = text.replace(/\s+/g, '');

  if (/(打开|显示|展开|调出|看看).*(对象信息|对象检查器|当前对象|属性面板|右侧栏|侧边栏)/.test(normalized)) {
    return 'side-inspector';
  }

  if (
    /(打开|显示|展开|调出|切换到).*(底部栏|底栏|下栏|底部对象|下方对象|上下分栏)/.test(normalized) ||
    /(底部|下方|下面).*(显示|打开|展开).*(对象|检查器|信息)/.test(normalized)
  ) {
    return 'bottom-inspector';
  }

  if (/(关闭|隐藏|收起).*(对象信息|对象检查器|当前对象|属性面板|右侧栏|侧边栏|底部栏|底栏|下栏)/.test(normalized)) {
    return 'focus';
  }

  if (/(专注画布|恢复画布模式|恢复左右栏|返回画布模式|最大化画布|只看画布)/.test(normalized)) {
    return 'focus';
  }

  return null;
};

export const workbenchLayoutMessage = (layout: WorkbenchLayout) => {
  if (layout === 'side-inspector') return '已打开右侧对象检查器。';
  if (layout === 'bottom-inspector') return '已打开底部对象检查器。';
  return '已恢复画布专注模式。';
};
