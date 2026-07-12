import type { IpcEventChannel, IpcEventPayload, JobProgressEvent } from '../../ipc/contract.js';

export interface OrchestratorJobProgressEvent {
  jobId: string;
  jobType: string;
  status: string;
  current: number;
  total: number | null;
  message: string | null;
}

export function toIpcJobProgressEvent(event: OrchestratorJobProgressEvent): JobProgressEvent {
  return {
    id: event.jobId,
    jobType: event.jobType,
    status: event.status,
    progressCurrent: event.current,
    progressTotal: event.total,
    progressMessage: event.message,
    message: event.message,
  };
}

export interface IpcSenderLike {
  send(channel: string, payload: unknown): void;
}

export type GetIpcSenders = () => IpcSenderLike[];

export function broadcastIpcEvent<C extends IpcEventChannel>(
  getSenders: GetIpcSenders,
  channel: C,
  payload: IpcEventPayload<C>,
): void {
  for (const sender of getSenders()) {
    sender.send(channel, payload);
  }
}
