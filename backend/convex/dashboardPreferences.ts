import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByAuthSubject } from "./model";

const layout = v.union(v.literal("workspaces"), v.literal("workbench"));
const theme = v.union(v.literal("bold"), v.literal("studio"));

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { layout: "workspaces" as const, theme: "bold" as const, signedIn: false };
    const user = await getUserByAuthSubject(ctx, identity.subject);
    return { layout: user?.dashboardLayout ?? "workspaces", theme: user?.dashboardTheme ?? "bold", signedIn: true };
  },
});

export const setTheme = mutation({
  args: { theme },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in to save your visual theme.");
    const user = await getUserByAuthSubject(ctx, identity.subject);
    if (!user) throw new Error("Account data is still connecting. Try again shortly.");
    await ctx.db.patch(user._id, { dashboardTheme: args.theme, updatedAt: Date.now() });
    return { theme: args.theme };
  },
});

export const set = mutation({
  args: { layout },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in to save your dashboard layout.");
    const user = await getUserByAuthSubject(ctx, identity.subject);
    if (!user) throw new Error("Account data is still connecting. Try again shortly.");
    await ctx.db.patch(user._id, { dashboardLayout: args.layout, updatedAt: Date.now() });
    return { layout: args.layout };
  },
});
