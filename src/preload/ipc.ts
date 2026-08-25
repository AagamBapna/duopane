import { ipcRenderer } from 'electron'
import type { MainSendMap, RendererInvokeMap, RendererSendMap } from '../shared/types'

export function send<C extends keyof RendererSendMap>(
  channel: C,
  ...args: RendererSendMap[C]
): void {
  ipcRenderer.send(channel, ...args)
}

export function invoke<C extends keyof RendererInvokeMap>(
  channel: C,
  ...args: RendererInvokeMap[C]['args']
): Promise<RendererInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<RendererInvokeMap[C]['result']>
}

export function on<C extends keyof MainSendMap>(
  channel: C,
  listener: (...args: MainSendMap[C]) => void,
): void {
  ipcRenderer.on(channel, (_event, ...args) => listener(...(args as MainSendMap[C])))
}
