/**
 * The admin pages, in the order the home page lists them (v0.2.0 plan §5.2). Each page's scopes
 * are PAR-447 (scopes.ts).
 */
import type { AdminPage } from "./app.js";
import { everydayPage } from "./everyday-page.js";

export const ADMIN_PAGES: readonly AdminPage[] = Object.freeze([everydayPage]);
