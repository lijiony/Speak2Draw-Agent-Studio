import { describe, expect, it } from 'vitest';
import { detectLayoutCommand, workbenchLayoutMessage } from './workbenchLayout';

describe('detectLayoutCommand', () => {
  it('识别右侧对象检查器命令', () => {
    expect(detectLayoutCommand('打开对象信息')).toBe('side-inspector');
    expect(detectLayoutCommand('显示右侧栏')).toBe('side-inspector');
    expect(detectLayoutCommand('调出当前对象属性面板')).toBe('side-inspector');
  });

  it('识别底部对象检查器命令', () => {
    expect(detectLayoutCommand('打开底部栏')).toBe('bottom-inspector');
    expect(detectLayoutCommand('底部显示对象')).toBe('bottom-inspector');
    expect(detectLayoutCommand('切换到上下分栏')).toBe('bottom-inspector');
  });

  it('识别恢复画布专注模式命令', () => {
    expect(detectLayoutCommand('隐藏对象信息')).toBe('focus');
    expect(detectLayoutCommand('关闭侧边栏')).toBe('focus');
    expect(detectLayoutCommand('恢复画布模式')).toBe('focus');
  });

  it('为布局切换生成中文反馈', () => {
    expect(workbenchLayoutMessage('side-inspector')).toBe('已打开右侧对象检查器。');
    expect(workbenchLayoutMessage('bottom-inspector')).toBe('已打开底部对象检查器。');
    expect(workbenchLayoutMessage('focus')).toBe('已恢复画布专注模式。');
  });
});
