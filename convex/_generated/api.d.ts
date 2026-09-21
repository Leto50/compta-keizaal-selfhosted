/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as administration from "../administration.js";
import type * as auth from "../auth.js";
import type * as bundles from "../bundles.js";
import type * as characters from "../characters.js";
import type * as contacts from "../contacts.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_accountSecurity from "../lib/accountSecurity.js";
import type * as lib_accountSummary from "../lib/accountSummary.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_contacts from "../lib/contacts.js";
import type * as lib_exchange from "../lib/exchange.js";
import type * as lib_inventorySummary from "../lib/inventorySummary.js";
import type * as lib_journalSummary from "../lib/journalSummary.js";
import type * as lib_numbers from "../lib/numbers.js";
import type * as lib_order from "../lib/order.js";
import type * as lib_production from "../lib/production.js";
import type * as lib_products from "../lib/products.js";
import type * as lib_readModels from "../lib/readModels.js";
import type * as lib_recipeCost from "../lib/recipeCost.js";
import type * as lib_recipeFamilies from "../lib/recipeFamilies.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_transactionSearch from "../lib/transactionSearch.js";
import type * as lib_validators from "../lib/validators.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as products from "../products.js";
import type * as recipes from "../recipes.js";
import type * as seed from "../seed.js";
import type * as transactions from "../transactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  administration: typeof administration;
  auth: typeof auth;
  bundles: typeof bundles;
  characters: typeof characters;
  contacts: typeof contacts;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/accountSecurity": typeof lib_accountSecurity;
  "lib/accountSummary": typeof lib_accountSummary;
  "lib/auth": typeof lib_auth;
  "lib/contacts": typeof lib_contacts;
  "lib/exchange": typeof lib_exchange;
  "lib/inventorySummary": typeof lib_inventorySummary;
  "lib/journalSummary": typeof lib_journalSummary;
  "lib/numbers": typeof lib_numbers;
  "lib/order": typeof lib_order;
  "lib/production": typeof lib_production;
  "lib/products": typeof lib_products;
  "lib/readModels": typeof lib_readModels;
  "lib/recipeCost": typeof lib_recipeCost;
  "lib/recipeFamilies": typeof lib_recipeFamilies;
  "lib/text": typeof lib_text;
  "lib/time": typeof lib_time;
  "lib/transactionSearch": typeof lib_transactionSearch;
  "lib/validators": typeof lib_validators;
  migrations: typeof migrations;
  orders: typeof orders;
  products: typeof products;
  recipes: typeof recipes;
  seed: typeof seed;
  transactions: typeof transactions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
