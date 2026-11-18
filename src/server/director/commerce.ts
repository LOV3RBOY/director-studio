import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Environment, SignedDataVerifier, Type, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { z } from "zod";
import { balance, grant } from "../credits";
import { all, get, run, tx } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import { mode } from "./runtime";

const items = z.record(z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/), z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription") }),
  z.object({ kind: z.literal("credits"), millicredits: z.number().int().positive().max(1_000_000_000) }),
]));
type Product = z.infer<typeof items>[string];
interface Store {
  environment: "sandbox" | "production";
  products: Record<string, Product>;
  verifier: SignedDataVerifier;
}

let loaded: Store | null | undefined;
function store(): Store | null {
  if (mode() !== "live") return null;
  if (loaded !== undefined) return loaded;
  try {
    const environment = process.env.DIRECTOR_STOREKIT_MODE;
    if (environment !== "sandbox" && environment !== "production") return loaded = null;
    const bundleId = process.env.DIRECTOR_APPLE_BUNDLE_ID;
    const appId = Number(process.env.DIRECTOR_APPLE_APP_ID);
    const certs = process.env.DIRECTOR_APPLE_ROOT_CA_FILES?.split(",").map((file) => readFileSync(file.trim()));
    const products = items.parse(JSON.parse(process.env.DIRECTOR_APPLE_PRODUCTS ?? "{}"));
    if (!bundleId || !certs?.length || !Object.keys(products).length || (environment === "production" && (!Number.isSafeInteger(appId) || appId <= 0))) {
      return loaded = null;
    }
    const verifier = new SignedDataVerifier(certs, true, environment === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION, bundleId, appId || undefined);
    loaded = { environment, products, verifier };
  } catch {
    loaded = null;
  }
  return loaded;
}

export const commerceAvailable = () => store() !== null;

function requireStore(): Store {
  const value = store();
  if (!value) throw new ApiError(503, "store_unavailable", "Purchases are unavailable in this workspace.");
  return value;
}

function getToken(userId: string) {
  return tx(() => {
    run("INSERT INTO director_store_accounts (user_id, token) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING", userId, randomUUID());
    return get<{ token: string }>("SELECT token FROM director_store_accounts WHERE user_id = ?", userId)!.token;
  });
}

function expiration(current: Store, userId: string): number | null {
  const subscriptions = all<{ expires_at: number; product_id: string }>(
    "SELECT expires_at, product_id FROM director_store_transactions WHERE environment = ? AND user_id = ? AND kind = 'subscription' AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at DESC",
    current.environment, userId, Date.now(),
  );
  return subscriptions.find((row) => current.products[row.product_id]?.kind === "subscription")?.expires_at ?? null;
}

export function purchaseOptions(userId: string) {
  const current = requireStore();
  const available = current.environment === "sandbox"
    ? get<{ total: number }>("SELECT COALESCE(SUM(granted), 0) AS total FROM director_store_transactions WHERE environment = 'sandbox' AND user_id = ? AND kind = 'credits' AND revoked_at IS NULL", userId)!.total
    : balance(userId);
  return {
    appAccountToken: getToken(userId), balance: available, expiresAt: expiration(current, userId), environment: current.environment,
    products: Object.entries(current.products).map(([id, product]) => ({ id, ...product })),
  };
}

export function requireAuthoringEntitlement(userId: string) {
  if (process.env.DIRECTOR_SUBSCRIPTION_REQUIRED !== "1") return;
  const current = requireStore();
  if (current.environment !== "production" || expiration(current, userId) === null) {
    throw new ApiError(403, "subscription_required", "An active Studio subscription is required for new authoring jobs.");
  }
}

interface VerifiedTransaction {
  transactionId: string; originalId: string | null; productId: string; product: Product;
  signedAt: number; expiresAt: number | null; revokedAt: number | null; token: string;
}

function matchingTransaction(current: Store, receipt: JWSTransactionDecodedPayload): VerifiedTransaction {
  const { transactionId, originalTransactionId, productId, signedDate, appAccountToken, expiresDate, revocationDate } = receipt;
  const product = productId ? current.products[productId] : undefined;
  const expected = product?.kind === "credits" ? Type.CONSUMABLE : Type.AUTO_RENEWABLE_SUBSCRIPTION;
  if (!product || !productId || receipt.type !== expected || !transactionId || !appAccountToken || !signedDate || (product.kind === "subscription" && !expiresDate)) {
    throw badRequest("This Apple transaction does not match a configured Studio product and account.");
  }
  return {
    transactionId, originalId: originalTransactionId ?? null, productId, product, token: appAccountToken.toLowerCase(),
    signedAt: signedDate, expiresAt: receipt.isUpgraded ? null : expiresDate ?? null, revokedAt: revocationDate ?? null,
  };
}

async function verifiedTransaction(current: Store, signedTransaction: string) {
  let receipt: JWSTransactionDecodedPayload;
  try {
    receipt = await current.verifier.verifyAndDecodeTransaction(signedTransaction);
  } catch {
    throw new ApiError(422, "store_verification_failed", "Apple transaction verification failed. Retry from Purchases.");
  }
  return matchingTransaction(current, receipt);
}

function record(current: Store, userId: string, receipt: VerifiedTransaction) {
  return tx(() => {
    const old = get<{ user_id: string; product_id: string; signed_at: number; revoked_at: number | null; granted: number }>(
      "SELECT user_id, product_id, signed_at, revoked_at, granted FROM director_store_transactions WHERE environment = ? AND transaction_id = ?",
      current.environment, receipt.transactionId,
    );
    if (old && (old.user_id !== userId || old.product_id !== receipt.productId)) throw notFound();
    if (old && old.signed_at >= receipt.signedAt) return;
    const revoke = old?.revoked_at ?? receipt.revokedAt;
    const credits = old?.granted ?? (receipt.product.kind === "credits" && !revoke ? receipt.product.millicredits : 0);
    run(
      `INSERT INTO director_store_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(environment, transaction_id) DO UPDATE SET
       expires_at = excluded.expires_at, revoked_at = excluded.revoked_at, signed_at = excluded.signed_at`,
      current.environment, receipt.transactionId, receipt.originalId, userId, receipt.productId, receipt.product.kind,
      credits, receipt.expiresAt, revoke, receipt.signedAt,
    );
    if (current.environment === "production") {
      if (!old && credits) grant(userId, "topup", credits, "App Store render credits");
      if (old && !old.revoked_at && revoke && credits) grant(userId, "adjust", -credits, "App Store credit purchase reversed");
    }
  });
}

export async function applyPurchase(userId: string, signedTransaction: string) {
  const current = requireStore();
  const receipt = await verifiedTransaction(current, signedTransaction);
  if (receipt.token !== getToken(userId)) throw notFound("This purchase belongs to another Studio account.");
  record(current, userId, receipt);
  return purchaseOptions(userId);
}

export async function handleStoreNotification(signedPayload: string) {
  const current = requireStore();
  let signedTransaction: string | undefined;
  try {
    const notification = await current.verifier.verifyAndDecodeNotification(signedPayload);
    signedTransaction = notification.data?.signedTransactionInfo;
  } catch {
    throw new ApiError(422, "store_notification_invalid", "Apple notification verification failed.");
  }
  if (!signedTransaction) return;
  const receipt = await verifiedTransaction(current, signedTransaction);
  const account = get<{ user_id: string }>("SELECT user_id FROM director_store_accounts WHERE token = ?", receipt.token);
  if (account) record(current, account.user_id, receipt);
}
