import { invoke } from "@tauri-apps/api/core";
import type { Item, ItemKind, ItemPayload, ItemSummary } from "./schemas";

export type CmdError = { code: string; message: string };

export type GenOptions = {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  exclude_ambiguous: boolean;
};

export type NewItem = {
  kind: ItemKind;
  name: string;
  favorite?: boolean;
  folder_id?: string | null;
  payload: ItemPayload;
};

export type UpdateItemInput = {
  id: string;
  kind: ItemKind;
  name: string;
  favorite: boolean;
  folder_id: string | null;
  payload: ItemPayload;
};

export type TotpSpec = {
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
};

export type TotpSnapshot = {
  code: string;
  remaining: number;
  period: number;
};

export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
};

export const api = {
  vaultExists: () => invoke<boolean>("vault_exists"),
  vaultCreate: (password: string) => invoke<void>("vault_create", { password }),
  vaultUnlock: (password: string) => invoke<void>("vault_unlock", { password }),
  vaultLock: () => invoke<void>("vault_lock"),
  vaultIsLocked: () => invoke<boolean>("vault_is_locked"),

  itemList: () => invoke<ItemSummary[]>("item_list"),
  itemGet: (id: string) => invoke<Item | null>("item_get", { id }),
  itemCreate: (input: NewItem) => invoke<string>("item_create", { input }),
  itemUpdate: (input: UpdateItemInput) => invoke<void>("item_update", { input }),
  itemDelete: (id: string) => invoke<void>("item_delete", { id }),

  genPassword: (opts: GenOptions) => invoke<string>("gen_password", { opts }),
  clipboardCopy: (text: string, ttlSecs = 20) =>
    invoke<void>("clipboard_copy", { text, ttlSecs }),

  totpNow: (spec: TotpSpec) => invoke<TotpSnapshot>("totp_now", { spec }),

  folderList: () => invoke<Folder[]>("folder_list"),
  folderCreate: (name: string, parentId: string | null = null) =>
    invoke<string>("folder_create", { name, parentId }),
  folderRename: (id: string, name: string) =>
    invoke<void>("folder_rename", { id, name }),
  folderDelete: (id: string) => invoke<void>("folder_delete", { id }),

  vaultExport: (path: string, passphrase: string) =>
    invoke<void>("vault_export", { path, passphrase }),
  vaultImport: (path: string, passphrase: string, strategy: ImportStrategy) =>
    invoke<ImportReport>("vault_import", { path, passphrase, strategy }),

  autofillFill: (itemId: string) =>
    invoke<void>("autofill_fill", { itemId }),

  bridgePairComplete: (id: string, allow: boolean) =>
    invoke<void>("bridge_pair_complete", { id, allow }),
  bridgeCredsComplete: (
    id: string,
    allow: boolean,
    selectedItemId: string | null,
  ) =>
    invoke<void>("bridge_creds_complete", {
      id,
      allow,
      selectedItemId,
    }),
};

export type PairRequest = {
  request_id: string;
  extension_name: string;
};
export type CredsCandidate = {
  id: string;
  name: string;
  username: string;
  url: string;
};
export type CredsRequest = {
  request_id: string;
  origin: string;
  candidates: CredsCandidate[];
};

export type ImportStrategy = "skip" | "overwrite" | "keep_both";

export type ImportReport = {
  imported: number;
  skipped: number;
  overwritten: number;
  folders_added: number;
};
