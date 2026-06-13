import type { VoiceTranscript } from '../domain/types';

export interface VoiceCommandItem {
  commandId: string;
  transcript: VoiceTranscript;
  sceneRevision: number;
  enqueuedAt: number;
  resolve?: () => void;
  reject?: (error: unknown) => void;
}

export interface VoiceCommandQueueSnapshot {
  activeCommand: Pick<VoiceCommandItem, 'commandId' | 'sceneRevision'> & { text: string; source?: VoiceTranscript['source'] } | null;
  pendingCommands: Array<Pick<VoiceCommandItem, 'commandId' | 'sceneRevision'> & { text: string; source?: VoiceTranscript['source'] }>;
  pendingCount: number;
}

export class VoiceCommandQueue {
  private items: VoiceCommandItem[] = [];
  private active: VoiceCommandItem | null = null;
  private nextId = 1;

  enqueue(transcript: VoiceTranscript, sceneRevision: number) {
    let resolve: (() => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const done = new Promise<void>((doneResolve, doneReject) => {
      resolve = doneResolve;
      reject = doneReject;
    });
    const item: VoiceCommandItem = {
      commandId: `cmd-${Date.now()}-${this.nextId++}`,
      transcript,
      sceneRevision,
      enqueuedAt: performance.now(),
      resolve,
      reject
    };
    this.items.push(item);
    return { item, done };
  }

  takeNext() {
    this.active = this.items.shift() ?? null;
    return this.active;
  }

  markCompleted(commandId: string) {
    if (this.active?.commandId === commandId) {
      this.active.resolve?.();
      this.active = null;
    }
  }

  markFailed(commandId: string, error: unknown) {
    if (this.active?.commandId === commandId) {
      this.active.reject?.(error);
      this.active = null;
    }
  }

  cancelPending(reason: string) {
    const canceled = this.items.splice(0);
    canceled.forEach((item) => item.reject?.(new Error(reason)));
    return canceled.length;
  }

  get length() {
    return this.items.length;
  }

  snapshot(): VoiceCommandQueueSnapshot {
    return {
      activeCommand: toSnapshotItem(this.active),
      pendingCommands: this.items.map(toSnapshotItem).filter(Boolean) as VoiceCommandQueueSnapshot['pendingCommands'],
      pendingCount: this.items.length
    };
  }
}

const toSnapshotItem = (item: VoiceCommandItem | null) =>
  item
    ? {
        commandId: item.commandId,
        sceneRevision: item.sceneRevision,
        text: item.transcript.text,
        source: item.transcript.source
      }
    : null;
