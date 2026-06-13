import { describe, expect, it } from 'vitest';
import type { VoiceTranscript } from '../domain/types';
import { VoiceCommandQueue } from './voiceCommandQueue';

const transcript = (text: string): VoiceTranscript => ({
  text,
  confidence: 0.95,
  receivedAt: 1,
  isFinal: true,
  source: 'final'
});

describe('VoiceCommandQueue', () => {
  it('按入队顺序串行取出语音命令', () => {
    const queue = new VoiceCommandQueue();
    queue.enqueue(transcript('画猫'), 1);
    queue.enqueue(transcript('删除帽子'), 1);

    expect(queue.snapshot().pendingCommands.map((item) => item.text)).toEqual(['画猫', '删除帽子']);
    expect(queue.takeNext()?.transcript.text).toBe('画猫');
    expect(queue.takeNext()?.transcript.text).toBe('删除帽子');
    expect(queue.takeNext()).toBeNull();
  });

  it('快照会区分正在处理和等待中的命令', () => {
    const queue = new VoiceCommandQueue();
    const { item } = queue.enqueue(transcript('画一个房子'), 3);
    queue.enqueue(transcript('把房子向右移动'), 3);
    queue.takeNext();

    expect(queue.snapshot()).toMatchObject({
      activeCommand: { commandId: item.commandId, text: '画一个房子', sceneRevision: 3 },
      pendingCount: 1,
      pendingCommands: [{ text: '把房子向右移动', sceneRevision: 3 }]
    });
  });

  it('可以取消尚未处理的命令', async () => {
    const queue = new VoiceCommandQueue();
    const first = queue.enqueue(transcript('画猫'), 1);
    const second = queue.enqueue(transcript('删除帽子'), 1);
    queue.takeNext();

    expect(queue.cancelPending('测试取消')).toBe(1);
    await expect(second.done).rejects.toThrow('测试取消');
    queue.markCompleted(first.item.commandId);
    await expect(first.done).resolves.toBeUndefined();
  });
});
