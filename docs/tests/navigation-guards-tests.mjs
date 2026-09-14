#!/usr/bin/env node
/**
 * Navigation & permission guardrails (static invariants).
 *
 * These are cheap, deterministic checks over the routing/sidebar source so that
 * a future edit cannot silently re-expose a page to the wrong role or drop a
 * navigation item that a user cannot use.
 *
 * Run:  node docs/tests/navigation-guards-tests.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(root, "artifacts/web/src/App.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "artifacts/web/src/components/layout/sidebar.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "artifacts/web/src/pages/dashboard.tsx"), "utf8");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

// ---- P0: route hardening ---------------------------------------------------
check(
  "print route is behind ProtectedRoute",
  /<Route path="\/print\/:id">\s*<ProtectedRoute/.test(app),
);
check("settings route requires admin", /<Route path="\/settings">\s*<ProtectedRoute component=\{SettingsPage\} adminOnly \/>/.test(app));
for (const route of ["/custody/out/new", "/custody/return/new", "/damage/new", "/central-return/new"]) {
  const re = new RegExp(`<Route path="${route.replace(/\//g, "\\/")}">\\s*<ProtectedRoute component=\\{[A-Za-z]+\\} roles=\\{\\["admin","warehouse_manager"\\]\\} \\/>`);
  check(`operational route limited by role: ${route}`, re.test(app));
}
check("definition routes stay admin-only", /\/items\/new"><ProtectedRoute component=\{ItemsPage\} adminOnly/.test(app) && /\/equipment\/new"><ProtectedRoute component=\{EquipmentPage\} adminOnly/.test(app));

// ---- P1: sidebar information architecture ---------------------------------
check("sidebar declares grouped navigation", sidebar.includes("const navGroups"));
check("operations group declares its roles", /id: 'ops'[\s\S]{0,400}?roles: \['admin', 'warehouse_manager'\]/.test(sidebar));
check("admin group declares its roles", /id: 'admin'[\s\S]{0,300}?roles: \['admin'\]/.test(sidebar));
check("groups are rendered with a role check", /group\.roles && !group\.roles\.includes\(user\?\.role/.test(sidebar));
check("top navigation leads with dashboard + inventory", /href: '\/',[\s\S]{0,120}?href: '\/inventory'/.test(sidebar));
check("stock group links materials/equipment/transfers/movements", /'\/items'[\s\S]{0,300}?'\/equipment'[\s\S]{0,300}?'\/transfers'[\s\S]{0,300}?'\/transactions'/.test(sidebar));
check("catalog is reachable from the sidebar", sidebar.includes("{ href: '/catalog'"));
check("no ungated movementItems list remains", !sidebar.includes("movementItems"));

// ---- P1: discoverability from the dashboard --------------------------------
for (const href of ["/inventory", "/catalog", "/transfers"]) {
  check(`dashboard links to ${href}`, dashboard.includes(`href="${href}"`));
}

// ---- P1: catalog offers both definition entry points ----------------------
const catalog = fs.readFileSync(path.join(root, "artifacts/web/src/pages/catalog.tsx"), "utf8");
check("catalog can create a material", catalog.includes("setLocation('/items/new')"));
check("catalog can create equipment", catalog.includes("setLocation('/equipment/new')"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

