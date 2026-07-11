import type { IpcEventChannel, IpcEventPayload } from '../../ipc/contract.js';

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
