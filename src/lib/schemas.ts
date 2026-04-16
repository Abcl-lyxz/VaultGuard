import { z } from "zod";

export const ItemKindSchema = z.enum([
  "login",
  "card",
  "pin_note",
  "crypto_wallet",
  "identity",
  "ssh_key",
  "api_key",
  "totp",
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ItemSummarySchema = z.object({
  id: z.string().uuid(),
  kind: ItemKindSchema,
  name: z.string(),
  favorite: z.boolean(),
  folder_id: z.string().uuid().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type ItemSummary = z.infer<typeof ItemSummarySchema>;

const LoginPayload = z.object({
  kind: z.literal("login"),
  username: z.string().default(""),
  password: z.string().default(""),
  url: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  totp_secret: z.string().nullable().default(null),
});

const CardPayload = z.object({
  kind: z.literal("card"),
  cardholder: z.string().default(""),
  number: z.string().default(""),
  cvv: z.string().default(""),
  expiry_month: z.number().int().min(1).max(12).default(1),
  expiry_year: z.number().int().min(2000).max(2099).default(2030),
  notes: z.string().nullable().default(null),
});

const PinNotePayload = z.object({
  kind: z.literal("pin_note"),
  title: z.string().default(""),
  body: z.string().default(""),
});

const CryptoWalletPayload = z.object({
  kind: z.literal("crypto_wallet"),
  wallet_name: z.string().default(""),
  seed_phrase: z.string().default(""),
  chain: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

const IdentityPayload = z.object({
  kind: z.literal("identity"),
  full_name: z.string().default(""),
  national_id: z.string().nullable().default(null),
  passport: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

const SshKeyPayload = z.object({
  kind: z.literal("ssh_key"),
  label: z.string().default(""),
  private_key: z.string().default(""),
  public_key: z.string().nullable().default(null),
  passphrase: z.string().nullable().default(null),
});

const ApiKeyPayload = z.object({
  kind: z.literal("api_key"),
  service: z.string().default(""),
  key: z.string().default(""),
  secret: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

const TotpPayload = z.object({
  kind: z.literal("totp"),
  label: z.string().default(""),
  secret: z.string().default(""),
  issuer: z.string().nullable().default(null),
  algorithm: z.string().default("SHA1"),
  digits: z.number().int().default(6),
  period: z.number().int().default(30),
});

export const ItemPayloadSchema = z.discriminatedUnion("kind", [
  LoginPayload,
  CardPayload,
  PinNotePayload,
  CryptoWalletPayload,
  IdentityPayload,
  SshKeyPayload,
  ApiKeyPayload,
  TotpPayload,
]);
export type ItemPayload = z.infer<typeof ItemPayloadSchema>;

export const ItemSchema = z.object({
  id: z.string().uuid(),
  kind: ItemKindSchema,
  name: z.string(),
  favorite: z.boolean(),
  folder_id: z.string().uuid().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  payload: ItemPayloadSchema,
});
export type Item = z.infer<typeof ItemSchema>;

export const KIND_LABELS: Record<ItemKind, string> = {
  login: "Login",
  card: "Card",
  pin_note: "PIN / Note",
  crypto_wallet: "Crypto wallet",
  identity: "Identity",
  ssh_key: "SSH key",
  api_key: "API key",
  totp: "TOTP",
};

export function emptyPayload(kind: ItemKind): ItemPayload {
  switch (kind) {
    case "login":
      return { kind, username: "", password: "", url: null, notes: null, totp_secret: null };
    case "card":
      return {
        kind,
        cardholder: "",
        number: "",
        cvv: "",
        expiry_month: 1,
        expiry_year: new Date().getFullYear() + 3,
        notes: null,
      };
    case "pin_note":
      return { kind, title: "", body: "" };
    case "crypto_wallet":
      return { kind, wallet_name: "", seed_phrase: "", chain: null, address: null, notes: null };
    case "identity":
      return {
        kind,
        full_name: "",
        national_id: null,
        passport: null,
        email: null,
        phone: null,
        address: null,
        notes: null,
      };
    case "ssh_key":
      return { kind, label: "", private_key: "", public_key: null, passphrase: null };
    case "api_key":
      return { kind, service: "", key: "", secret: null, notes: null };
    case "totp":
      return { kind, label: "", secret: "", issuer: null, algorithm: "SHA1", digits: 6, period: 30 };
  }
}
