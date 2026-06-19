import { contextBridge, ipcRenderer } from 'electron';
import type { RawRequestRow } from './store/types';

const rawSniffer = {
  get: (): Promise<RawRequestRow | null> => ipcRenderer.invoke('raw:get'),
};

contextBridge.exposeInMainWorld('rawSniffer', rawSniffer);

export type RawSnifferAPI = typeof rawSniffer;
